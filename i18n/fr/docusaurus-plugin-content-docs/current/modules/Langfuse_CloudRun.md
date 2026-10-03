---
title: "Langfuse sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Langfuse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Langfuse_CloudRun.md @ 15fd4c7 sha256:be881ffce507 -->

# Langfuse sur Google Cloud Run {#langfuse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_CloudRun.png" alt="Langfuse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse est une plateforme open-source, sous licence MIT, d'ingénierie et d'observabilité
LLM — traçage, gestion des invites, évaluations et métriques pour les applications
construites sur de grands modèles de langage. Ce module déploie Langfuse sur **Cloud Run v2**
sur la base [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Langfuse et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Langfuse s'exécute comme un conteneur Next.js sur Cloud Run v2. Ce module déploie la
**ligne v2** (Postgres uniquement) ; Langfuse v3 nécessite en plus ClickHouse, Redis et S3
et n'est pas couvert ici. Le déploiement connecte un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 2 vCPU / 4 GiB par défaut, autoscaling serverless |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Langfuse v2 ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket dédié provisionné automatiquement ; pas de partage NFS (Langfuse n'a pas de mode de stockage de système de fichiers) |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `SALT` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Langfuse v2 (Postgres uniquement) est épinglé.** L'image est construite `FROM langfuse/langfuse:2`
  via l'ARG de build `LANGFUSE_VERSION`. Même `application_version = "latest"` se résout en
  `2`. Le déploiement de la v3 nécessiterait ClickHouse + Redis + S3 que ce
  module ne provisionne pas.
- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur empêche le démarrage.
- **`NEXTAUTH_SECRET` et `SALT` sont générés automatiquement** et stockés dans Secret Manager.
  La validation d'environnement zod de Langfuse refuse de démarrer sans les deux — `NEXTAUTH_SECRET`
  signe les JWT de session et `SALT` hache les clés API. Les faire pivoter invalide les
  sessions / clés API stockées.
- **Les migrations Prisma s'exécutent à chaque démarrage.** Le point d'entrée cloud compose
  `DATABASE_URL` à partir des variables `DB_*` injectées, puis passe la main au démarrage
  propre de Langfuse, qui exécute `prisma migrate deploy`. Le job `db-init` ne fait que créer le rôle
  et la base de données.
- **Le premier utilisateur à s'inscrire devient le propriétaire.** `AUTH_DISABLE_SIGNUP = "false"` est
  injecté ; il n'y a pas de credential admin pré-initialisé. Désactivez l'inscription après
  l'intégration.
- **`min_instance_count = 1` avec `cpu_always_allocated = true`.** Une instance reste chaude afin que le
  traitement en arrière-plan de Langfuse (ingestion par lots, travail planifié) continue de
  s'exécuter entre les requêtes ; le CPU n'est pas throttlé à zéro au repos.
- **L'ingress public est la valeur par défaut.** `ingress_settings = "all"` afin que l'interface
  utilisateur et les points de terminaison d'ingestion/API soient accessibles par les clients
  SDK de votre application LLM. L'activation d'IAP bloquera le trafic SDK non authentifié.
