---
title: "GlitchTip sur GKE Autopilot"
description: "Référence de configuration pour déployer GlitchTip sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GlitchTip_GKE.md @ 3055034 sha256:481e0909c11e -->

# GlitchTip sur GKE Autopilot {#glitchtip-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GlitchTip_GKE.png" alt="GlitchTip sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des
performances compatible avec Sentry (Django/Python). Vos applications envoient leurs
exceptions et leurs traces au point de terminaison d'ingestion de GlitchTip, qui parle le
protocole Sentry, et GlitchTip les stocke, les déduplique et déclenche des alertes.
Ce module déploie GlitchTip sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise GlitchTip et sur la façon de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GlitchTip s'exécute comme une charge de travail web Python servie par **Granian** sur le
port 8080. Le rôle de serveur `all_in_one` exécute le serveur web, le worker Celery et
Celery beat dans l'unique conteneur du pod. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Django/Granian, 2 vCPU / 4 GiB par défaut ; un minimum de 1 réplica maintient le worker/beat actif |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — GlitchTip ne prend en charge ni MySQL ni d'autres moteurs |
| File de tâches et cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` fait passer la file Celery, le cache et les sessions par Postgres ; Redis est facultatif |
| Stockage d'objets / de fichiers | Cloud Storage + NFS | Un bucket de données `storage` ; NFS monté sur `/opt/glitchtip/storage` pour les pièces jointes téléversées |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe du superutilisateur initial générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut recommandées à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir un autre moteur empêche le démarrage.
- **L'image est une fine construction personnalisée.** GlitchTip est construit
  `FROM glitchtip/glitchtip:6.2.0` avec un point d'entrée cloud qui compose `DATABASE_URL`
  à partir des variables `DB_*` injectées et désactive Valkey/Redis avant de passer la main
  à `./bin/start.sh`. Sur GKE, le point d'entrée voit `DB_HOST = 127.0.0.1` (le sidecar
  Cloud SQL Auth Proxy) et se connecte en TCP sur l'interface de bouclage.
- **Pas de Redis par défaut.** `VALKEY_URL = ""` signifie que la file Celery, le cache et
  les sessions utilisent tous PostgreSQL. N'activez Redis que lorsque vous séparez le parc
  de workers à des volumes plus élevés.
- **Un minimum de 1 réplica est maintenu.** GKE ne prend pas en charge la mise à l'échelle
  à zéro, et le worker/beat Celery intégré au processus doit continuer à tourner pour
  l'ingestion des événements et la purge quotidienne liée à la rétention.
- **L'affinité de session est `ClientIP` par défaut.** Elle maintient une session de
  navigateur sur un même pod pour le tableau de bord.
- **NFS est activé par défaut** (`enable_nfs = true`) sur `/opt/glitchtip/storage` pour
  les pièces jointes téléversées ; la charge de travail est donc déployée avec la stratégie
  `Recreate` afin d'éviter que deux pods se disputent le volume partagé pendant une mise à
  jour.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés automatiquement** et
  stockés dans Secret Manager, puis matérialisés dans le namespace via le pilote Secret
  Store CSI.
- **Le propriétaire initial est pré-créé, il ne s'inscrit pas lui-même.**
  `glitchtip-migrate` crée `admin@techequity.cloud` ; `ENABLE_OPEN_USER_REGISTRATION`
  vaut `false` par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail GlitchTip {#a-gke-autopilot--the-glitchtip-workload}

Les pods GlitchTip sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement
entre le nombre minimal et le nombre maximal de réplicas ; un PodDisruptionBudget protège
la disponibilité pendant les mises à niveau des nœuds.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  GlitchTip pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, le scaling et le type de
charge de travail sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GlitchTip stocke toutes les données de l'application (projets, problèmes, événements,
utilisateurs et la file Celery) dans une instance gérée Cloud SQL pour PostgreSQL 15. Les
pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur l'interface de
bouclage (`127.0.0.1`) ; aucune IP publique n'est exposée. Lors du premier déploiement,
les Jobs `db-init` et `glitchtip-migrate` créent la base de données et l'utilisateur,
exécutent les migrations et créent le superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de données **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement, et le compte de service de la charge de travail y reçoit l'accès. Les
pièces jointes téléversées dans GlitchTip sont stockées sur **NFS** monté sur
`/opt/glitchtip/storage` (`enable_nfs = true`). Le tag réseau `nfsserver` (défini par
défaut) est requis pour que les pods accèdent à la VM du serveur NFS.

- **Console :** Cloud Storage → Buckets ; Compute Engine pour la VM du serveur NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl describe pod -n "$NAMESPACE" <pod> | grep -A3 nfs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis / Valkey (facultatif) {#d-redis--valkey-optional}

Redis est **désactivé par défaut** (`VALKEY_URL = ""` → file et cache adossés à
PostgreSQL). Définir `enable_redis = true` fait pointer le broker Celery et le cache de
GlitchTip vers Redis/Valkey ; laisser `redis_host` vide avec `enable_nfs = true` utilise
l'IP de la VM du serveur NFS.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i valkey
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets sont générés automatiquement : la `SECRET_KEY` Django et le mot de passe du
superutilisateur initial (consommé par le job de migration). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google
peut être activé (`enable_custom_domain = true`), et une IP statique est réservée par
défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GlitchTip {#3-glitchtip-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init`
  (`postgres:15-alpine`) se connecte via le Cloud SQL Auth Proxy et crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde les privilèges
  et réattribue la propriété du schéma `public`. Il peut être relancé sans risque et
  signale la fin au sidecar du proxy (`/quitquitquit`) pour que le pod du Job se termine.
