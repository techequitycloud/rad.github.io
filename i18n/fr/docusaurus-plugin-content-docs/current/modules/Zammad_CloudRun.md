---
title: "Zammad sur Google Cloud Run"
description: "Référence de configuration pour déployer Zammad sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Zammad_CloudRun.md @ 3055034 sha256:1bd8164bb34e -->

# Zammad sur Google Cloud Run {#zammad-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zammad_CloudRun.png" alt="Zammad sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zammad est une plateforme open source de helpdesk et de support client — une
alternative conforme au RGPD à Zendesk et Freshdesk. Ce module déploie Zammad sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Zammad et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zammad s'exécute sous forme de conteneur Ruby on Rails (railsserver) sur Cloud Run
v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique en fonction des requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Zammad ne prend pas en charge MySQL |
| Stockage des pièces jointes | Filestore (NFS) | Pièces jointes des tickets dans `/opt/zammad/storage`, partagées entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket `zammad-attachments` dédié, toujours provisionné |
| Cache et file de tâches | Redis | Activé par défaut ; requis pour le pub/sub WebSocket d'ActionCable et pour Sidekiq |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** MySQL n'est pas pris en charge et est rejeté lors du plan.
- **Redis est obligatoire.** Zammad utilise Redis pour les mises à jour des tickets en
  temps réel (ActionCable) et le traitement des tâches en arrière-plan (Sidekiq). Sans
  lui, Zammad ne démarre pas.
- **Une image personnalisée est construite via Cloud Build.** `container_image_source = "custom"`
  est la valeur par défaut — Cloud Build enveloppe l'image officielle `zammad/zammad`
  de Docker Hub avec un `entrypoint.sh` spécifique à GCP qui fait correspondre les
  variables `DB_*` du socle à la convention `POSTGRESQL_*` de Zammad.
- **La sonde de démarrage cible `/`.** Zammad n'y renvoie HTTP 200 qu'une fois
  entièrement initialisé. La sonde est volontairement tolérante (seuil de 30 échecs)
  pour laisser le temps à la migration du schéma au premier démarrage.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance**
  (de manière idempotente via `zammad-init`), si bien que les mises à niveau de
  version appliquent automatiquement les modifications de schéma.