- **Pas de Redis.** Langfuse v2 utilise une file d'attente et un cache basés sur PostgreSQL ;
  `enable_redis` reste `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Langfuse {#a-cloud-run--the-langfuse-service}

Langfuse s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de
requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements
sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Langfuse stocke toutes les données d'application (traces, observations, scores, invites,
utilisateurs, projets, clés API) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le
service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP
publique n'est exposée. Lors du premier déploiement, un Job d'initialisation crée le rôle
et la base de données de l'application ; Langfuse applique ensuite son schéma via `prisma migrate deploy`
au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle
de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement. Langfuse v2 conserve
toutes les données de trace et d'observabilité dans PostgreSQL ; le bucket est disponible
pour les exportations et les médias plutôt que pour l'état primaire. Langfuse n'a pas de
mode de stockage de système de fichiers, donc un partage NFS ne serait jamais écrit.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session d'authentification) et `SALT` (hache les clés
API). Les deux sont injectés comme variables d'environnement secrètes et sont requis au
démarrage. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ce qui permet l'accès public
dont les clients SDK de votre application LLM ont besoin pour POSTER des traces à l'API
d'ingestion. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor peuvent être superposés ; les paramètres d'ingress et de sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques
d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Langfuse {#3-langfuse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation
  exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy
  et crée de manière idempotente le rôle et la base de données de l'application et accorde
  les privilèges. Il ne crée **pas** de tables — le job peut être réexécuté en toute
  sécurité.
- **Migrations Prisma au démarrage.** Le point d'entrée cloud compose `DATABASE_URL` puis
  délègue au démarrage propre de Langfuse, qui exécute `prisma migrate deploy` avant de lancer le
  serveur. La mise à niveau de la version de l'application applique donc les changements de
  schéma sans étape de migration séparée — prévoyez un temps supplémentaire lors du premier
  démarrage après une mise à niveau.
- **`NEXTAUTH_SECRET` et `SALT` sont immuables après le premier démarrage.** Ils sont
  générés une fois et écrits dans Secret Manager. Changer `NEXTAUTH_SECRET` invalide toutes les
  sessions actives ; changer `SALT` invalide de manière permanente toutes les clés API
  existantes (les clients SDK reçoivent alors `401`). Ne faites pivoter que pendant
  une fenêtre de maintenance planifiée.
- **Le premier utilisateur est le propriétaire.** Lors de la première visite, la page
  d'inscription de Langfuse crée le compte initial, qui devient le propriétaire de
  l'instance (pas de credential pré-initialisé). Après l'intégration, définissez `AUTH_DISABLE_SIGNUP = "true"`
  dans `environment_variables` et appliquez via **Update** pour empêcher toute inscription
  libre-service ultérieure.
- **Points de terminaison d'ingestion.** Le `ingress_settings = "all"` par défaut permet aux clients
  SDK de votre application LLM de POSTER des traces à l'API d'ingestion publique.
  L'activation d'IAP bloque ces appels non authentifiés — désactivez IAP si les SDK doivent
  atteindre le service, ou autorisez explicitement les appelants.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont `/`
  dans `variables.tf` — et non le point de terminaison `/api/public/health` dédié de l'application,
  qui n'est pas câblé par défaut. Accordez une fenêtre généreuse au premier démarrage (la
  sonde de démarrage utilise un seuil d'échec large et un délai initial de 60s) afin que
  les migrations Prisma se terminent ; envisagez de remplacer `path` par `/api/public/health`
  pour un signal de disponibilité plus précis.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Langfuse sont listés ;
chaque autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langfuse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Langfuse Helpdesk` | Nom lisible par l'homme affiché dans la console. Texte de clone-rot restant dans `variables.tf` (Langfuse est une plateforme d'observabilité LLM, pas un centre d'aide) — remplacez par ex. `"Langfuse"` pour un nom d'affichage précis. |
| `description` | `Langfuse - Open-source helpdesk and customer support platform` | Description du service. Même texte de clone-rot restant que `display_name` — remplacez pour une description précise. |
| `application_version` | `2` | Tag de l'image Langfuse. Épinglé à la ligne v2 (Postgres uniquement). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Langfuse construit une image wrapper légère à partir de `langfuse/langfuse:2`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; minimum 2 GiB. |
| `cpu_always_allocated` | `true` | Gardez le CPU alloué pour que le traitement en arrière-plan s'exécute entre les requêtes. |
| `min_instance_count` | `1` | Garde une instance chaude pour le traitement en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `3000` | Langfuse (Next.js) écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Langfuse dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les points de terminaison d'ingestion SDK publics. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque l'ingestion SDK non authentifiée.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NEXTAUTH_SECRET`, `SALT` ou `DATABASE_URL` ici — ils sont gérés par le module. Définissez `AUTH_DISABLE_SIGNUP = "true"` ici après l'intégration. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner. |
| `enable_nfs` | `false` | Laisser désactivé : Langfuse n'a pas de mode de stockage de système de fichiers, donc le partage n'est jamais utilisé, et un serveur NFS inaccessible bloquerait le démarrage. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Langfuse nécessite PostgreSQL. |
| `db_name` | `langfuse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `langfuse` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler planifié + Cloud Run Jobs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, seuil d'échec large | Sonde de démarrage. Accordez un temps généreux pour les migrations Prisma au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 utilise une file d'attente et un cache basés sur PostgreSQL — laissez `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisé uniquement si externalisation vers Redis. |

### Groupe 22 — VPC Service Controls et audit logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP
> sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, une
> `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days`
> hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire
> et nommée avant la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `SALT` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide de manière permanente toutes les clés API existantes — chaque client SDK les utilisant reçoit `401` jusqu'à ce qu'elles soient re-clés. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de trace. |
| `application_version` | `2` (ligne v2) | Critique | La définition d'un tag v3 pointe la build vers une image nécessitant ClickHouse + Redis + S3 que ce module ne provisionne pas — le service ne démarre pas. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans sauvegarde valide fait échouer le job d'importation. |
| `memory_limit` | `4Gi` (≥ 2Gi) | Élevé | En dessous de 2 GiB, le serveur Next.js de Langfuse subit des OOM-kills lors des migrations au premier démarrage ou sous charge d'ingestion. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque tous les appels d'ingestion SDK externes. |
| `enable_iap` | uniquement lorsque l'ingestion SDK n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion de traces SDK. |
| `AUTH_DISABLE_SIGNUP` (auto-injecté `"false"`) | Désactiver après le premier propriétaire | Élevé | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) arrête le traitement en arrière-plan et ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `cpu_always_allocated` | `true` | Moyen | La facturation basée sur les requêtes limite le traitement en arrière-plan à ~0 CPU entre les requêtes. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et les points de terminaison d'ingestion sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Langfuse
partagée avec la variante GKE est décrite dans **[Langfuse_Common](Langfuse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Langfuse sur Cloud Run](../labs/Langfuse_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Langfuse sur GKE Autopilot](Langfuse_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Langfuse Common — Configuration d'application partagée](Langfuse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Assistant IA privé**.
