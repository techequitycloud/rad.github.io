---
title: "OpenProject sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'OpenProject sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenProject_CloudRun.md @ 15fd4c7 sha256:9eb14b463e0e -->

# OpenProject sur Google Cloud Run {#openproject-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_CloudRun.png" alt="OpenProject sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite de gestion de projet et de collaboration d'équipe
open-source, sous licence GPLv3 — paquets de travail, diagrammes de Gantt,
tableaux agiles, wikis, suivi du temps et budgets. Ce module déploie OpenProject
sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OpenProject utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenProject s'exécute comme un conteneur Ruby on Rails (Puma) sur Cloud Run v2.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails/Puma, 2 vCPU / 4 GiB par défaut, CPU toujours alloué |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — OpenProject ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des paquets de travail, monté à `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |
| Jobs en arrière-plan | good_job (en-processus, sur PostgreSQL) | Pas de Redis — la file d'attente des jobs réside dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur empêche
  le démarrage.
- **Connexion à la base de données TCP par IP privée.** `enable_cloudsql_volume = false` sur Cloud Run.
  OpenProject (Rails) lit une seule chaîne de connexion `DATABASE_URL`, et l'analyseur
  `URI` de Ruby ne peut pas gérer le répertoire de socket Unix de Cloud SQL
  (ses deux-points interrompent l'analyse de l'URL), donc le point d'entrée se
  connecte via l'IP privée de l'instance avec `sslmode=require`.