- **Migrations et amorçage du superutilisateur.** Le Job `glitchtip-migrate` s'exécute sur
  l'image GlitchTip construite (`depends_on = ["db-init"]`). Il compose `DATABASE_URL`,
  exécute `./manage.py migrate --noinput`, puis `createsuperuser --noinput` à l'aide de
  `SUPERUSER_EMAIL` (`admin@techequity.cloud`) et du mot de passe du superutilisateur
  stocké dans Secret Manager. Le mot de passe de l'administrateur initial se trouve dans
  Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **Rôle de serveur `all_in_one`.** `SERVER_ROLE = all_in_one` exécute le serveur web, le
  worker Celery et beat dans un seul pod. GKE conserve au moins 1 réplica afin que
  l'ingestion en arrière-plan et la purge quotidienne liée à la rétention des événements
  continuent de s'exécuter.
- **Les mises à jour adossées à NFS utilisent `Recreate`.** Lorsque NFS est activé,
  App_GKE définit la stratégie du Deployment sur `Recreate` afin qu'une mise à jour
  n'exécute jamais deux pods simultanément sur le volume partagé des pièces jointes.
- **`SECRET_KEY` ne doit pas faire l'objet d'une rotation à la légère** — elle signe les
  sessions et les cookies ; la faire tourner déconnecte tout le monde.
- **L'ingestion des événements nécessite l'IP externe.** Les SDK des applications envoient
  (POST) les événements au point de terminaison d'ingestion sur l'URL du LoadBalancer ou du
  domaine personnalisé. Définissez un domaine personnalisé et un certificat géré pour
  disposer d'un hôte d'ingestion stable.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut.
  Prévoyez plusieurs minutes au premier démarrage, le temps que les migrations s'exécutent.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à GlitchTip ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement (utilisez `gke` pour l'exécuter à côté de la variante Cloud Run). |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `glitchtip` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `GlitchTip Error Tracking` | Nom lisible affiché dans la console. |
| `application_description` | `GlitchTip Open-source Error Tracking on GKE Autopilot` | Brève description de l'application. |
| `application_version` | `6.2.0` | Tag de l'image GlitchTip ; pilote la construction `FROM glitchtip/glitchtip:<tag>`. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | GlitchTip est une fine construction personnalisée ; conservez `custom`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; gardez ≥ 1 pour maintenir le worker/beat actif. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (borne supérieure du HPA). |
| `container_port` | `8080` | GlitchTip/Granian écoute sur le port 8080. |
| `container_resources` | 2 vCPU / 4 GiB | Requêtes et limites de CPU/mémoire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (obligatoire sur GKE). |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY`, `DATABASE_URL` ni `VALKEY_URL` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | `Deployment` (par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions du tableau de bord. |
| `network_tags` | `["nfsserver"]` | Obligatoire lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod. Inutile — l'état de GlitchTip réside dans PostgreSQL/NFS. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Paramètres du modèle de PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota de namespace. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires** (`"4Gi"`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors des perturbations volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartit les pods entre zones/nœuds. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, fenêtre d'échec de 30 × 15s | Sonde de démarrage. Prévoyez plusieurs minutes au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, mêmes délais | Sondes d'infrastructure au niveau d'App_GKE. |
| `uptime_check_config` | désactivé (`enabled=false`, chemin `/`) | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `glitchtip-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires. |

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage NFS des pièces jointes. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `storage_buckets` | (bucket de données) | Un bucket de données `storage` est déclaré par `GlitchTip_Common`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file Redis {#group-15--redis-cache--queue}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis/Valkey pour la file et le cache au lieu de PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — GlitchTip nécessite PostgreSQL 15. |
| `application_database_name` | `glitchtip` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `glitchtip` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** activer IAP impose une authentification par identité Google pour
> **toutes** les requêtes entrantes, y compris l'ingestion des événements par les SDK.
> N'activez IAP que pour un déploiement limité au tableau de bord, dans lequel les SDK
> utilisent un chemin d'ingestion distinct.

| Variable | Défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant GlitchTip. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une politique Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à GlitchTip. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `glitchtip-migrate`) et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut recommandées {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les événements et projets stockés. |
| `SECRET_KEY` (générée automatiquement) | Ne jamais la faire tourner à la légère | Élevé | Sa rotation invalide toutes les sessions et déconnecte tous les utilisateurs. |
| `min_instance_count` | `1` | Élevé | GKE impose min ≥ 1 ; conserver 1 maintient actif le worker/beat intégré au processus, de sorte que l'ingestion et la purge liée à la rétention s'exécutent. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans le namespace. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_iap` | déploiements limités au tableau de bord | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion des événements par les SDK. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixé à `false`) | sans objet | Élevé | Non exposé comme variable sur cette variante — `GlitchTip_Common` le définit toujours à `false`, de sorte que l'inscription reste limitée aux invitations par un administrateur. |
| `network_tags` inclut `nfsserver` | conserver la valeur par défaut | Élevé | Le retirer alors que `enable_nfs = true` bloque l'accès des pods à la VM du serveur NFS → pods bloqués au montage. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions du tableau de bord basculent d'un pod à l'autre. |
| `container_resources` mémoire | `4Gi` | Moyen | En dessous d'environ 1 GiB, les processus Django + worker + beat risquent un OOM lors des pics d'événements. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à GlitchTip, partagée avec
la variante Cloud Run, est décrite dans **[GlitchTip_Common](GlitchTip_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GlitchTip sur GKE Autopilot](../labs/GlitchTip_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [GlitchTip Common — Configuration applicative partagée](GlitchTip_Common.md) — la configuration partagée par les deux cibles de déploiement.
