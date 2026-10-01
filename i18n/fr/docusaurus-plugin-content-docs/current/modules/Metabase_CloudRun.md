---
title: "Metabase sur Google Cloud Run"
description: "Référence de configuration pour déployer Metabase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Metabase_CloudRun.md @ 3055034 sha256:4f8bf5214c6a -->

# Metabase sur Google Cloud Run {#metabase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Metabase_CloudRun.png" alt="Metabase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Metabase est une plateforme open source de business intelligence et d'analyse qui
permet à des utilisateurs non techniques d'interroger, de visualiser et de partager des
données sans écrire de SQL. Ce module déploie Metabase sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Metabase et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Metabase s'exécute comme un conteneur Java/JVM (Jetty) sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service JVM, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Metabase stocke tout l'état de l'application (questions, tableaux de bord, utilisateurs) dans PostgreSQL |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement ; Metabase gère ses propres clés internes |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge.** Tout l'état de l'application
  réside dans cette base de données.
- **Aucun Redis n'est requis.** Metabase n'utilise pas Redis ; `enable_redis` vaut
  `false` par défaut.
- **`min_instance_count` vaut `0` par défaut (réduction à zéro).** Les démarrages à froid
  de la JVM prennent 60 à 120 secondes. Définissez-le sur `1` en production pour éliminer
  cette latence.
- **`cpu_always_allocated` vaut `false` par défaut (facturation à la requête).** Metabase
  sert les requêtes interactives à la demande, donc le processeur n'est facturé que
  pendant le traitement d'un appel. Si vous vous appuyez sur des **abonnements/pulses
  planifiés ou des analyses périodiques de synchronisation de bases de données**, ce
  travail s'exécute sans requête entrante et se trouve bridé avec la facturation à la
  requête — définissez `cpu_always_allocated = true` pour que les tâches planifiées
  aboutissent réellement.
- **Les sondes de santé ciblent `/api/health`** (HTTP), qui ne renvoie 200 qu'une fois
  la JVM complètement démarrée. La sonde de démarrage utilise un délai initial de
  120 secondes avec 15 tentatives, soit une tolérance totale d'environ 270 secondes.
- **`MB_JETTY_PORT = "3000"` et `JAVA_TIMEZONE = "UTC"` sont injectés
  automatiquement** — ne les remplacez pas.
- **Aucun bucket de stockage GCS n'est créé par défaut.** Metabase stocke tout dans
  PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service