- **Pas de Redis.** Les jobs en arrière-plan s'exécutent via `good_job` avec la
  file d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est transféré comme
  `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il ne
  doit jamais être renouvelé après le premier démarrage — le renouveler rend
  chaque session existante et toutes les colonnes de base de données chiffrées
  illlisibles.
- **Le CPU est toujours alloué** (`cpu_always_allocated = true`, `min_instance_count = 1`) car le worker `good_job`
  en-processus et le planificateur cron doivent continuer à fonctionner sans
  requête entrante. Cela annule la mise à l'échelle à zéro par conception ;
  voir le tableau des pièges pour le retour en arrière axé sur les coûts.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** Le
  service s'exécute en mode web uniquement (`./docker/prod/web`) ; un job dédié au moment de
  l'apply exécute `rake db:migrate db:seed` en premier, de sorte que le conteneur web démarre
  rapidement avec un schéma migré.
- **Les sondes de santé sont TCP / désactivées.** L'autorisation d'hôte de
  Rails 8 `400` toute sonde HTTP dont l'en-tête `Host` est l'IP du pod, de
  sorte que la sonde de démarrage est TCP et la sonde de vivacité est
  désactivée.
- **La première connexion est `admin` / `admin`.** OpenProject force un
  changement de mot de passe lors de la première connexion — faites-le
  immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service OpenProject {#a-cloud-run--the-openproject-service}

OpenProject s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données d'application (projets, paquets de travail,
wikis, utilisateurs, métadonnées des pièces jointes) dans une instance gérée
Cloud SQL pour PostgreSQL 15. Sur Cloud Run, le service se connecte via l'**IP
privée de l'instance avec `sslmode=require`** (pas le socket du proxy d'authentification —
l'analyseur DSN d'URL de Ruby ne peut pas gérer le répertoire du socket). Lors du
premier déploiement, le job `db-init` crée la base de données et l'utilisateur, et
le job `db-migrate` exécute `rake db:migrate db:seed` pour construire le schéma et initialiser le compte
administrateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Filestore (stockage des pièces jointes NFS) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des paquets de travail sont stockées sur un partage NFS
**Cloud Filestore** monté à `/opt/openproject/storage` (`enable_nfs = true` par défaut) ; le module pointe
OpenProject vers celui-ci en définissant `OPENPROJECT_ATTACHMENTS__STORAGE__PATH` à `nfs_mount_path` chaque fois que NFS
est activé. Sans cela, les pièces jointes atterrissent sur le disque éphémère du
conteneur et sont perdues à chaque révision/redéploiement.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Pour utiliser un stockage d'objets compatible GCS à la place, définissez les
variables d'environnement `OPENPROJECT_FOG_*`. Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de serveur NFS.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (signature de session/cookie Rails et dérivation de clé de
colonne chiffrée). Le mot de passe de la base de données est géré séparément par
la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
ajoutés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité. OpenProject construit des URL absolues à partir de `OPENPROJECT_HOST__NAME` (défini
par le point d'entrée) et `OPENPROJECT_HTTPS = true`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des contrôles de disponibilité
et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases lors du premier
  déploiement.** Le job `db-init` (`postgres:15-alpine`) crée le rôle et la base de données ;
  le job `db-migrate` exécute ensuite l'image de l'application avec `rake db:migrate db:seed`. Le job
  de migration supprime toutes les tables partielles d'une tentative précédente
  interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant de migrer, et crée l'extension `pg_trgm` nécessaire
  aux index trigrammes d'OpenProject. Les deux jobs s'exécutent au moment de
  l'apply.
- **Les migrations ne s'exécutent pas au démarrage.** Le service s'exécute en
  mode web uniquement (`./docker/prod/web`), ce qui ignore le seeder tout-en-un. Rails
  (production) refuse de démarrer Puma tant que des migrations sont en attente,
  donc si `db-migrate` échoue, la création du service échoue bruyamment — il n'y a
  pas de déploiement silencieux avec une base de données vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une fois
  et stocké dans Secret Manager. Le modifier rend les sessions existantes et
  toutes les colonnes chiffrées illisibles. Ne le renouvelez que lors d'une
  fenêtre de maintenance planifiée avec un plan de rechiffrement complet des
  données.
- **Les jobs en arrière-plan s'exécutent en-processus.** `good_job` exécute son
  worker et son cron à l'intérieur du conteneur web (`GOOD_JOB_EXECUTION_MODE = async`) avec la file
  d'attente sur PostgreSQL — pas de Redis. C'est pourquoi le CPU est toujours
  alloué par défaut.
- **L'autorisation d'hôte protège les sondes de santé.** Rails 8 renvoie
  `400 Invalid host_name` à toute requête dont l'en-tête `Host` n'est pas `OPENPROJECT_HOST__NAME`, y compris
  les sondes de santé HTTP (qui utilisent l'IP du pod). La sonde de démarrage
  est donc TCP et la sonde de vivacité est désactivée ; la sonde de
  disponibilité atteint `/health_checks/default` où la plateforme définit correctement
  l'en-tête `Host`.
- **La première connexion est `admin` / `admin`.** Initialisée par `rake db:seed`.
  OpenProject force un changement de mot de passe lors de la première connexion.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
OpenProject sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openproject` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé à la version majeure stable `16` ; OpenProject ne publie que des tags majeurs numériques. |
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Rails a besoin de marge pour les migrations et les workers. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que le worker `good_job` en-processus + cron s'exécutent sans requêtes entrantes. |
| `min_instance_count` | `1` | Maintient une instance chaude pour les jobs en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `8080` | Port de liaison par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé sur Cloud Run** — OpenProject se connecte via TCP par IP privée. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image OpenProject dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour l'accès au navigateur et à l'API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple, les remplacements `OPENPROJECT_*`). Ne pas définir `SECRET_KEY_BASE` ou `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS provisionnés par défaut ; en ajouter d'autres pour des besoins personnalisés. |
| `enable_nfs` | `true` | Cloud Filestore pour le stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes OpenProject à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs `db-init` + `db-migrate` intégrés. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs optionnels (par exemple, un point de terminaison cron externe si vous passez au démarrage à froid). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car l'autorisation d'hôte Rails `400` les sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **désactivé** | Cloud Run n'a pas de vivacité TCP ; une sonde HTTP redémarrerait en boucle un conteneur sain. |
| `startup_probe_config` | HTTP `/`, activé, délai de 60s, failure_threshold 30 | Sonde structurée au niveau App_CloudRun (parallèle à `startup_probe`, qui est ce qui contrôle réellement le conteneur). |
| `health_check_config` | HTTP `/`, activé, délai de 60s, failure_threshold 3 | Sonde de vivacité structurée au niveau App_CloudRun (parallèle à `liveness_probe`, qui est désactivée sur le conteneur). |
| `uptime_check_config` | désactivé | Contrôle de disponibilité Cloud Monitoring ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, contrôles de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `db-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un réplica en lecture sans
> son primaire, IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée,
> un `backup_retention_days` hors de portée. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit
> créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rend chaque session existante et toutes les colonnes de base de données chiffrées illisibles. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Le désactiver place les pièces jointes sur un disque éphémère — elles sont perdues à chaque révision/redéploiement. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_cloudsql_volume` | `false` sur Cloud Run | Élevé | L'activation du socket rend le DSN de l'URL Rails impossible à analyser (les deux-points du socket cassent l'URL) ; l'application ne parvient pas à se connecter. |
| `startup_probe.type` | `TCP` | Élevé | Une sonde de démarrage HTTP atteint l'autorisation d'hôte Rails (`400 Invalid host_name`) et ne passe jamais — la révision ne devient jamais prête même si Puma est sain. |
| `liveness_probe.enabled` | `false` | Élevé | Une sonde de vivacité HTTP `400` sur l'autorisation d'hôte et redémarre en boucle un conteneur sain. |
| `memory_limit` | `4Gi` | Élevé | Les migrations et les workers en-processus OOM en dessous de ~2 GiB. |
| `cpu_always_allocated` | `true` | Moyen | Définir `false` limite le worker/cron `good_job` à ~0 entre les requêtes — les e-mails/notifications en arrière-plan stagnent. Retour en arrière uniquement avec un point de terminaison cron Cloud Scheduler externe. |
| `application_version` | Épingler une version majeure (`16`) | Moyen | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle à `16`. Épingler explicitement pour contrôler les mises à niveau. |
| `min_instance_count` | `1` | Moyen | Définir `0` uniquement avec `cpu_always_allocated = false` et un cron externe — sinon les jobs en arrière-plan s'arrêtent entre les requêtes. |
| `enable_iap` | selon les besoins | Moyen | IAP bloque tout accès non authentifié, y compris l'API ; n'activer que si c'est l'intention. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à OpenProject partagée avec la variante GKE est décrite
dans **[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenProject sur Cloud Run](../labs/OpenProject_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur GKE Autopilot](OpenProject_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration d'application partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Documenso sur Google Cloud Run](Documenso_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
