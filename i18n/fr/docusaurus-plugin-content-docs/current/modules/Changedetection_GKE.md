---
title: "Changedetection sur GKE Autopilot"
description: "Référence de configuration pour déployer Changedetection sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Changedetection_GKE.md @ 3055034 sha256:9210f4d062aa -->

# Changedetection sur GKE Autopilot {#changedetection-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_GKE.png" alt="Changedetection sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io est un service auto-hébergé et open source qui surveille les
modifications de pages web et envoie des notifications lorsqu'elles se produisent. Ce
module déploie changedetection.io sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise changedetection.io et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

changedetection.io s'exécute sous la forme d'une unique charge de travail web
Python/Flask. Le déploiement assemble un ensemble volontairement restreint de services
Google Cloud — il n'y a ni base de données ni cache :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Python/Flask, 1 vCPU / 1 GiB par défaut, écoute sur le port 5000 |
| Base de données | _Aucune_ | changedetection.io stocke tout son état sur disque, pas en SQL |
| Stockage persistant des données | Persistent Disk en mode bloc (PVC) ou Cloud Storage (GCS FUSE) | Monté sur `/datastore` ; un PVC en mode bloc via StatefulSet est fortement recommandé |
| Cache et file d'attente | _Aucun_ | Redis n'est pas utilisé ; il est explicitement désactivé |
| Secrets | Secret Manager | Aucun secret applicatif n'est injecté ; le jeton de l'API REST est créé dans l'interface web |
| Entrée | Cloud Load Balancing | Service `ClusterIP` derrière un Ingress Kubernetes avec une IP statique réservée et un certificat géré (domaine personnalisé activé par défaut ; un hôte `nip.io` est utilisé lorsqu'aucun n'est défini) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** changedetection.io est entièrement
  autonome. Il n'y a ni instance Cloud SQL, ni job `db-init`, ni étape de migration de
  schéma. Redis est désactivé (`enable_redis = false`) et
  `enable_cloudsql_volume = false`.
- **Le PVC en mode bloc est la valeur par défaut pour le stockage des données.**
  changedetection.io écrit un magasin de données à base de fichiers (JSON des
  surveillances plus fichiers d'instantanés d'historique) qui fonctionne au mieux sur un
  volume bloc POSIX ; `stateful_pvc_enabled = true` est donc la valeur par défaut, ce qui
  monte un PVC en mode bloc de 20Gi (via un StatefulSet) sur `/datastore`. Cela
  **désactive automatiquement le volume GCS FUSE** sur le même chemin
  (`enable_gcs_storage_volume = false`) afin d'éviter un double montage.
- **GCS FUSE est la solution de repli.** Avec `stateful_pvc_enabled = false`, le bucket
  GCS de données est monté sur `/datastore` via GCS FUSE. Cela fonctionne, mais convient
  moins bien qu'un PVC en mode bloc aux écritures à base de fichiers de l'application.
- **Un seul réplica par défaut.** `min_instance_count = 1` et `max_instance_count = 1`.
  L'ordonnanceur de récupération s'exécute dans le processus, sur un magasin de données
  unique ; exécuter plusieurs réplicas sur le même magasin expose à une corruption due à
  des écritures concurrentes. Conservez `max_instance_count = 1`.
- **Pas d'authentification par défaut.** Le tableau de bord est livré sans connexion.
  Définissez immédiatement un mot de passe dans **Settings → General**, et/ou placez la
  charge de travail derrière IAP.
- **`BASE_URL` n'est pas défini automatiquement sur GKE.** Définissez `BASE_URL` (l'hôte
  des liens de notification) sur l'URL externe du LoadBalancer ou du domaine
  personnalisé via `environment_variables`, une fois l'IP externe connue.
- **Épinglage de version.** Avec `application_version = "latest"`, le build de l'image
  épingle un tag réputé fiable (`0.50.19`) via l'argument de build propre à
  l'application `CHANGEDETECTION_VERSION`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail changedetection.io {#a-gke-autopilot--the-changedetectionio-workload}

