---
title: "ToolJet sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de ToolJet sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ToolJet_GKE.md @ 15fd4c7 sha256:6fcbd3dcac16 -->

# ToolJet sur GKE Autopilot {#tooljet-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_GKE.png" alt="ToolJet sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme open source low-code pour la création et le
déploiement d'outils internes — tableaux de bord, panneaux d'administration,
applications CRUD et workflows — avec un constructeur par glisser-déposer sur
vos propres bases de données et API. Ce module déploie ToolJet sur **GKE
Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute comme une seule charge de travail web NestJS + React — le
backend API et le client compilé sont servis à partir du même processus
(`SERVE_CLIENT = "true"`) sur le port 80. Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — **deux** bases de données sur une instance (métadonnées + base de données ToolJet) |
| Base de données ToolJet | PostgREST (déploiement `additional_services`) | Sert la deuxième base de données (`<service_name>_tjdb`) aux requêtes d'application ; signé avec `PGRST_JWT_SECRET` |
| Cache & file d'attente | Redis | Activé par défaut ; prend en charge les files d'attente BullMQ de ToolJet ; la VM NFS co-héberge Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | Génération automatique de `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur empêche le
  démarrage.
- **Deux bases de données sont créées.** Le job `db-init` du premier
  déploiement crée la base de données de métadonnées et la deuxième
  « ToolJet Database » (`<service_name>_tjdb`), et accorde le rôle d'application
  partagé l'attribut **`CREATEROLE`**.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le serveur.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais
  être renouvelées après le premier démarrage — le renouvellement de `LOCKBOX_MASTER_KEY`
  corrompt toutes les informations d'identification de source de données
  stockées, et le renouvellement de `SECRET_KEY_BASE` invalide toutes les sessions.
- **L'affinité de session est `ClientIP` par défaut.** Le constructeur
  d'applications de ToolJet utilise des connexions WebSocket persistantes pour
  l'édition multi-utilisateur ; les requêtes du même client doivent atteindre le
  même pod.
- **`PORT` est défini par défaut à 80 par le point d'entrée.** GKE
  n'injecte pas `PORT`, donc sans la valeur par défaut, ToolJet se lierait
  au port 3000 tandis que le Service et les sondes cibleraient le port 80.
- **Redis est activé par défaut** et, avec un `redis_host` vide, l'IP du
  serveur NFS VM est injectée comme `REDIS_HOST` (`enable_nfs = true` provisionne
  cette VM).
- **Une IP externe stable + un hôte HTTPS `nip.io`** sont provisionnés
  prêts à l'emploi (`reserve_static_ip = true`, `enable_custom_domain = true`).
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé ;
  la première exécution est un **assistant de configuration** qui crée
  l'utilisateur administrateur initial et l'espace de travail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail ToolJet {#a-gke-autopilot--the-tooljet-workload}

Les pods ToolJet sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail ToolJet pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données d'application — applications, configurations de
sources de données, utilisateurs, espaces de travail, sessions — dans une
instance gérée Cloud SQL pour PostgreSQL 15, et utilise une **deuxième base de
données** (`<service_name>_tjdb`) sur la même instance pour la fonctionnalité intégrée
ToolJet Database. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** sur un point de terminaison TCP de bouclage (`127.0.0.1`) ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation
crée les deux bases de données, le rôle partagé `CREATEROLE`, `pgcrypto`, et
un schéma `postgrest` appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<service_name>_tjdb --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et le renouvellement du mot de passe, voir [App_GKE](App_GKE.md).

> **`enable_cloudsql_volume` doit rester `true` sur GKE.** Le sidecar Auth Proxy
> fournit le point de terminaison PostgreSQL `127.0.0.1` dont dépendent le pod et
> le job `db-create` ; le désactiver sur GKE bloque `db-create`.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et prend en charge les files d'attente BullMQ
de ToolJet (jobs en arrière-plan, notifications, éditeur multi-utilisateur).
Lorsque `redis_host` est laissé vide et `enable_nfs = true`, l'IP privée de la VM du
serveur NFS est injectée comme `REDIS_HOST` ; définissez `redis_host`
explicitement pour pointer vers une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre
toutes les informations d'identification de source de données stockées) et
`PGRST_JWT_SECRET` (signe les JWT PostgREST internes). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et le
renouvellement de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing, avec un hôte HTTPS `nip.io` et un certificat géré par Google. Un
domaine personnalisé peut être activé, et une IP statique est réservée afin que
l'adresse survive aux redéploiements. `TOOLJET_HOST` (qui pilote les liens générés
et les URI de redirection OAuth) utilise par défaut l'URL de service calculée.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations de sources de données et les
téléchargements dans PostgreSQL ; un bucket Cloud Storage `data` est
provisionné par défaut (`storage_buckets`) mais ToolJet lui-même n'en dépend pas.
NFS est activé par défaut uniquement parce que sa VM co-héberge Redis lorsque
`redis_host` est vide ; les pods ToolJet eux-mêmes sont sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM
  (serveur NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données de métadonnées et la base de données ToolJet, le rôle partagé
  `CREATEROLE`, accorde `cloudsqlsuperuser`, pré-crée `pgcrypto`, et réinitialise
  le schéma `postgrest` comme appartenant à l'application sur les deux bases de
  données. Sans un schéma `postgrest` appartenant à l'application,
  `reconfigurePostgrest` au démarrage de ToolJet échoue `permission denied for schema postgrest` et le pod
  entre en boucle de crash. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh`
  exécute `npm run db:migrate:prod` (TypeORM `migration:run`) en premier — le
  `start:prod` de ToolJet est `node dist/src/main` et ne migre **pas**. Sans
  cela, la base de données de métadonnées reste vide et toute action basée sur
  la base de données échoue (`relation "user_sessions" does not exist`).
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables
  après le premier démarrage.** La modification de `LOCKBOX_MASTER_KEY` corrompt
  toutes les informations d'identification de source de données stockées ; la
  modification de `SECRET_KEY_BASE` invalide toutes les sessions. Ne les modifiez
  que pendant une fenêtre de maintenance planifiée.
