---
title: "Cloudreve sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cloudreve sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Cloudreve_GKE.md @ 15fd4c7 sha256:33079a63a021 -->

# Cloudreve sur GKE Autopilot {#cloudreve-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_GKE.png" alt="Cloudreve sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve est une plateforme populaire de stockage cloud et de partage de
fichiers auto-hébergée, open-source, écrite en Go. Elle fournit une interface
utilisateur web pour le téléchargement, l'organisation, la prévisualisation et
le partage de fichiers, avec des back-ends de stockage enfichables. Ce module
déploie Cloudreve sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Cloudreve et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cloudreve s'exécute comme un seul binaire Go servant à la fois l'interface
utilisateur web et l'API de stockage de fichiers. Le déploiement connecte un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique sur le port 5212, `StatefulSet` par défaut |
| Persistance | Volume persistant de bloc (via `stateful_pvc_enabled`) | Monté à `/cloudreve` ; contient la base de données SQLite embarquée, `conf.ini`, et les fichiers téléchargés |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement, mais uniquement connecté comme un montage GCS FUSE lorsque le PVC de bloc est désactivé |
| Base de données | Aucune | Cloudreve utilise une base de données SQLite embarquée sur le volume de bloc — aucune instance Cloud SQL n'est créée |
| Secrets | Secret Manager | Aucun créé — le mot de passe administrateur de première exécution est généré par Cloudreve lui-même et imprimé dans les journaux du conteneur |
| Ingress | Kubernetes Gateway / Cloud Load Balancing | Domaine personnalisé activé par défaut ; IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par
  `Cloudreve_Common` ; chaque variable liée à Cloud SQL est transmise à la
  fondation uniquement pour la compatibilité de l'interface et n'a aucun effet.
- **`stateful_pvc_enabled = true` par défaut — requis, non optionnel.**
  La base de données SQLite embarquée de Cloudreve et le stockage de fichiers
  local coexistent dans son répertoire de travail, `/cloudreve`. Un montage
  GCS FUSE à cet endroit corromprait le verrouillage de fichiers de SQLite,
  donc le module utilise par défaut un PVC de bloc (`StatefulSet`) à la
  place ; `workload_type` n'a pas besoin d'être défini séparément.