et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Metabase {#a-cloud-run--the-metabase-service}

Metabase s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs. Avec `min_instance_count = 0`, le
service se réduit à zéro en période d'inactivité ; les démarrages à froid de la JVM
prennent 60 à 120 secondes, définissez donc `min_instance_count = 1` en production.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Metabase stocke l'intégralité de l'état de son application — questions, tableaux de bord,
collections, utilisateurs, autorisations et paramètres — dans une instance gérée Cloud SQL
for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth
Proxy** sur un socket Unix (pas d'adresse IP publique). Lors du premier déploiement, une
tâche d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le
service à l'exécution. Metabase gère séparément ses propres clés de chiffrement internes.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'ingress et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs (y compris la sortie de la JVM) sont envoyés à Cloud
Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à Cloud Monitoring,
avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Metabase {#3-metabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation s'exécute avant le démarrage du service. Elle utilise
  `postgres:15-alpine` pour se connecter à Cloud SQL et créer de manière idempotente la
  base de données et l'utilisateur de l'application. Elle peut être relancée sans risque.
- **Aucune migration automatique au démarrage.** Metabase applique les migrations dans le
  cadre de son propre processus de démarrage — la tâche `db-init` doit d'abord réussir
  pour que la base de données et l'utilisateur existent déjà lorsque Metabase démarre.
- **Prudence lors des mises à niveau.** Les migrations de Metabase sont à sens unique.
  Revenir à une version antérieure après l'exécution d'une migration corrompt le schéma.
  Testez toujours les mises à niveau en préproduction avant de les appliquer en
  production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`
  (HTTP 200 lorsque la JVM est complètement initialisée). La sonde de démarrage autorise
  un délai initial de 120 secondes plus 15 tentatives × 10s (environ 270 secondes au
  total). Ne réduisez pas ces valeurs.
- **Configuration de l'administrateur.** Au premier démarrage, Metabase présente un
  assistant de configuration dans le navigateur. Les identifiants administrateur sont
  gérés dans Metabase lui-même — ce module ne crée aucun secret administrateur.
- **Sources de données.** Après le déploiement, configurez les sources de données dans
  Metabase Admin → Databases. Les sources natives GCP courantes incluent BigQuery,
  Cloud SQL PostgreSQL/MySQL et Google Sheets.
- **`MB_JETTY_PORT` et `JAVA_TIMEZONE` sont fixés.** Ils sont injectés automatiquement
  par `Metabase_Common`. Les remplacer casse le routage ou produit des horodatages de
  rapports incohérents.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Metabase ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `metabase` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Metabase Analytics` | Nom convivial affiché dans la console. |
| `description` | `Metabase — open-source business intelligence and analytics platform` | Description du service. |
| `application_version` | `v0.51.3` | Tag de version de l'image Metabase. **Ne revenez jamais à une version antérieure** — les migrations sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | Processeur par instance ; 1 vCPU minimum, 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; la JVM requiert au moins 2 GiB ; 4 GiB recommandés en production. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez-le sur `1` en production pour éliminer les démarrages à froid de la JVM de 60 à 120s. |
| `max_instance_count` | `3` | Nombre maximal d'instances (plafond de coût). |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut — Metabase sert à la demande. Définissez `true` si vous vous appuyez sur des abonnements/pulses planifiés ou des analyses périodiques de synchronisation de bases de données, qui s'exécutent sans requête entrante et seraient sinon bridés. |
| `container_port` | `3000` | Port Jetty de Metabase — doit correspondre à `MB_JETTY_PORT`. |
| `execution_environment` | `gen2` | Gen2 recommandé pour de meilleures performances au démarrage. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket Unix. Obligatoire. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les requêtes analytiques de longue durée. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. Utilisez `internal-and-cloud-load-balancing` en production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Manière dont le trafic sortant est acheminé via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MB_JETTY_PORT` et `JAVA_TIMEZONE` sont injectés automatiquement — ne les remplacez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (par exemple, mot de passe SMTP). |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et NFS {#group-9--custom-sql-scripts--nfs}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Stockage NFS — non requis pour Metabase. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend du LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS lorsque `storage_buckets` n'est pas vide. |
| `storage_buckets` | `[]` | Vide par défaut — Metabase n'a pas besoin de stockage d'objets. |
| `enable_nfs` | `false` | Le stockage NFS n'est pas requis pour Metabase. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé — ne le modifiez pas. Metabase requiert PostgreSQL. |
| `db_name` | `metabase` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `metabase` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init` (création de la base de données PostgreSQL et de l'utilisateur). |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | `/api/health`, délai initial de 120s, seuil d'échec de 15 | Sonde de démarrage HTTP ; tolérance totale d'environ 270s pour la JVM. Ne la réduisez pas. |
| `liveness_probe` | `/api/health`, délai initial de 120s, seuil d'échec de 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Test de disponibilité Cloud Monitoring. Activez-le pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Metabase n'utilise pas Redis ; laissez-le désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | _(défini)_ | Pertinent uniquement si un plugin ou une configuration personnalisée requiert Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Metabase requiert PostgreSQL ; tout autre moteur empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver casse toutes les connexions à la base de données (le sidecar Auth Proxy est requis). |
| `memory_limit` | `4Gi` | Critical | En dessous de 2 GiB, la JVM plante avec une OutOfMemoryError au démarrage. |
| `db_name` / `db_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données de l'application. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `application_version` | à incrémenter avec prudence | Critical | Les migrations de Metabase sont à sens unique ; revenir à une version antérieure corrompt le schéma. |
| `startup_probe.failure_threshold` | `15` (≥ 15) | High | Le réduire provoque l'arrêt prématuré du conteneur avant que la JVM n'ait terminé son démarrage. |
| `min_instance_count` | `1` en production | High | `0` entraîne des démarrages à froid de 60 à 120s ; échecs de la sonde de démarrage à la première requête. |
| `cpu_limit` | `2000m` | High | En dessous de 500m, la compilation JIT de la JVM bloque le démarrage et déclenche des échecs de sonde. |
| `cpu_always_allocated` | `true` si vous utilisez des abonnements/pulses planifiés ou des analyses de synchronisation de bases de données | Medium | Vaut `false` par défaut (facturation à la requête) ; les abonnements/pulses planifiés et les analyses de synchronisation s'exécutent sans requête entrante et sont bridés à un processeur quasi nul, ils risquent donc de ne pas aboutir à moins de passer la valeur à `true`. |
| `enable_iap` / `ingress_settings` | IAP activé ; `internal-and-cloud-load-balancing` | High | Sinon, la page de connexion de Metabase est joignable publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `timeout_seconds` | `300` | Medium | Une valeur inférieure à 120s interrompt les requêtes analytiques en cours. |
| `enable_auto_password_rotation` | `false` | Medium | L'activer sans `rotation_propagation_delay_sec` suffisant provoque de brèves erreurs 500 pendant la rotation. |
| `enable_redis` | `false` | Low | Metabase n'utilise pas Redis ; l'activer n'a aucun effet. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise
à l'échelle et simultanéité, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Metabase
partagée avec la variante GKE est décrite dans
**[Metabase_Common](Metabase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Metabase sur Cloud Run](../labs/Metabase_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Metabase sur GKE Autopilot](Metabase_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Metabase Common — Configuration applicative partagée](Metabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Odoo sur Cloud Run](Odoo_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Integrated ERP Platform**.
