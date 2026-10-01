---
title: "Grafana sur Google Cloud Run"
description: "Référence de configuration pour déployer Grafana sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Grafana_CloudRun.md @ 3055034 sha256:53fc0b456560 -->

# Grafana sur Google Cloud Run {#grafana-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grafana_CloudRun.png" alt="Grafana sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana est la principale plateforme open source d'observabilité et d'analyse au
monde, utilisée par 10M+ utilisateurs dans des organisations telles que la
NASA, le CERN et Goldman Sachs. Elle fournit des tableaux de bord, des alertes et des
visualisations unifiés pour les métriques, les journaux et les traces issus de plus
de 100 sources de données. Ce module déploie Grafana sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Grafana et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Grafana s'exécute sous la forme d'un conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Grafana nécessite une base de données relationnelle ; SQLite n'est pas sûr pour les déploiements multi-instances |
| Stockage objet | Cloud Storage | Un bucket `grafana-data` provisionné automatiquement |
| Stockage partagé facultatif | Filestore (NFS) | Désactivé par défaut ; activez-le pour partager des tableaux de bord ou des plugins entre les instances |
| Cache facultatif | Redis | Désactivé par défaut ; peut être activé pour le stockage des sessions |
| Secrets | Secret Manager | Mot de passe de la base de données géré par le socle ; identifiants administrateur injectés via une variable d'environnement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Grafana conserve les tableaux de bord, les
  utilisateurs, les alertes et l'état des plugins dans une base de données
  relationnelle. SQLite utilise un verrouillage de fichier qui ne résiste pas aux
  écritures concurrentes de plusieurs instances ; le module impose PostgreSQL.
- **`GF_DATABASE_TYPE=postgres` est injecté automatiquement.** Sans lui, Grafana
  revient à SQLite même lorsque toutes les autres variables `GF_DATABASE_*` sont
  présentes.
- **Aucun job d'initialisation de la base de données n'est nécessaire.** Grafana
  migre automatiquement son schéma au premier démarrage lorsqu'il se connecte à
  l'instance PostgreSQL provisionnée.
- **Le mot de passe administrateur n'est PAS généré automatiquement.** Grafana est
  livré avec les valeurs par défaut `admin`/`admin`. Vous devez injecter un mot de
  passe robuste via `secret_environment_variables` avant le premier déploiement.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Ne l'activez que lorsque
  plusieurs instances doivent partager des plugins ou des modèles de tableaux de bord
  personnalisés sur un système de fichiers partagé ; nécessite
  `execution_environment = "gen2"`.