- `min_instance_count = 0` est la valeur par défaut (mise à l'échelle à zéro) ;
  passez-la à `1` pour éliminer les démarrages à froid de 60 à 90 secondes sur un
  helpdesk de production.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Zammad {#a-cloud-run--the-zammad-service}

Zammad s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zammad stocke toutes les données du helpdesk (tickets, utilisateurs, canaux,
enregistrements de SLA) dans une instance gérée Cloud SQL for PostgreSQL 15. Le
service s'y connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix —
aucune adresse IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application. À chaque
démarrage d'instance ultérieur, `zammad-init` applique les migrations de schéma en
attente.

**Contournement TCP pour Cloud Run :** le `docker-entrypoint.sh` de Zammad vérifie que
PostgreSQL est prêt au moyen d'un socket TCP bash. Comme le `DB_HOST` de Cloud Run est
un chemin de socket Unix (non adressable en TCP), le `entrypoint.sh` personnalisé
utilise à la place l'adresse IP privée de Cloud SQL (`DB_IP`) pour cette vérification.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les pièces jointes des tickets et les fichiers téléversés sont écrits sur un partage
**Filestore (NFS)** monté sur `/opt/zammad/storage` dans le service, de sorte que
toutes les instances partagent les mêmes fichiers. Un bucket **Cloud Storage**
dédié (`zammad-attachments`) est également provisionné automatiquement.
L'environnement d'exécution Gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis et file de tâches {#d-redis-cache-and-job-queue}

Redis est obligatoire pour Zammad et remplit deux rôles essentiels :

1. **Pub/sub ActionCable** — transmet les mises à jour des tickets en temps réel aux
   agents répartis sur plusieurs instances Cloud Run.
2. **Sidekiq** — traite les tâches en arrière-plan (envoi d'e-mails, notifications de
   SLA, synchronisation LDAP, tâches du planificateur).

Lorsqu'aucun `redis_host` externe n'est configuré et que NFS est activé, l'adresse IP
de l'hôte NFS est utilisée comme point de terminaison Redis. En production, utilisez
une instance dédiée Google Cloud Memorystore for Redis et définissez
`vpc_egress_setting = "ALL_TRAFFIC"` afin que Cloud Run puisse atteindre son adresse IP
privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans
le service à l'exécution. Zammad gère ses propres clés de signature internes — ce
module ne génère automatiquement aucun secret au niveau de l'application.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus. Lorsque vous utilisez Memorystore for Redis, `vpc_egress_setting` doit
valoir `"ALL_TRAFFIC"` afin que les connexions Redis soient acheminées via le VPC.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Zammad {#3-zammad-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) s'exécute avant le démarrage du service. Il se connecte
  à Cloud SQL via l'Auth Proxy et crée de manière idempotente la base de données
  Zammad, l'utilisateur et les privilèges. Il peut être relancé sans risque.
- **Migrations à chaque démarrage.** Le `entrypoint.sh` personnalisé appelle
  `zammad-init` (migration + seed de la base Rails) avant de lancer le railsserver à
  chaque démarrage d'instance. Les migrations en attente sont appliquées ; celles déjà
  exécutées sont ignorées.
- **Pont entre variables.** Le module socle injecte les identifiants de la base de
  données sous la forme `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. Le `entrypoint.sh`
  personnalisé les fait correspondre à la convention `POSTGRESQL_*` de Zammad et
  utilise `DB_IP` (adresse IP privée de Cloud SQL) pour le test de
  disponibilité TCP, car le `DB_HOST` de Cloud Run est un chemin de socket Unix.
- **Connectivité WebSocket — la diffusion en temps réel ne fonctionne pas réellement
  sur Cloud Run.** Le processus `zammad-websocket` (ActionCable) démarre sur le port
  6042 à côté du railsserver, mais Cloud Run n'expose que le seul `container_port`
  déclaré — les clients ne peuvent pas joindre directement le port 6042, si bien que
  la négociation ActionCable du navigateur n'aboutit jamais. L'interface se rabat
  alors proprement sur l'interrogation périodique (documenté dans
  `Zammad_Common/scripts/entrypoint.sh`). `enable_redis = true` reste obligatoire, car
  Sidekiq (tâches en arrière-plan — récupération des e-mails, escalades, calculs de
  SLA) en dépend, que ActionCable soit joignable ou non.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui ne
  renvoie HTTP 200 que lorsque Zammad est entièrement initialisé. La sonde de
  démarrage autorise jusqu'à 510 secondes au total (délai initial de 60 secondes,
  30 tentatives à intervalles de 15 secondes) pour laisser le temps à la migration du
  schéma au premier démarrage.
- **Intégration e-mail.** Configurez SMTP après la première connexion dans **Admin →
  Channels → Email**. Les identifiants SMTP peuvent être injectés via
  `secret_environment_variables`.
- **Inspecter les jobs planifiés :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Zammad ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `elasticsearch_url` | `""` | Point de terminaison HTTP Elasticsearch pour la recherche en texte intégral. Laissez vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laissez vide lorsque la sécurité est désactivée. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zammad` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Zammad Helpdesk` | Nom convivial affiché dans la console. |
| `description` | _(définie)_ | Description du service. |
| `application_version` | `6.4.1` | Tag de version de l'image Zammad ; incrémentez-le pour déclencher un nouveau build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build (requis pour le point d'entrée GCP) ; `prebuilt` ignore le build. |
| `container_image` | `""` | Remplace l'URI de l'image du conteneur. Laissez vide pour laisser Cloud Build la gérer. |
| `cpu_limit` | `2000m` | CPU par instance. 2 vCPU minimum pour Zammad. |
| `memory_limit` | `4Gi` | Mémoire par instance. Minimum 2 GiB ; 4 GiB recommandés. |
| `container_port` | `3000` | Port du railsserver Zammad. Doit correspondre à `ZAMMAD_RAILSSERVER_PORT`. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût au démarrage à froid. `false` réduit le CPU à ~0 entre les requêtes, ce qui arrête le planificateur Sidekiq intégré au processus (déclencheurs, escalades) et ActionCable. Définissez `true` (avec `min_instance_count >= 1`) pour rétablir un fonctionnement continu. |
| `min_instance_count` | `0` | Nombre minimal d'instances (mise à l'échelle à zéro). Définissez ≥ 1 pour éviter les démarrages à froid sur un helpdesk de production. |
| `max_instance_count` | `5` | Nombre maximal d'instances (plafond de coût). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. Ne le désactivez pas. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Docker Hub de Zammad dans Artifact Registry avant le déploiement. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Utilisez `ALL_TRAFFIC` lorsque Redis est hébergé sur Memorystore (adresse IP privée). |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `POSTGRESQL_*` et `RAILS_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple pour les mots de passe SMTP). |
| `explicit_secret_values` | `{}` | Valeurs sensibles à stocker et à injecter en tant que secrets. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge (adapté uniquement aux ressources statiques). |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le stockage des pièces jointes de Zammad. Requiert Gen2. |
| `nfs_mount_path` | `/opt/zammad/storage` | Chemin de montage dans le conteneur. Doit correspondre à la configuration de stockage de Zammad. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(définies)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `zammad-attachments` est toujours créé. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Zammad requiert PostgreSQL. |
| `db_name` | `zammad` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `zammad` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Une liste non vide le remplace entièrement. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. Zammad gère sa propre planification interne ; ajoutez ici vos jobs de maintenance personnalisés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/`, délai de 60 s, 30 tentatives | Tolérance généreuse pour la migration du schéma au premier démarrage. |
| `liveness_probe` / `health_check_config` | `/`, délai de 60 s | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring ciblant `/` ; définissez `enabled = true` pour le provisionner. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis et file de tâches {#group-21--redis-cache--job-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Utilise Redis pour ActionCable et Sidekiq. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP de l'hôte NFS ; définissez-le explicitement pour Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `zammad-attachments`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High**
> (élevé : service dégradé) — **Medium** (moyen : coût ou dégradation partielle) —
> **Low** (faible : mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Zammad requiert PostgreSQL ; MySQL est rejeté lors du plan. |
| `container_image_source` | `custom` (par défaut) | Critical | Utiliser `prebuilt` sans le point d'entrée personnalisé signifie que la correspondance `DB_*` → `POSTGRESQL_*` n'a pas lieu et que toutes les connexions à la base de données échouent au démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver supprime le socket de l'Auth Proxy ; toutes les connexions à la base de données échouent. |
| `db_name` / `db_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données / l'utilisateur et détruit toutes les données du helpdesk. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans sauvegarde valide fait échouer le job d'import ; l'activer à chaque apply écrase les données en production. |
| `enable_redis` | `true` | Critical | Sans Redis, ActionCable et Sidekiq ne parviennent pas à s'initialiser ; Zammad ne démarre pas. |
| `redis_host` | explicite ou adresse IP NFS | Critical | Vide avec NFS désactivé, aucun point de terminaison Redis valide n'existe — Zammad ne démarre pas. |
| `memory_limit` | `4Gi` | High | En dessous de 2 GiB, Zammad manque de mémoire (OOM) pendant la migration du schéma ou sous charge. |
| `nfs_mount_path` | `/opt/zammad/storage` | High | Le modifier entraîne l'écriture des pièces jointes sur le stockage éphémère de l'instance ; les pièces jointes NFS existantes deviennent inaccessibles. |
| `enable_nfs` | `true` | High | Sans NFS, toutes les pièces jointes téléversées sont perdues au redémarrage de l'instance. |
| `cpu_always_allocated` | `true` en production | High | La valeur par défaut `false` (privilégiant le coût au démarrage à froid) réduit le CPU à ~0 entre les requêtes, ce qui arrête le planificateur Sidekiq intégré au processus (déclencheurs, escalades) et ActionCable. Définissez `true` avec `min_instance_count >= 1` pour un helpdesk de production qui doit traiter en continu les événements temporisés. |
| `min_instance_count` | `1` | High | `0` (la valeur par défaut) provoque des démarrages à froid de 60 à 90 secondes pour le premier agent qui ouvre un ticket. |
| ActionCable / port 6042 | non configurable par l'opérateur | Medium | Les mises à jour des tickets en temps réel par WebSocket ne fonctionnent jamais sur Cloud Run, quels que soient les paramètres `enable_redis`/`session` — seul le `container_port` déclaré est joignable, si bien que la négociation ActionCable du navigateur ne peut pas atteindre le port 6042. L'interface se rabat proprement sur l'interrogation périodique ; ne comptez pas sur les notifications push en direct. |
| `vpc_egress_setting` | `ALL_TRAFFIC` avec Memorystore | High | L'adresse IP privée de Memorystore Redis peut être injoignable avec `PRIVATE_RANGES_ONLY` ; les connexions Redis sont refusées. |
| `startup_probe.initial_delay_seconds` | `60` (ou plus) | High | Une valeur trop courte provoque des boucles de redémarrage pendant la migration du schéma au premier démarrage. |
| `max_instance_count` > 1 sans Redis | configurez d'abord Redis | Medium | Plusieurs instances sans Redis provoquent des situations de concurrence sur l'attribution des tickets et une divergence de l'état en temps réel. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'administration | Medium | Sinon, l'interface d'administration de Zammad est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `enable_cdn` | désactivé (par défaut) | Medium | Les réponses de l'API de Zammad sont dynamiques ; la mise en cache CDN casse les listes de tickets et les vues en temps réel, sauf si des en-têtes `Cache-Control: no-cache` sont définis. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Zammad, partagée avec la variante GKE, est décrite dans
**[Zammad_Common](Zammad_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zammad sur Cloud Run](../labs/Zammad_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Zammad sur GKE Autopilot](Zammad_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zammad Common — configuration applicative partagée](Zammad_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), de [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md), de [BookStack sur Google Cloud Run](BookStack_CloudRun.md) et de [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) dans la solution **IT Service Desk**.