Les pods changedetection.io sont planifiés sur Autopilot, qui facture le CPU et la
mémoire réellement demandés par les pods. Comme `stateful_pvc_enabled = true` par
défaut, `workload_type` se résout automatiquement en **StatefulSet** avec un PVC par
pod ; définissez `stateful_pvc_enabled =
false` pour obtenir à la place un `Deployment` avec un volume GCS FUSE.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  changedetection pour voir les pods et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Base de données — non utilisée {#b-database--not-used}

changedetection.io n'utilise **aucune base de données SQL**. `database_type = NONE` est
fixé par [Changedetection_Common](Changedetection_Common.md) ; aucune instance Cloud SQL
n'est créée et il n'existe aucun job d'initialisation `db-init`. Les entrées
`db_name`/`db_user` n'existent que pour la compatibilité avec la fondation et ne
provisionnent rien. Tout l'état persistant réside dans le volume de données décrit
ci-dessous.

### C. Stockage persistant des données (PVC ou Cloud Storage) {#c-persistent-datastore-pvc-or-cloud-storage}

Toute la configuration des surveillances, les instantanés de pages et l'historique des
modifications se trouvent sous `/datastore`.

- **PVC en mode bloc (par défaut).** Avec `stateful_pvc_enabled = true` (la valeur par
  défaut), un StatefulSet monte un Persistent Disk en mode bloc de 20Gi sur
  `stateful_pvc_mount_path` (`/datastore`).
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```
- **GCS FUSE (solution de repli).** Avec `stateful_pvc_enabled = false`, le bucket GCS
  de données est monté sur `/datastore` via le pilote CSI GCS FUSE.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

Consultez [App_GKE](App_GKE.md) pour les PVC de StatefulSet, les options CMEK et les
montages GCS FUSE.

### D. Cache et file d'attente — non utilisés {#d-cache--queue--not-used}

changedetection.io n'utilise ni Redis ni aucune file d'attente externe ; son
ordonnanceur de surveillances s'exécute dans le processus. `enable_redis = false` est
défini explicitement (ce qui remplace la valeur par défaut `true` d'App_GKE) et aucune
entrée Redis n'est raccordée.

### E. Secret Manager {#e-secret-manager}

Aucun secret applicatif n'est injecté dans le pod — le jeton facultatif de l'API REST
est généré dans l'interface web (**Settings → API**), et le magasin de données n'utilise
aucune clé de chiffrement. Secret Manager reste disponible pour toute variable
`secret_environment_variables` fournie par l'opérateur.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, le Service Kubernetes est de type `ClusterIP` (`service_type = ClusterIP`)
et la charge de travail est exposée via un Ingress Kubernetes avec une IP statique
réservée et un certificat géré par Google (`enable_custom_domain = true`,
`reserve_static_ip = true`). Lorsqu'aucun `application_domains` n'est défini, un nom
d'hôte `nip.io` dérivé de l'IP réservée est utilisé, de sorte que HTTPS fonctionne
d'emblée.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont
disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application changedetection.io {#3-changedetectionio-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni base
  de données ni job d'initialisation. Au premier démarrage, changedetection.io crée ses
  fichiers de données (`url-watches.json` et des répertoires d'historique par
  surveillance) sous `/datastore` s'ils n'existent pas déjà.
- **Aucune migration de schéma.** Les mises à niveau du format des données sont gérées
  en interne par l'application au démarrage ; il n'y a aucune étape de migration
  distincte à exécuter.
- **Le volume de données est le seul élément avec état.** Tout ce que l'application
  mémorise — surveillances, instantanés, historique des différences, configuration des
  notifications et éventuel mot de passe de l'interface — réside sur le volume
  `/datastore` (PVC en mode bloc ou bucket GCS). Supprimer le PVC ou le bucket efface
  tout l'état.
- **Pas d'authentification par défaut.** Le tableau de bord est livré ouvert. Définissez
  un mot de passe sous **Settings → General → Password** immédiatement après le premier
  accès, et/ou activez IAP devant la charge de travail. Il n'existe ni compte
  administrateur ni identifiant par défaut.
- **Le jeton de l'API REST est créé dans l'interface.** Pour utiliser l'API REST,
  générez un jeton sous **Settings → API** et transmettez-le dans l'en-tête
  `x-api-key`. Il n'est pas injecté via une variable d'environnement.
- **Définissez `BASE_URL` une fois l'IP externe connue.** Contrairement à la variante
  Cloud Run, le wrapper GKE n'injecte pas de `BASE_URL` exploitable. Définissez-le sur
  l'URL externe afin que le corps des notifications contienne des liens fonctionnels :
  ```bash
  kubectl set env -n "$NAMESPACE" statefulset/<name> \
    BASE_URL=https://changedetection.example.com
  ```
  Ou définissez `environment_variables = { BASE_URL = "https://…" }` dans la
  configuration du module.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — l'interface
  web, qui renvoie HTTP 200 dès que le serveur Flask est prêt. Le premier démarrage est
  rapide (pas de migrations) ; la sonde de démarrage par défaut accorde un délai initial
  de 15 secondes plus une fenêtre de 10 tentatives.
- **Contrainte de mise à l'échelle.** Conservez `max_instance_count = 1`. Plusieurs
  réplicas partageraient le même magasin de données et entreraient en concurrence lors
  des écritures ; l'application ne dispose d'aucune coordination distribuée.
- **Inspecter l'environnement en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'DATASTORE_PATH|BASE_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à changedetection.io ou importants pour
celui-ci sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `changedetection` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image. `latest` épingle le build sur `0.50.19` via `CHANGEDETECTION_VERSION` ; épinglez explicitement pour des déploiements reproductibles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (sans charge de travail). |
| `min_instance_count` | `1` | Conservez 1 afin que l'ordonnanceur de récupération s'exécute en permanence. |
| `max_instance_count` | `1` | **Conservez 1** — plusieurs réplicas entrent en concurrence sur le magasin de données partagé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — le sidecar Auth Proxy n'est pas nécessaire. |
| `enable_image_mirroring` | `true` | Met en miroir l'image changedetection.io dans Artifact Registry. |
| `container_port` | `5000` | Fixé à 5000 par Changedetection_Common ; non transmis à App_GKE. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Définissez ici `BASE_URL` pour les liens de notification ; `DATASTORE_PATH` est défini automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création des secrets avant de poursuivre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes ; l'ingress est géré séparément (groupe 19). |
| `workload_type` | `null` (auto) | Se résout en `StatefulSet`, puisque `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Pas de routage persistant par défaut ; définissez `ClientIP` si vous souhaitez qu'un client atteigne toujours le même pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet (persistance des données) {#group-7--statefulset-datastore-persistence}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Monte un PVC en mode bloc sur `/datastore` (recommandé). Désactive automatiquement le volume GCS FUSE sur le même chemin. Définissez `false` pour utiliser GCS FUSE à la place. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod pour le magasin de données. |
| `stateful_pvc_mount_path` | `/datastore` | Chemin de montage du magasin de données — correspond à `DATASTORE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes du PVC. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 15s | Sonde de démarrage sur l'interface web. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité sur l'interface web. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation intégré — changedetection.io ne nécessite aucun amorçage. |
| `cron_jobs` | `[]` | CronJobs Kubernetes facultatifs (l'application planifie elle-même ses vérifications de surveillance). |
| `additional_services` | `[]` | Services sidecar/auxiliaires (par ex. un récupérateur à navigateur Playwright). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé ; le magasin de données utilise un PVC en mode bloc ou GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (lorsque NFS est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS de données (utilisé pour la solution de repli FUSE et les sauvegardes). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` (effectif) | La variable elle-même vaut `true` par défaut, mais le `main.tf` du wrapper code en dur `enable_redis = false` dans l'appel à la fondation et ne transmet jamais `var.enable_redis` — changedetection.io n'utilise pas Redis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` / `db_user` | `""` | Non utilisées — transmises uniquement pour la compatibilité avec la fondation ; aucune base de données n'est créée. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). Sauvegardez le volume/bucket de données (aucune base n'existe). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré (repli sur un hôte `nip.io` lorsque `application_domains` est vide). |
| `application_domains` | `[]` | Noms d'hôte à servir (c'est aussi la valeur à définir pour `BASE_URL`). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Recommandé.** changedetection.io ne dispose d'aucune authentification propre — IAP
> place l'authentification Google devant le tableau de bord.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant changedetection.io. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une politique Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à changedetection.io. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut recommandées {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, `min_instance_count > max_instance_count`, une charge de travail `Deployment` associée à `stateful_pvc_enabled = true`, des valeurs de quota de ressources en unités binaires, un `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC de données / bucket GCS | Ne jamais supprimer/recréer | Critique | Le volume contient chaque surveillance, chaque instantané et chaque entrée d'historique — le supprimer fait perdre définitivement tout l'état de surveillance. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent simultanément dans le même magasin de données et corrompent `url-watches.json` ; l'application ne dispose d'aucun verrouillage distribué. |
| `stateful_pvc_enabled` ou `workload_type` | `true` (StatefulSet sélectionné automatiquement ; tous deux par défaut) | Élevé | Définir `workload_type = "Deployment"` conjointement à `stateful_pvc_enabled = true` échoue au moment du plan ; la persistance par PVC en mode bloc exige un StatefulSet. |
| Mot de passe de l'interface web | À définir immédiatement | Élevé | Le tableau de bord est livré **sans authentification** ; exposer le point de terminaison de l'Ingress sans mot de passe (ni IAP) révèle toutes les surveillances et la configuration des notifications. |
| `application_name` | À définir une seule fois | Élevé | Immuable après le premier déploiement ; le renommer recrée le bucket/PVC de données et rend les données existantes orphelines. |
| `stateful_pvc_mount_path` / `DATASTORE_PATH` | `/datastore` | Élevé | Une incohérence signifie que les données sont écrites sur le disque éphémère du pod et perdues au redémarrage ou à la replanification. |
| `BASE_URL` | URL externe du LoadBalancer / du domaine | Moyen | Non injecté sur GKE — le laisser non défini produit des liens absolus cassés dans les notifications de modification. |
| `enable_iap` | Activer (ou définir un mot de passe dans l'interface) | Élevé | Sans IAP ni mot de passe dans l'interface, le point de terminaison public de l'Ingress expose un tableau de bord non authentifié. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Conserver 1 maintient l'ordonnanceur de récupération en marche. |
| `enable_redis` / `enable_cloudsql_volume` | `false` / `false` | Faible | changedetection.io n'a besoin ni de l'un ni de l'autre ; les activer provisionne une infrastructure inutilisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod dans le namespace. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour la conservation réglementaire de la sauvegarde des données. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à changedetection.io,
partagée avec la variante Cloud Run, est décrite dans
**[Changedetection_Common](Changedetection_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Changedetection.io sur GKE Autopilot](../labs/Changedetection_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Changedetection sur Google Cloud Run](Changedetection_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Changedetection Common — Configuration applicative partagée](Changedetection_Common.md) — la configuration partagée par les deux cibles de déploiement.