- **Redis est désactivé par défaut** (`enable_redis = false`). Il n'est pas requis
  pour les fonctions de base de Grafana.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Grafana {#a-cloud-run--the-grafana-service}

Grafana s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

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

Grafana stocke toutes les données de l'application (tableaux de bord, utilisateurs,
organisations, règles d'alerte, état des plugins) dans une instance gérée Cloud SQL
for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth
Proxy** sur un socket Unix. Grafana migre automatiquement son schéma au démarrage —
aucun job d'initialisation distinct n'est requis.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié `grafana-data` est provisionné automatiquement par
Grafana_Common. Des buckets GCS supplémentaires peuvent être déclarés via
`storage_buckets`, et des volumes GCS Fuse peuvent être montés dans le service via
`gcs_volumes` (nécessite l'environnement d'exécution Gen2).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<grafana-data-bucket>/    # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse, CMEK et les règles de cycle
de vie.

### D. Filestore (NFS) — facultatif {#d-filestore-nfs--optional}

Lorsque `enable_nfs = true`, un partage NFS **Filestore** est provisionné et monté
dans le service. C'est utile lorsque plusieurs instances doivent partager des plugins
Grafana ou des modèles de tableaux de bord personnalisés. NFS est désactivé par défaut
car l'état persistant de Grafana réside dans PostgreSQL. Nécessite l'environnement
d'exécution Gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans
le service à l'exécution. Le mot de passe administrateur de Grafana n'est pas généré
automatiquement — injectez-le via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Create the admin password secret:
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus. `ingress_settings` et `vpc_egress_setting` déterminent quelles sources de
trafic peuvent atteindre le service et comment le trafic sortant est acheminé.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring. Grafana expose `/api/health`
comme point de terminaison de santé, ciblé à la fois par les sondes de démarrage et de
vivacité, ainsi que par un test de disponibilité facultatif.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Grafana {#3-grafana-application-behaviour}

- **Migration du schéma au démarrage.** Grafana se connecte à PostgreSQL et applique
  les éventuelles migrations de schéma en attente au premier démarrage. Aucune Cloud
  Run Job distincte n'est requise. La sonde de démarrage accorde une tolérance totale
  d'environ 150 secondes (`initial_delay_seconds=30`, `failure_threshold=12`,
  `period_seconds=10`).
- **Identifiant administrateur.** Grafana est livré avec les identifiants par défaut
  `admin`/`admin`. Vous devez injecter un mot de passe robuste avant le premier
  déploiement :
  ```bash
  gcloud secrets create grafana-admin-password \
    --replication-policy="automatic" --project "$PROJECT"
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  # Then set: secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }
  ```
- **`GF_DATABASE_TYPE` est injecté automatiquement.** Le module impose
  `GF_DATABASE_TYPE=postgres` dans l'environnement. Ne le remplacez pas dans
  `environment_variables`.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent
  toutes deux `/api/health`, qui renvoie HTTP 200 lorsque Grafana et sa connexion à la
  base de données sont opérationnels. Un test de disponibilité sur ce chemin est
  activé par défaut.
- **Aucune tâche planifiée requise.** Grafana n'a aucun CronJob obligatoire. Des
  tâches facultatives déclenchées par Cloud Scheduler (par ex. export d'instantanés,
  nettoyage) peuvent être ajoutées via `cron_jobs`.
- **Accès aux données via GCS Fuse.** Le bucket `grafana-data` est provisionné
  automatiquement ; il peut être monté en tant que volume GCS Fuse pour un accès direct
  au système de fichiers via `gcs_volumes`. Inspectez les tâches planifiées :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Grafana ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grafana` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Grafana Dashboards` | Nom convivial affiché dans la console. |
| `description` | `Grafana - Open-source observability and analytics platform` | Description du service. |
| `application_version` | `11.4.0` | Tag de version de l'image Grafana. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; Grafana charge les tableaux de bord en mémoire. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Mise à l'échelle à zéro par défaut — le cœur de Grafana fonctionne en requête/réponse, il ne coûte donc rien lorsqu'il est inactif, au prix d'un démarrage à froid. Définissez `1` (avec `cpu_always_allocated = true`) si vous activez les alertes unifiées internes au processus, qui doivent évaluer les règles sans requête entrante. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `3000` | Grafana écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Grafana dans Artifact Registry avant le déploiement. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut. Ne définissez `true` que si l'évaluation des règles d'alerte interne au processus est activée, afin qu'elle puisse s'exécuter selon sa planification sans requête entrante. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Vivement recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GF_*` non secrets supplémentaires. `GF_DATABASE_TYPE=postgres` est injecté automatiquement — ne le remplacez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour injecter `GF_SECURITY_ADMIN_PASSWORD`. |
| `secret_propagation_delay` / `secret_rotation_period` | _(définies)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
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
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires (le bucket `grafana-data` est toujours créé). |
| `enable_nfs` | `false` | Volume Filestore partagé — à activer lorsque les instances doivent partager des plugins ou des modèles. Nécessite Gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite Gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas ; PostgreSQL est obligatoire. |
| `db_name` | `grafana` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `grafana` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les informations de connexion sont exposées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — Grafana migre automatiquement son schéma au démarrage. |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrentes facultatives déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/api/health`, HTTP, délai de 30 s, 12 échecs | Sonde de démarrage HTTP sur le point de terminaison de santé de Grafana. |
| `liveness_probe` | `/api/health`, HTTP, délai de 60 s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Test de disponibilité Cloud Monitoring. À activer pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage des sessions. Désactivé par défaut — non requis pour les fonctions de base. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS lorsque NFS est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `grafana-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | secret robuste | Critique | Grafana est livré avec les valeurs par défaut `admin`/`admin`. Déployer sans définir de mot de passe robuste expose l'interface d'administration. |
| `GF_AUTH_ANONYMOUS_ENABLED` (via `environment_variables`) | `false` (par défaut) | Critique | La valeur `"true"` expose tous les tableaux de bord aux utilisateurs non authentifiés. |
| `database_type` | `POSTGRES_15` | Critique | PostgreSQL est obligatoire ; le remplacer par SQLite entraîne une perte de données à chaque nouvelle révision — le fichier SQLite réside sur un disque éphémère. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `GF_SERVER_ROOT_URL` (via `environment_variables`) | URL publique | Élevé | Sans elle, les redirections OAuth, les liens des notifications par e-mail et les iframes pointent vers la mauvaise origine et ne fonctionnent plus. |
| `enable_iap` | `true` pour un usage interne | Élevé | Sans IAP, la page de connexion de Grafana est accessible publiquement sur Internet. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512Mi, Grafana subit un OOM au démarrage avec des ensembles de tableaux de bord volumineux. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro ajoute une latence de démarrage à froid et risque de faire manquer des évaluations d'alertes pendant la fenêtre de démarrage. |
| `max_instance_count` | `1`–`3` | Moyen | Plusieurs instances partagent PostgreSQL mais pas l'état des alertes en mémoire — des alertes peuvent être déclenchées en double. |
| `enable_redis` | `false` (par défaut) | Faible | L'activer sans `redis_host` valide provoque une erreur de validation au moment du plan. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `ingress_settings` | `internal-and-cloud-load-balancing` pour un usage privé | Élevé | La valeur par défaut `all` autorise le trafic de n'importe quelle source ; restreignez-la pour les déploiements uniquement internes. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Grafana partagée avec la variante GKE est décrite dans
**[Grafana_Common](Grafana_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Grafana sur Cloud Run](../labs/Grafana_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Grafana sur GKE Autopilot](Grafana_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grafana Common — Configuration applicative partagée](Grafana_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observability & On-call**.
