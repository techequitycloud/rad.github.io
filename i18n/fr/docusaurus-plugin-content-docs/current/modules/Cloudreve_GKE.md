---
title: "Cloudreve sur GKE Autopilot"
description: "Référence de configuration pour déployer Cloudreve sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Cloudreve_GKE.md @ 3055034 sha256:2595070f0505 -->

# Cloudreve sur GKE Autopilot {#cloudreve-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_GKE.png" alt="Cloudreve sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve est une plateforme populaire, open source et auto-hébergée, de stockage
cloud et de partage de fichiers, écrite en Go. Elle fournit une interface web pour
téléverser, organiser, prévisualiser et partager des fichiers, avec des backends de
stockage interchangeables. Ce module déploie Cloudreve sur **GKE Autopilot** au-dessus
du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Cloudreve et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cloudreve s'exécute comme un unique binaire Go qui sert à la fois l'interface web et
l'API de stockage de fichiers. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul binaire Go sur le port 5212, `StatefulSet` par défaut |
| Persistance | Volume persistant bloc (via `stateful_pvc_enabled`) | Monté sur `/cloudreve` ; contient la base SQLite intégrée, `conf.ini` et les fichiers téléversés |
| Stockage objet | Cloud Storage | Un bucket `storage` provisionné automatiquement, mais monté via GCS FUSE uniquement lorsque le PVC bloc est désactivé |
| Base de données | Aucune | Cloudreve utilise une base SQLite intégrée sur le volume bloc — aucune instance Cloud SQL n'est créée |
| Secrets | Secret Manager | Aucun n'est créé — le mot de passe administrateur du premier démarrage est généré par Cloudreve lui-même et affiché dans les journaux du conteneur |
| Entrée | Kubernetes Gateway / Cloud Load Balancing | Domaine personnalisé activé par défaut ; IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par
  `Cloudreve_Common` ; chaque variable liée à Cloud SQL n'est transmise au socle que
  pour la compatibilité d'interface et n'a aucun effet.
- **`stateful_pvc_enabled = true` par défaut — obligatoire, et non facultatif.**
  La base SQLite intégrée de Cloudreve et son stockage de fichiers local résident
  ensemble dans son répertoire de travail, `/cloudreve`. Un montage GCS FUSE à cet
  endroit corromprait le verrouillage de fichiers de SQLite ; le module utilise donc
  par défaut un PVC bloc (`StatefulSet`) ; `workload_type` n'a pas besoin d'être
  défini séparément.