- **La première exécution est un assistant de configuration.** Avec
  `DISABLE_SIGNUPS = "true"`, ouvrez l'URL externe et complétez l'assistant : il crée le
  premier utilisateur administrateur et l'espace de travail, puis vous amène
  dans le constructeur d'applications.
- **L'édition multi-utilisateur nécessite des sessions persistantes.**
  `session_affinity = "ClientIP"` maintient la connexion WebSocket d'un client sur un seul pod ;
  sans cela, la collaboration en temps réel dans le constructeur est perturbée.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent par
  défaut `/` (le client servi est public et non authentifié) ;
  `/api/health` est également disponible comme chemin de sonde. Prévoyez
  plusieurs minutes au premier démarrage pour l'étape de migration.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
ToolJet sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Application et identité de la base de données {#group-3--application--database-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base pour les ressources (et la racine de l'espace de noms). Ne pas modifier après le premier déploiement. |
| `application_display_name` | `ToolJet` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `tooljet/tooljet-ce` ; épingler à une version spécifique en production. |
| `application_database_name` | `tooljet` | Nom de la base de données de métadonnées. Immuable après le premier déploiement. |
| `application_database_user` | `tooljet` | Utilisateur de la base de données d'application (partagé par les deux bases de données). |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et requêtes CPU/mémoire par pod. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE exige ≥ 1. |
| `max_instance_count` | `5` | Nombre maximum de réplicas. **N'augmentez que lorsque Redis est activé** (il l'est par défaut). |
| `enable_vertical_pod_autoscaling` | `false` | VPA pour l'ajustement automatique des requêtes. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis sur GKE. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ou `PG_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (auto) | `Deployment` ou `StatefulSet` ; se résout en `Deployment` lorsqu'il n'est pas défini. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour l'éditeur WebSocket multi-utilisateur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Activer les modèles PVC. Non recommandé — ToolJet stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s | Sonde de démarrage avec un budget large (30 × 15s) pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | activé, HTTP `/` | Sondes d'infrastructure de niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services d'aide supplémentaires, ajoutés au service PostgREST du module. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut ; sa VM co-héberge Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS configurés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée un bucket `data` (l'état propre de ToolJet réside dans PostgreSQL). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Prend en charge les files d'attente BullMQ de ToolJet. Transmis inchangé. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définir un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16/17 — Backend de base de données {#group-1617--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17/6 — Sauvegarde et maintenance {#group-176--backup--maintenance}

| Variable | Défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 10/19 — Domaine personnalisé, IP statique et réseau {#group-1019--custom-domain-static-ip--networking}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress + certificat géré (par défaut un hôte `nip.io`). |
| `application_domains` | `[]` | Noms d'hôtes supplémentaires à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 13/21 — Cloud Armor {#group-1321--cloud-armor}

| Variable | Défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ToolJet. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de métadonnées. |
| `database_user` | Utilisateur de la base de données d'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnellement) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica
> en lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors
> de portée. Une configuration invalide échoue la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt de manière permanente toutes les informations d'identification de source de données stockées — elles ne peuvent pas être déchiffrées. |
| `SECRET_KEY_BASE` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouveler invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `PGRST_JWT_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rompt la couche de requête de la base de données ToolJet jusqu'à ce que chaque pod redémarre. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver bloque `db-create`. |
| Rôle d'application `CREATEROLE` (défini par `db-init`) | Laisser tel quel | Élevé | Sans cela, la création d'espace de travail ToolJet échoue `permission denied to create role`. |
| Schéma `postgrest` appartenant à l'application (défini par `db-init`) | Laisser tel quel | Élevé | Un schéma appartenant à `postgres` fait échouer `reconfigurePostgrest` et le pod entre en boucle de crash. |
| `PORT` (valeur par défaut du point d'entrée 80) | Laisser tel quel | Élevé | Si le pod se lie au port 3000 alors que le service cible le port 80, il ne devient jamais prêt. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les reconnexions WebSocket sont acheminées vers différents pods, perturbant l'édition multi-utilisateur. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `memory_limit` | `4Gi` | Élevé | Le serveur ToolJet et son worker peuvent manquer de mémoire en dessous de ~2 GiB sous charge (PostgREST s'exécute comme son propre déploiement). |
| `enable_redis` | `true` | Moyen | Avec Redis désactivé, BullMQ se replie et les fonctionnalités en arrière-plan se dégradent. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `DISABLE_SIGNUPS` (auto-injecté `"true"`) | Garder activé après le premier administrateur | Élevé | L'ouverture de l'inscription permet à quiconque ayant l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à ToolJet
partagée avec la variante Cloud Run est décrite dans
**[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ToolJet sur GKE Autopilot](../labs/ToolJet_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur Google Cloud Run](ToolJet_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration d'application partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