- **La colocation binaire/données est gérée dans le build de l'image.**
  L'image `cloudreve/cloudreve` d'amont conserve à la fois le binaire `cloudreve`
  et ses données dans `/cloudreve`. Le Dockerfile de ce module déplace le
  binaire vers `/usr/local/bin/cloudreve` dans un build multi-étapes (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`,
  `WORKDIR /cloudreve`), de sorte que le montage du PVC à `/cloudreve` ne masque
  que les fichiers de données, jamais le binaire. Voir la
  [Section 3](#3-cloudreve-application-behaviour).
- **Le volume GCS et le PVC de bloc sont mutuellement exclusifs au même
  chemin.** La variante ne monte le bucket `storage` auto-créé à
  `/cloudreve` (`enable_gcs_storage_volume = !stateful_pvc_enabled`) que lorsque le PVC de bloc est
  désactivé, évitant un conflit de double montage — avec la configuration
  stateful par défaut, ce bucket existe mais n'est **pas** monté dans le pod.
- **Pas de Cloud SQL, pas de Redis.** `enable_cloudsql_volume` par défaut `false` et
  `enable_redis` est explicitement remplacé par `false` dans `main.tf`.
- **Pas de secret administrateur injectable.** Cloudreve génère son propre mot
  de passe administrateur initial au premier démarrage et l'imprime dans les
  journaux du conteneur — aucun secret Secret Manager n'est créé ;
  `secret_ids`/`secret_values` sont des maps vides.
- **Réplica unique par défaut.** `min_instance_count = max_instance_count =
  1`, correspondant à l'absence de
  support de clustering distribué/multi-nœuds de Cloudreve.
- **`enable_pod_disruption_budget` par défaut `true`** (inhabituel parmi les
  modules d'application), `pdb_min_available = "1"`, protégeant le pod stateful unique.
- **Le domaine personnalisé et l'IP statique sont activés par défaut**
  (`enable_custom_domain = true`, `reserve_static_ip = true`), contrairement à de nombreux
  autres modules d'application où ils sont désactivés par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region $REGION --project $PROJECT`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cloudreve {#a-gke-autopilot--the-cloudreve-workload}

Les pods Cloudreve sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que le pod demande réellement. Parce que `stateful_pvc_enabled = true` par défaut, la
charge de travail est un `StatefulSet` avec une identité de pod stable unique
et un PVC de bloc par pod, pas un `Deployment`.

- **Console :** Kubernetes Engine → Workloads → filtrer pour la charge de
  travail Cloudreve pour les pods, révisions et événements. Kubernetes Engine
  → Services & Ingress affiche l'IP externe / la route Gateway.
- **CLI :**
  ```bash
  kubectl get statefulsets,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et de la décision du type de charge de travail Déploiement vs StatefulSet.

### B. Volume persistant de bloc (PVC StatefulSet) {#b-block-persistent-volume-statefulset-pvc}

La base de données SQLite embarquée de Cloudreve (`cloudreve.db`), les `conf.ini`
générés et les fichiers téléchargés résident tous sous `/cloudreve`, le
répertoire de travail du conteneur. `stateful_pvc_enabled = true` provisionne un PVC de bloc
par pod (`stateful_pvc_storage_class = standard-rwo` par défaut, un PD équilibré basé sur SSD) monté à ce
chemin — un montage GCS FUSE ici briserait la sémantique de verrouillage de
fichiers de SQLite, donc le périphérique de bloc est obligatoire. Les
téléchargements et les avatars sont conservés dans `/cloudreve/data/` plutôt que
dans les propres `/cloudreve/uploads` et `/cloudreve/avatar` de l'image : l'image déclare
ces deux comme VOLUMES, que GKE sauvegarde avec un stockage de nœud éphémère
au-dessus du PVC, de sorte que les fichiers y disparaîtraient lors du
remplacement du pod. Le point d'entrée les lie en place et migre tout ce qui
reste à l'ancien emplacement.

- **Console :** Kubernetes Engine → Storage → filtrer pour le PVC Cloudreve ;
  Compute Engine → Disks affiche le disque persistant sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~cloudreve"
  ```

N'oubliez pas que la mise à l'échelle à zéro (`kubectl scale --replicas=0`) libère le
CPU/la mémoire mais **conserve le PVC** — seule la suppression du PVC (ou de
l'espace de noms) libère le quota SSD qu'il utilise. Voir
[App_GKE](App_GKE.md) pour les mécanismes du groupe StatefulSet / PVC et le
compromis de classe de stockage SSD vs HDD.

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage `storage` est créé automatiquement par
`Cloudreve_Common`, mais il n'est monté dans le pod en tant que volume GCS FUSE
que lorsque `stateful_pvc_enabled = false` (évitant un double montage à `/cloudreve`
avec le PVC de bloc). Avec la configuration stateful par défaut, le bucket
existe mais reste inutilisé à moins que vous ne l'ajoutiez comme entrée
`gcs_volumes` explicite à un chemin de montage différent.

- **Console :** Cloud Storage → Buckets → filtrer pour le suffixe
  `storage` du déploiement.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager pour Cloudreve
lui-même — le mot de passe administrateur de première exécution est généré
en interne par Cloudreve et imprimé dans les journaux du conteneur au premier
démarrage, non stocké dans Secret Manager. Tous les secrets que vous
configurez via `secret_environment_variables` sont toujours projetés via le mécanisme
standard Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI et les
mécanismes de rotation (la rotation n'a aucun effet ici car aucun secret de
service n'existe).

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail utilise `enable_custom_domain = true` avec
`reserve_static_ip = true` (API Kubernetes Gateway avec un certificat géré par Google).
`service_type` par défaut `ClusterIP` — la Gateway, et non le
Service, est le point d'entrée externe à moins que vous ne passiez à
`LoadBalancer`.

- **Console :** Network services → Load balancing / Gateways ; VPC network →
  IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring. Des vérifications de disponibilité optionnelles et des
politiques d'alerte sont disponibles (`uptime_check_config.enabled` par défaut
`false`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cloudreve {#3-cloudreve-application-behaviour}

- **Pas de job d'initialisation de base de données.** `Cloudreve_Common` n'injecte pas de
  job `db-init`/`db-create` par défaut — Cloudreve n'a pas de base de
  données SQL à provisionner. `initialization_jobs` n'exécute que les jobs que vous
  fournissez explicitement.
- **Auto-configuration au premier démarrage, mot de passe administrateur dans les
  journaux.** Au premier démarrage, Cloudreve crée son schéma SQLite sur le
  volume monté et génère le compte administrateur initial, imprimant le mot
  de passe généré dans les journaux du conteneur. Il n'y a pas d'étape de
  migration distincte et pas de secret Secret Manager pour le récupérer —
  capturez-le avec `kubectl logs` avant que le tampon de journal ne tourne,
  puis modifiez-le via l'interface utilisateur web.
- **L'occultation de volume est pré-corrigée dans le Dockerfile.** Sans le
  déplacement décrit dans la [Section 1](#1-overview), le montage du PVC de
  bloc à `/cloudreve` occulterait le binaire colocalisé, produisant
  `exec ./cloudreve: no such
  file or directory` (CrashLoopBackOff). Il s'agit d'un module
  **custom-build** (`container_image_source = "custom"`, `image_source = "custom"` dans
  `Cloudreve_Common`) précisément pour que cette correction (`modules/Cloudreve_Common/scripts/Dockerfile`)
  puisse être intégrée — ce n'est pas un simple passage de l'image amont.
  La modification du Dockerfile nécessite une reconstruction (`tofu taint
  'module.app_gke.module.app_build.null_resource.build_and_push_application_image[0]'`
  si un déclencheur de hachage de contenu manque le changement).
- **Le verrouillage de version utilise un ARG de build spécifique à l'application.**
  Le Dockerfile lit `CLOUDREVE_VERSION` (verrouillé à `3.8.3` lorsque
  `application_version =
  "latest"`), et non le générique `APP_VERSION` que la Fondation
  injecte et forcerait autrement à la balise non résolvable `latest`.
- **Chemins des sondes de santé.** La sonde de démarrage est **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, c'est-à-dire jusqu'à ~100s
  pour être prête) ; la sonde de vivacité est également **HTTP** `GET /`
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve n'a pas de
  point de terminaison de santé dédié distinct de son interface utilisateur
  web — `/` renvoie 200 une fois que le serveur est en service.
- **Réplica unique, sémantique `OrderedReady`.** Avec
  `stateful_pod_management_policy` laissé à sa valeur par défaut `null` → `OrderedReady`
  et `max_instance_count = 1`, un seul pod existe à la fois ; n'augmentez pas
  `max_instance_count` sans vérifier le support multi-nœuds/clustering de
  Cloudreve (non géré par ce module).
- **Inspecter la configuration en cours et le déploiement du StatefulSet :**
  ```bash
  kubectl get statefulsets -n "$NAMESPACE"
  kubectl rollout status statefulset/<service-name> -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /cloudreve
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Cloudreve sont listés ; toute autre entrée est héritée de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudreve` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image `cloudreve/cloudreve` ; `latest` est épinglé à `3.8.3` au moment de la construction via l'ARG de construction `CLOUDREVE_VERSION`. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Renseigne la description de la charge de travail GKE. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU alloué au conteneur Cloudreve. |
| `memory_limit` | `1Gi` | Mémoire allouée ; taille pour le service de fichiers et les transferts concurrents. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Cloudreve n'a pas de mode distribué/clustering — maintenez les deux à 1. |
| `container_port` | `5212` | Fixé par `Cloudreve_Common` ; la variable n'est pas transmise à App_GKE et n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Cloudreve n'a pas de base de données Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'accès externe passe par la Gateway (`enable_custom_domain`), et non par le Service, par défaut. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant configuré par défaut. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Requis** pour Cloudreve — sa base de données SQLite et ses téléchargements doivent résider sur un volume de bloc, et non sur gcsfuse. |
| `stateful_pvc_size` | `20Gi` | Taille pour la base de données SQLite plus les fichiers téléchargés ; augmenter pour des bibliothèques plus grandes. |
| `stateful_pvc_mount_path` | `/cloudreve` | Répertoire de travail de Cloudreve — ne pas modifier sans également mettre à jour les attentes de l'application en matière de chemin de données. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; passer à `standard` (HDD) si le quota strict `SSD_TOTAL_GB` est une contrainte (voir [App_GKE](App_GKE.md)). |
| `stateful_fs_group` | `3000` | Correspond à la convention `fsGroup` du graphique Helm de Cloudreve (le conteneur s'exécute en tant que UID 1000/GID 2000) afin que le PVC soit inscriptible par le groupe. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (inhabituel parmi les modules d'application) pour protéger le pod stateful unique. |
| `pdb_min_available` | `"1"` | Exige que le pod reste disponible pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | Pas de point de terminaison de santé dédié — Cloudreve sert `/` une fois prêt. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Même point de terminaison que la sonde de démarrage. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le bucket `storage` auto-créé n'est monté à `/cloudreve` que lorsque `stateful_pvc_enabled = false` ; sinon, il existe inutilisé à moins d'être monté à un chemin différent ici. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (par défaut App_GKE) mais **remplacé par `false`** dans `main.tf` | Cloudreve n'utilise pas Redis ; la variable n'a aucun effet quelle que soit sa valeur. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Cloudreve_Common` — Cloudreve n'a pas de base de données SQL ; toutes les autres variables `database_*`/`db_*`/`sql_*` sont transmises uniquement pour la compatibilité de l'interface de la fondation et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut, contrairement à de nombreux autres modules d'application. |
| `reserve_static_ip` | `true` | Adresse externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | La valeur par défaut porte la balise `nfsserver` même si `enable_nfs` par défaut `false` pour Cloudreve — inoffensif à moins que NFS ne soit activé séparément. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cloudreve. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, monté uniquement si `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (Cloudreve n'en injecte aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver sans fournir un montage de stockage de bloc équivalent permet à SQLite de résider sur gcsfuse (ou un disque éphémère), risquant une corruption de la base de données ou une perte totale de données lors de la recréation du pod. |
| `stateful_pvc_mount_path` | `/cloudreve` | Critique | Le modifier pour qu'il ne soit plus le répertoire de travail de Cloudreve déconnecte le volume persistant de l'endroit où l'application lit/écrit réellement sa base de données et ses téléchargements. |
| Relocalisation binaire du Dockerfile (`/usr/local/bin/cloudreve`) | Conserver tel quel | Critique | Revenir à `ENTRYPOINT ["./cloudreve"]` à l'intérieur de `/cloudreve` réintroduit l'occultation de volume : le montage du PVC de bloc masque le binaire et le pod CrashLoopBackOffs avec `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | Élevé | Cloudreve n'a pas de mode multi-nœuds/clustering vérifié dans ce module ; la mise à l'échelle au-delà de 1 risque des écritures concurrentes sur le même fichier SQLite (un seul pod possède réellement le PVC en mode StatefulSet `OrderedReady`, mais ne supposez pas que des nombres plus élevés sont sûrs). |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) ; `standard` (HDD) sous pression de quota | Moyen | Le SSD utilise le quota strict `SSD_TOTAL_GB`. La mise à l'échelle à zéro ne libère pas le PVC — seule la suppression le fait. |
| Récupération du mot de passe administrateur | Capturer depuis `kubectl logs` immédiatement après le premier démarrage | Moyen | Le mot de passe administrateur généré n'est imprimé dans les journaux du conteneur qu'une seule fois ; le manquer vous bloque l'accès au compte super-administrateur de première exécution jusqu'à la réinitialisation via le conteneur. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'adresse IP externe/Gateway peut changer lors des redéploiements, brisant le DNS et les liens favoris. |
| `gcs_volumes` à `/cloudreve` pendant `stateful_pvc_enabled = true` | Éviter | Élevé | Un montage GCS FUSE et le PVC de bloc ciblant tous deux `/cloudreve` entrent en conflit ; le module Common n'active le montage GCS que lorsque le PVC de bloc est désactivé. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Cloudreve partagée avec la variante Cloud Run est décrite dans le module
`Cloudreve_Common` (`modules/Cloudreve_Common`) ; un guide `Cloudreve_Common.md` dédié
n'existe pas encore dans cet ensemble de documentation.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cloudreve sur GKE Autopilot](../labs/Cloudreve_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Cloudreve Common — Configuration d'application partagée](Cloudreve_Common.md) — la configuration partagée par les deux cibles de déploiement.