- **La cohabitation binaire/données est traitée lors du build de l'image.** L'image
  amont `cloudreve/cloudreve` conserve à la fois le binaire `cloudreve` et ses
  données dans `/cloudreve`. Le Dockerfile de ce module déplace le binaire vers
  `/usr/local/bin/cloudreve` dans un build multi-étapes (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`, `WORKDIR /cloudreve`), de sorte que monter le PVC
  sur `/cloudreve` ne masque que les fichiers de données, jamais le binaire. Voir la
  [section 3](#3-cloudreve-application-behaviour).
- **Le volume GCS et le PVC bloc s'excluent mutuellement sur un même chemin.** La
  variante ne monte le bucket `storage` créé automatiquement sur `/cloudreve`
  (`enable_gcs_storage_volume = !stateful_pvc_enabled`) que lorsque le PVC bloc est
  désactivé, ce qui évite un conflit de double montage — avec la configuration
  stateful par défaut, ce bucket existe mais n'est **pas** monté dans le pod.
- **Pas de Cloud SQL, pas de Redis.** `enable_cloudsql_volume` vaut `false` par
  défaut et `enable_redis` est explicitement forcé à `false` dans `main.tf`.
- **Aucun secret administrateur injectable.** Cloudreve génère son propre mot de
  passe administrateur initial au premier démarrage et l'affiche dans les journaux du
  conteneur — aucun secret Secret Manager n'est créé ; `secret_ids`/`secret_values`
  sont des maps vides.
- **Réplica unique par défaut.** `min_instance_count = max_instance_count =
  1`, ce qui correspond à l'absence de prise en charge du clustering distribué/
  multi-nœud par Cloudreve.
- **`enable_pod_disruption_budget` vaut `true` par défaut** (inhabituel parmi les
  modules applicatifs), avec `pdb_min_available = "1"`, pour protéger l'unique pod
  stateful.
- **Le domaine personnalisé et l'IP statique sont activés par défaut**
  (`enable_custom_domain = true`, `reserve_static_ip = true`), contrairement à de
  nombreux autres modules applicatifs où ils sont désactivés par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region $REGION --project $PROJECT`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cloudreve {#a-gke-autopilot--the-cloudreve-workload}

Les pods Cloudreve sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par le pod. Comme `stateful_pvc_enabled = true` par défaut, la
charge de travail est un `StatefulSet` avec une identité de pod unique et stable et un
PVC bloc par pod, et non un `Deployment`.

- **Console :** Kubernetes Engine → Workloads → filtrez sur la charge de travail
  Cloudreve pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe / la route Gateway.
- **CLI :**
  ```bash
  kubectl get statefulsets,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du choix du type de charge de travail Deployment ou StatefulSet.

### B. Volume persistant bloc (PVC du StatefulSet) {#b-block-persistent-volume-statefulset-pvc}

La base SQLite intégrée de Cloudreve (`cloudreve.db`), le `conf.ini` généré et les
fichiers téléversés résident tous sous `/cloudreve`, le répertoire de travail du
conteneur. `stateful_pvc_enabled = true` provisionne un PVC bloc par pod
(`stateful_pvc_storage_class = standard-rwo` par défaut, un Balanced PD sur SSD)
monté à cet emplacement — un montage GCS FUSE ici romprait la sémantique de
verrouillage de fichiers de SQLite ; le périphérique bloc est donc obligatoire.

- **Console :** Kubernetes Engine → Storage → filtrez sur le PVC Cloudreve ;
  Compute Engine → Disks affiche le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~cloudreve"
  ```

N'oubliez pas que la mise à zéro (`kubectl scale --replicas=0`) libère le CPU et la
mémoire mais **conserve le PVC** — seule la suppression du PVC (ou de l'espace de
noms) libère le quota SSD qu'il consomme. Consultez [App_GKE](App_GKE.md) pour les
mécanismes du groupe StatefulSet / PVC et le compromis de classe de stockage SSD ou
HDD.

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage `storage` est créé automatiquement par `Cloudreve_Common`,
mais il n'est monté dans le pod comme volume GCS FUSE que lorsque
`stateful_pvc_enabled = false` (ce qui évite un double montage sur `/cloudreve` avec
le PVC bloc). Avec la configuration stateful par défaut, le bucket existe mais reste
inutilisé, sauf si vous l'ajoutez comme entrée `gcs_volumes` explicite sur un autre
chemin de montage.

- **Console :** Cloud Storage → Buckets → filtrez sur le suffixe `storage` du
  déploiement.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager pour Cloudreve
lui-même — le mot de passe administrateur du premier démarrage est généré en interne
par Cloudreve et affiché dans les journaux du conteneur au premier démarrage, sans
être stocké dans Secret Manager. Les secrets que vous configurez via
`secret_environment_variables` restent projetés par le mécanisme Secret Store CSI
standard.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et les mécanismes
de rotation (la rotation n'a ici aucun effet puisqu'aucun secret de service n'existe).

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail utilise `enable_custom_domain = true` avec
`reserve_static_ip = true` (Kubernetes Gateway API avec un certificat géré par
Google). `service_type` vaut `ClusterIP` par défaut — c'est la Gateway, et non le
Service, qui constitue le point d'entrée externe, sauf si vous passez à
`LoadBalancer`.

- **Console :** Services réseau → Équilibrage de charge / Gateways ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles (`uptime_check_config.enabled` vaut `false` par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cloudreve {#3-cloudreve-application-behaviour}

- **Aucun job d'initialisation de base de données.** `Cloudreve_Common` n'injecte
  pas de job `db-init`/`db-create` par défaut — Cloudreve n'a aucune base SQL à
  provisionner. `initialization_jobs` n'exécute que les jobs que vous fournissez
  explicitement.
- **Auto-configuration au premier démarrage, mot de passe administrateur dans les
  journaux.** Au premier démarrage, Cloudreve crée son schéma SQLite sur le volume
  monté et génère le compte administrateur initial, en affichant le mot de passe
  généré dans les journaux du conteneur. Il n'existe ni étape de migration distincte
  ni secret Secret Manager depuis lequel le récupérer — capturez-le avec
  `kubectl logs` avant la rotation du tampon de journaux, puis changez-le via
  l'interface web.
- **Le masquage par volume est corrigé à l'avance dans le Dockerfile.** Sans le
  déplacement décrit à la [section 1](#1-overview), le montage du PVC bloc sur
  `/cloudreve` masquerait le binaire qui y cohabite, produisant `exec ./cloudreve: no such
  file or directory` (CrashLoopBackOff). Il s'agit d'un module à **build
  personnalisé** (`container_image_source = "custom"`, `image_source = "custom"` dans
  `Cloudreve_Common`) précisément pour que ce correctif (`modules/Cloudreve_Common/scripts/Dockerfile`)
  soit intégré à l'image — ce n'est pas une simple reprise de l'image amont.
  Modifier le Dockerfile exige un nouveau build (`tofu taint
  'module.app_gke.module.app_build.null_resource.build_and_push_application_image[0]'`
  si un déclencheur basé sur l'empreinte du contenu ne détecte pas le changement).
- **L'épinglage de version utilise un ARG de build propre à l'application.** Le
  Dockerfile lit `CLOUDREVE_VERSION` (épinglé à `3.8.3` lorsque `application_version =
  "latest"`), et non l'`APP_VERSION` générique que le socle injecte et qui forcerait
  sinon le tag introuvable `latest`.
- **Chemins des sondes de santé.** La sonde de démarrage est une sonde **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, soit jusqu'à ~100 s pour
  être prêt) ; la sonde de vivacité est aussi une sonde **HTTP** `GET /`
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve n'a pas de point de
  terminaison de santé distinct de son interface web — `/` renvoie 200 dès que le
  serveur répond.
- **Réplica unique, sémantique `OrderedReady`.** Avec
  `stateful_pod_management_policy` laissé à sa valeur par défaut `null` → `OrderedReady`
  et `max_instance_count = 1`, un seul pod existe à la fois ; n'augmentez pas
  `max_instance_count` sans avoir vérifié la prise en charge multi-nœud/clustering
  propre à Cloudreve (non gérée par ce module).
- **Inspecter la configuration en cours d'exécution et le déploiement du StatefulSet :**
  ```bash
  kubectl get statefulsets -n "$NAMESPACE"
  kubectl rollout status statefulset/<service-name> -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /cloudreve
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Cloudreve ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudreve` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `cloudreve/cloudreve` ; `latest` est épinglé à `3.8.3` au moment du build via l'ARG de build `CLOUDREVE_VERSION`. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Renseigne la description de la charge de travail GKE. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU alloué au conteneur Cloudreve. |
| `memory_limit` | `1Gi` | Mémoire allouée ; dimensionnez-la pour la diffusion de fichiers et les transferts simultanés. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Cloudreve n'a pas de mode distribué/clustering — laissez les deux à 1. |
| `container_port` | `5212` | Fixé par `Cloudreve_Common` ; la variable n'est pas transmise à App_GKE et n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Cloudreve n'a pas de base Cloud SQL. |
| `enable_image_mirroring` | `true` | Réplique l'image construite dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Par défaut, l'accès externe passe par la Gateway (`enable_custom_domain`), et non par le Service. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucun routage persistant (sticky) configuré par défaut. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Obligatoire** pour Cloudreve — sa base SQLite et ses téléversements doivent résider sur un volume bloc, et non sur gcsfuse. |
| `stateful_pvc_size` | `20Gi` | Taille pour la base SQLite et les fichiers téléversés ; augmentez-la pour des bibliothèques plus volumineuses. |
| `stateful_pvc_mount_path` | `/cloudreve` | Répertoire de travail de Cloudreve — ne le modifiez pas sans adapter aussi les chemins de données attendus par l'application. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD sur SSD ; passez à `standard` (HDD) si le quota serré `SSD_TOTAL_GB` est une contrainte (voir [App_GKE](App_GKE.md)). |
| `stateful_fs_group` | `3000` | Correspond à la convention `fsGroup` du chart Helm de Cloudreve (le conteneur s'exécute en UID 1000/GID 2000) afin que le PVC soit accessible en écriture au groupe. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (inhabituel parmi les modules applicatifs) pour protéger l'unique pod stateful. |
| `pdb_min_available` | `"1"` | Exige que l'unique pod reste disponible pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | Aucun point de terminaison de santé dédié — Cloudreve sert `/` une fois prêt. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Même point de terminaison que la sonde de démarrage. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le bucket `storage` créé automatiquement n'est monté sur `/cloudreve` que lorsque `stateful_pvc_enabled = false` ; sinon, il existe sans être utilisé, sauf s'il est monté ici sur un autre chemin. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut d'App_GKE) mais **forcé à `false`** dans `main.tf` | Cloudreve n'utilise pas Redis ; la variable n'a aucun effet, quel que soit son réglage. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Cloudreve_Common` — Cloudreve n'a pas de base SQL ; toutes les autres variables `database_*`/`db_*`/`sql_*` ne sont transmises que pour la compatibilité avec l'interface du socle et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut, contrairement à de nombreux autres modules applicatifs. |
| `reserve_static_ip` | `true` | Adresse externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | La valeur par défaut porte le tag `nfsserver` même si `enable_nfs` vaut `false` par défaut pour Cloudreve — sans conséquence tant que NFS n'est pas activé séparément. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Cloudreve. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, monté uniquement si `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (Cloudreve n'en injecte aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les
> valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un
> réglage stateless, IAP sans identité autorisée,
> `quota_memory_*` exprimé en entiers bruts, un
> `container_port`/`backup_retention_days` hors limites. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver sans fournir de montage de stockage bloc équivalent place SQLite sur gcsfuse (ou sur un disque éphémère), ce qui expose à une corruption de la base de données ou à une perte totale des données lors de la recréation du pod. |
| `stateful_pvc_mount_path` | `/cloudreve` | Critical | L'éloigner du répertoire de travail de Cloudreve déconnecte le volume persistant de l'endroit où l'application lit et écrit réellement sa base et ses téléversements. |
| Déplacement du binaire dans le Dockerfile (`/usr/local/bin/cloudreve`) | Conservez-le tel que livré | Critical | Revenir à `ENTRYPOINT ["./cloudreve"]` dans `/cloudreve` réintroduit le masquage par volume : le montage du PVC bloc cache le binaire et le pod passe en CrashLoopBackOff avec `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | High | Cloudreve n'a pas de mode multi-nœud/clustering vérifié dans ce module ; dépasser 1 expose à des écrivains concurrents sur le même fichier SQLite (un seul pod possède réellement le PVC en mode StatefulSet `OrderedReady`, mais ne supposez pas que des valeurs plus élevées sont sûres). |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) ; `standard` (HDD) en cas de pression sur les quotas | Medium | Le SSD consomme le quota serré `SSD_TOTAL_GB`. La mise à zéro ne libère pas le PVC — seule sa suppression le fait. |
| Récupération du mot de passe administrateur | Capturez-le depuis `kubectl logs` immédiatement après le premier démarrage | Medium | Le mot de passe administrateur généré n'est affiché qu'une seule fois dans les journaux du conteneur ; le manquer vous empêche d'accéder au compte super-administrateur initial jusqu'à sa réinitialisation via le conteneur. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'adresse IP externe / de la Gateway peut changer d'un redéploiement à l'autre, ce qui rompt le DNS et les liens enregistrés. |
| `gcs_volumes` sur `/cloudreve` alors que `stateful_pvc_enabled = true` | À éviter | High | Un montage GCS FUSE et le PVC bloc ciblant tous deux `/cloudreve` entrent en conflit ; le module Common n'active le montage GCS que lorsque le PVC bloc est désactivé. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Cloudreve et
partagée avec la variante Cloud Run est décrite dans le module `Cloudreve_Common`
(`modules/Cloudreve_Common`) ; un guide `Cloudreve_Common.md` dédié n'existe pas
encore dans cette documentation.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cloudreve sur GKE Autopilot](../labs/Cloudreve_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Cloudreve Common — Configuration applicative partagée](Cloudreve_Common.md) — la configuration partagée par les deux cibles de déploiement.
