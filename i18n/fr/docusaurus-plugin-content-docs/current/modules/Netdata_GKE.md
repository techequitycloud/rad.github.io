---
title: "Netdata sur GKE Autopilot"
description: "Référence de configuration pour déployer Netdata sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Netdata_GKE.md @ 3055034 sha256:99abcf01bd8c -->

# Netdata sur GKE Autopilot {#netdata-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netdata_GKE.png" alt="Netdata sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Netdata est un agent open source de supervision en temps réel des performances et de
la santé, qui collecte des milliers de métriques à la seconde (CPU, mémoire, disque,
réseau, conteneurs, services) sans aucune configuration et les visualise sur un
tableau de bord web interactif intégré. Il est écrit en C pour une surcharge minimale
et expose une API REST permettant d'interroger les données collectées. Ce module
déploie Netdata sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Netdata et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Netdata s'exécute en tant que charge de travail Kubernetes unique. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod Netdata sur le port `19999`, 1 vCPU / 1 GiB par défaut |
| Base de données | Aucune | `database_type = "NONE"` — Netdata conserve sa propre base de métriques interne (dbengine) sur disque ; aucune instance Cloud SQL n'est créée |
| Persistance des fichiers | PVC en mode bloc par pod (par défaut) | `stateful_pvc_enabled = true` provisionne un PVC `standard-rwo` (SSD) de 20Gi sur `/var/lib/netdata` ; Cloud Filestore (NFS) est disponible mais désactivé par défaut |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours provisionné, mais n'est monté sur `/var/lib/netdata` via GCS FUSE que lorsque le PVC en mode bloc est désactivé |
| Secrets | Secret Manager | `NETDATA_ADMIN_PASSWORD` facultatif (désactivé par défaut) — le tableau de bord local de Netdata n'a pas de connexion intégrée |
| Entrée | Service Kubernetes (`LoadBalancer` par défaut) | Domaine personnalisé facultatif via Kubernetes Gateway ; `ClusterIP`/`NodePort` disponibles |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données.** Netdata ne s'appuie pas sur Cloud SQL — tout l'état (le
  stockage de métriques dbengine, le journal d'alarmes/de santé et la configuration)
  réside sur le volume persistant monté. La variante GKE transmet en dur
  `enable_cloudsql_volume = false` et il n'y a pas de job `db-init`.
- **Le PVC de stockage en mode bloc est le mécanisme de persistance par défaut.**
  `stateful_pvc_enabled = true` (et, comme aucun `workload_type` n'est défini, la
  charge de travail est automatiquement résolue en **StatefulSet** — voir « StatefulSet
  auto-select » dans les conventions du dépôt). Le PVC utilise par défaut la
  StorageClass `standard-rwo` (adossée à des SSD), d'une taille de `20Gi`, montée sur
  `/var/lib/netdata`. Une véritable sémantique de périphérique en mode bloc est
  requise, car GCS FUSE corrompt les fichiers dbengine de Netdata.
- **Le bucket GCS `storage` est créé dans tous les cas, mais n'est monté qu'en
  solution de repli.** Le `main.tf` de `Netdata_GKE` définit
  `enable_gcs_storage_volume = !stateful_pvc_enabled` ; avec la valeur par défaut du
  PVC (`true`), le montage GCS FUSE est donc ignoré pour éviter un double montage sur
  le même chemin. Désactivez `stateful_pvc_enabled` pour revenir au bucket GCS au
  lieu d'un PVC en mode bloc.
- **Redis est désactivé de force.** Le `main.tf` de `Netdata_GKE` code en dur
  `enable_redis = false` dans l'appel à `App_GKE`, ce qui remplace la valeur par
  défaut `true` de la variable elle-même — Netdata n'utilise pas Redis.
- **Une seule réplique par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. Netdata écrit sa base de métriques sur un seul PVC ;
  exécuter plusieurs répliques sur le même volume n'est pas pris en charge.
- **Pas d'authentification intégrée.** Le tableau de bord local de Netdata n'est pas
  authentifié par défaut — quiconque peut atteindre le Service peut consulter toutes
  les métriques collectées. Le secret facultatif `enable_admin_password` ne configure
  pas la connexion propre à Netdata ; il génère un identifiant stable pour un reverse
  proxy géré par l'opérateur ou pour un flux de rattachement à Netdata Cloud placé en
  amont.
- **`service_type` vaut `LoadBalancer` par défaut** (accès externe) : le tableau de
  bord est donc accessible depuis l'extérieur du cluster via une IP externe dès que le
  Service est provisionné — aucune connexion intégrée ne le protège (voir la remarque
  sur l'authentification ci-dessus). Définissez `service_type = ClusterIP` pour le
  garder uniquement interne, ou configurez un domaine personnalisé via
  `enable_custom_domain` (qui vaut lui-même `true` par défaut mais n'a aucun effet tant
  que `application_domains` n'est pas renseigné).
- **L'image est un build personnalisé minimal.** `Netdata_Common` fournit un
  `Dockerfile` minimal (`FROM netdata/netdata:${NETDATA_VERSION}`) uniquement pour
  que la fondation puisse mettre en miroir l'image amont dans Artifact Registry ;
  `application_version = "latest"` épingle le build sur un tag éprouvé (`v2.2.6`) via
  l'ARG de build propre à l'application `NETDATA_VERSION`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Netdata {#a-gke-autopilot--the-netdata-workload}

Netdata s'exécute dans un seul pod planifié sur Autopilot, qui facture le CPU et la
mémoire que le pod demande réellement. Avec la valeur par défaut `stateful_pvc_enabled
= true`, la charge de travail est un **StatefulSet** doté d'une identité de pod
stable et d'un PVC dédié par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Netdata pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche la ClusterIP ou l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle
et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Stockage persistant — PVC en mode bloc (par défaut) ou NFS {#b-persistent-storage--block-pvc-default-or-nfs}

Le stockage de métriques dbengine, le journal d'alarmes/de santé et la configuration
de Netdata résident sous `/var/lib/netdata`. Par défaut, il s'agit d'un **PVC de
stockage en mode bloc** par pod (`stateful_pvc_enabled = true`, StorageClass
`standard-rwo`, `20Gi`) — requis parce que le format de fichier du dbengine exige une
véritable sémantique de périphérique en mode bloc (GCS FUSE le corrompt). Cloud
Filestore (NFS) est disponible comme montage partagé alternatif (`enable_nfs`, par
défaut `false`), mais ce n'est pas la voie recommandée pour les fichiers de données
propres à Netdata.

- **Console :** Kubernetes Engine → Stockage → Persistent Volume Claims ;
  Filestore → Instances (uniquement si NFS est activé).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement des PVC des StatefulSets, le
compromis HDD/SSD de `stateful_pvc_storage_class` et la découverte NFS.

### C. Cloud Storage (solution de repli) {#c-cloud-storage-fallback-path}

Un bucket **Cloud Storage** (suffixe `storage`) est provisionné automatiquement quel
que soit le paramètre du PVC, et le compte de service de la charge de travail reçoit
l'accès à ce bucket. Il n'est monté dans le pod (via GCS FUSE) que lorsque
`stateful_pvc_enabled = false`, comme mécanisme de persistance de repli pour
`/var/lib/netdata`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Netdata n'a aucun secret généré obligatoire. Le **seul** secret facultatif est
`NETDATA_ADMIN_PASSWORD` (conditionné par `enable_admin_password`, par défaut
`false`) — une valeur aléatoire de 32 caractères stockée dans Secret Manager et
injectée sous forme de Secret Kubernetes natif (via `explicit_secret_values`, et non
via le chemin Secret Store CSI/SecretSync). Il ne configure pas l'authentification
propre à Netdata ; il existe en tant qu'identifiant stable pour un reverse proxy côté
opérateur ou pour une étape de rattachement à Netdata Cloud.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée à l'extérieur via une IP éphémère ou
réservée (`service_type = LoadBalancer`, `reserve_static_ip = true`). Définissez
`service_type = ClusterIP` pour la garder uniquement interne, ou configurez
`application_domains` (avec `enable_custom_domain`, par défaut `true`) pour un accès
acheminé par Gateway avec un certificat géré.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE sont
envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles (`uptime_check_config`, désactivé par défaut ;
`alert_policies`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Netdata {#3-netdata-application-behaviour}

- **Aucun job d'initialisation par défaut.** `initialization_jobs` vaut par défaut
  `[]` — Netdata initialise lui-même sa base de métriques sur disque au premier
  démarrage ; il n'y a aucun job `db-init` ou de migration à attendre. Des jobs
  personnalisés peuvent être fournis pour des tâches de chargement/migration de
  données si nécessaire.
- **Pas d'assistant de premier lancement ni de connexion obligatoire.** Le tableau de
  bord est accessible et pleinement fonctionnel (sous réserve de
  `service_type`/l'entrée) dès que le pod est Ready — Netdata n'exige pas la création
  d'un compte administrateur avant utilisation.
- **Les sondes de santé ciblent `/api/v1/info`.** La sonde de démarrage
  (`startup_probe` : `initial_delay=15s`, `timeout=5s`, `period=10s`,
  `failure_threshold=10`) et la sonde de vivacité (`liveness_probe` :
  `initial_delay=30s`, `timeout=5s`, `period=30s`, `failure_threshold=3`)
  effectuent toutes deux un HTTP `GET /api/v1/info`, sans authentification. Le même
  chemin est la valeur par défaut des variables de niveau fondation
  `health_check_config`, `startup_probe_config` et `uptime_check_config`.
  {/* TODO: verify exact response body/status contract of /api/v1/info in the deployed image — variable descriptions reference it as Netdata's "dedicated liveness endpoint" but do not specify the payload. */}
- **Mise à l'échelle sur une seule instance.** `min_instance_count = 1` /
  `max_instance_count = 1` par défaut — la base de métriques sur le PVC est écrite
  par un seul processus ; ne dépassez pas 1 sans avoir vérifié la configuration
  distribuée/de streaming de Netdata.
- **Épinglage de la version de l'image.** `application_version = "latest"` est
  résolu au moment du build en la valeur par défaut épinglée du Dockerfile, `v2.2.6`
  (l'ARG de build propre à l'application `NETDATA_VERSION`, et non le `APP_VERSION`
  générique que la fondation injecte) — définissez une version explicite pour suivre
  une autre version.
- **Vérifiez la charge de travail en cours d'exécution :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- wget -qO- http://127.0.0.1:19999/api/v1/info
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 19999:19999
  # then browse http://127.0.0.1:19999
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Netdata ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netdata` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `netdata/netdata` utilisé comme base du build personnalisé ; `latest` est épinglé sur un tag éprouvé (`v2.2.6`) au moment du build. |
| `enable_admin_password` | `false` | Génère un identifiant Secret Manager pour une couche d'authentification côté opérateur. Le tableau de bord propre à Netdata reste non authentifié, quel que soit ce paramètre. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | À augmenter pour un nombre de collections plus élevé / une rétention plus longue. |
| `min_instance_count` | `1` | Conservez 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Conservez 1** — un PVC, un rédacteur. |
| `container_port` | `19999` | Fixé par `Netdata_Common` ; cette variable est purement informative et n'est pas transmise à `App_GKE`. |
| `enable_cloudsql_volume` | `false` | Netdata n'a pas de base de données Cloud SQL — conservez `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP publique par défaut ; définissez `ClusterIP` pour le garder uniquement interne. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement en StatefulSet parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucun routage persistant n'est nécessaire avec une seule réplique. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC en mode bloc par pod — requis pour que les fichiers dbengine de Netdata bénéficient d'une véritable sémantique de périphérique en mode bloc (GCS FUSE les corrompt). |
| `stateful_pvc_size` | `20Gi` | Taille permettant de contenir votre fenêtre de rétention des collections, plus une marge. |
| `stateful_pvc_mount_path` | `/var/lib/netdata` | Emplacement où Netdata fait persister sa base de métriques, son journal d'alarmes et sa configuration. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Balanced-PD, adossé à des SSD. Consomme le quota `SSD_TOTAL_GB` — remplacez-le par `standard` (HDD) si le quota est limité ; le profil d'écriture de Netdata n'exige pas les IOPS d'un SSD. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture au groupe ; Netdata s'exécute avec l'UID 1000 / le GID 2000. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /api/v1/info` | Sondes au niveau du conteneur, câblées via `Netdata_Common`. |
| `health_check_config` / `startup_probe_config` | HTTP `GET /api/v1/info` | Configuration des sondes au niveau de la fondation (même point de terminaison). |
| `uptime_check_config` | désactivé, chemin `/api/v1/info` | À activer pour un `google_monitoring_uptime_check_config` externe, utile uniquement une fois le Service accessible publiquement. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — la persistance est assurée par le PVC en mode bloc du StatefulSet. Activez-le uniquement si vous avez besoin d'un montage NFS partagé pour un autre usage que les données dbengine propres à Netdata. |
| `nfs_mount_path` | `/mnt/nfs` | Pas le même chemin que le montage du PVC (`/var/lib/netdata`) — évitez de pointer NFS vers le chemin du PVC. |

### Groupe 15 — Redis (non utilisé) {#group-15--redis-not-used}

Netdata n'utilise pas Redis. `enable_redis` vaut `true` par défaut au niveau de la
variable, mais le `main.tf` de `Netdata_GKE` transmet inconditionnellement
`enable_redis = false` à `App_GKE` ; la valeur par défaut de la variable est donc
sans effet pour ce module — aucune connexion Redis n'est jamais injectée.

### Groupe 16 — Base de données (non utilisée) {#group-16--database-backend-not-used}

`database_type` est fixé à `NONE` par `Netdata_Common` ; aucune instance Cloud SQL,
base de données ni utilisateur n'est créé. Les variables `application_database_name`
(`netdatadb`) / `application_database_user` (`netdatauser`) et les variables `db_*`
associées ne sont déclarées que pour la compatibilité avec la reproduction des
variables de la fondation et n'ont aucun effet.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Active le routage basé sur Gateway, mais n'a aucun effet tant que `application_domains` n'est pas renseigné. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre, dès que `service_type = LoadBalancer` ou qu'une Gateway est utilisée. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Netdata. |
| `netdata_admin_password_secret_id` | ID du secret Secret Manager de l'identifiant de mot de passe administrateur ; vide lorsque `enable_admin_password = false`. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
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

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et
> leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps
> qu'un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*`
> exprimés en entiers bruts, un `container_port`/
> `backup_retention_days` hors plage. `Netdata_GKE` contrôle en outre, au moment du
> plan, `min_instance_count <= max_instance_count` et l'activation d'IAP sans
> identifiants OAuth (voir `validation.tf`). Une configuration invalide fait échouer
> le **plan** avec une erreur claire et nommée avant la création de toute ressource ;
> la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` (par défaut `LoadBalancer`) + `enable_admin_password` | Définissez `service_type = ClusterIP` pour rester uniquement interne, ou ajoutez une couche reverse proxy/authentification avant toute exposition externe | Critical | Le tableau de bord de Netdata n'a pas de connexion intégrée ; le Service `LoadBalancer` par défaut (ou un domaine personnalisé configuré) expose à l'extérieur toutes les métriques collectées des hôtes et des conteneurs, sans couche d'authentification ajoutée par l'opérateur. |
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver fait revenir à GCS FUSE, qui corrompt les fichiers de métriques dbengine de Netdata — perte de données / redémarrages en boucle. |
| `max_instance_count` | `1` | High | Le dbengine de Netdata est écrit par un seul processus sur un PVC ; dépasser 1 expose à une corruption des fichiers / une contention sur les verrous. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Consomme le quota régional `SSD_TOTAL_GB`, très limité ; passez à `standard` (HDD) sur les projets dont le quota est contraint — le profil d'écriture de Netdata n'a pas besoin des IOPS d'un SSD. |
| `enable_nfs` | `false` (à laisser désactivé) | Medium | NFS n'est pas la voie prise en charge pour les fichiers de données propres à Netdata (`/var/lib/netdata`) ; activez-le uniquement pour un montage partagé sans rapport, sur un autre chemin. |
| `application_version` | `latest` (→ `v2.2.6` épinglé) | Medium | Épingler un tag arbitraire qui n'existe pas en amont fait échouer l'étape de mise en miroir/de build de l'image Cloud Build. |
| `memory_limit` | `1Gi` (à augmenter pour un grand nombre de collections) | Medium | Netdata conserve les métriques récentes en mémoire ; un sous-dimensionnement provoque des redémarrages pour OOM sous une forte charge de collecte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_custom_domain` (par défaut `true`) avec `application_domains` vide | Renseignez `application_domains` ou ne modifiez ni l'un ni l'autre | Low | `enable_custom_domain=true` seul n'a aucun effet tant qu'aucun domaine n'est listé — ce n'est pas un risque fonctionnel, mais cela peut prêter à confusion lors d'un audit de l'exposition. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Netdata, partagée
avec la variante Cloud Run, est décrite dans
**[Netdata_Common](Netdata_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Netdata sur GKE Autopilot](../labs/Netdata_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Netdata sur Google Cloud Run](Netdata_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Netdata Common — Configuration applicative partagée](Netdata_Common.md) — la configuration partagée par les deux cibles de déploiement.
