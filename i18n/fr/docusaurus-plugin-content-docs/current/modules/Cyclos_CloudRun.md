---
title: "Cyclos sur Google Cloud Run"
description: "Référence de configuration pour déployer Cyclos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Cyclos_CloudRun.md @ 3055034 sha256:7e48ca314d5f -->

# Cyclos sur Google Cloud Run {#cyclos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_CloudRun.png" alt="Cyclos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cyclos est une plateforme bancaire et de paiement riche en fonctionnalités, utilisée par les institutions de microfinance,
les coopératives de crédit et les réseaux de monnaies complémentaires. Ce module déploie Cyclos sur **Cloud
Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Cyclos et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute
application Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cyclos s'exécute comme un conteneur Java/Tomcat sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Java/Tomcat, 1 vCPU / 2 GiB par défaut (à augmenter en production), mise à l'échelle automatique en fonction des requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cyclos ne prend pas en charge MySQL ni SQL Server |
| Stockage d'objets | Cloud Storage | Un bucket de stockage de fichiers dédié (`<prefix>-cyclos-storage`) pour les fichiers et médias téléversés |
| Secrets | Secret Manager | Mot de passe de base de données généré automatiquement ; `ROOT_PASSWORD` pour l'installation des extensions en superutilisateur |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Cyclos exige six extensions PostgreSQL précises
  (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL et
  SQL Server ne sont pas pris en charge.
- **Les extensions PostgreSQL sont installées automatiquement** par la tâche `db-init` avant le
  démarrage de Cyclos — vous n'avez pas besoin de les activer manuellement.
- **Le stockage de fichiers GCS est obligatoire.** Cyclos utilise Google Cloud Storage comme gestionnaire
  de contenu de fichiers (`cyclos.storedFileContentManager = gcs`). Le nom du bucket est injecté
  automatiquement.
- **`enable_cloudsql_volume` vaut `false` par défaut.** Cyclos se connecte à Cloud SQL en
  TCP direct vers l'adresse IP privée, et non via le socket Unix de l'Auth Proxy.
- **`max_instance_count` vaut 1 par défaut.** Cyclos Community Edition exige une configuration
  Hazelcast pour évoluer horizontalement. N'augmentez cette valeur qu'après avoir configuré le clustering.
- **Sonde de démarrage TCP.** La sonde de démarrage utilise TCP sur le port 8080 — et non HTTP — car
  Cyclos détient le verrou de la base de données pendant sa phase d'initialisation Spring/schéma. Une sonde
  HTTP sur `/api` ne réussirait pas avant l'initialisation complète de Cyclos, ce qui, lors d'une mise à jour
  progressive, provoque un interblocage avec l'instance précédente. TCP réussit dès que Tomcat
  écoute, ce qui permet au trafic de basculer et à l'ancienne instance de libérer le verrou.
- **Gestion du schéma au démarrage.** Cyclos crée et migre son propre schéma PostgreSQL
  au premier démarrage. Le démarrage du premier déploiement prend 2 à 5 minutes.
- **Les sondes de santé ciblent `/api`.** La sonde de vivacité cible `/api`, qui ne renvoie HTTP
  200 qu'une fois Cyclos entièrement initialisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cyclos {#a-cloud-run--the-cyclos-service}

Cyclos s'exécute comme un service Cloud Run v2 qui évolue automatiquement selon la charge de requêtes entre le nombre
minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cyclos stocke toutes les données applicatives (comptes, transactions, membres) dans une instance Cloud
SQL for PostgreSQL 15 gérée. Le service se connecte en TCP direct à l'adresse IP privée de Cloud SQL.
Lors du premier déploiement, un job d'initialisation (exécuté comme Cloud Run Job) crée la
base de données de l'application, l'utilisateur et les six extensions requises.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — gestionnaire de contenu de fichiers {#c-cloud-storage--file-content-manager}

Cyclos stocke tous les fichiers téléversés, photos de profil et pièces jointes de transactions dans un
bucket Cloud Storage dédié provisionné dans le cadre du déploiement. Le nom du bucket est
injecté automatiquement sous la forme `cyclos.storedFileContentManager.bucketName`. Le compte
de service reçoit l'accès automatiquement.

- **Console :** Cloud Storage → Buckets → recherchez `<prefix>-cyclos-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données Cyclos et celui du superutilisateur PostgreSQL (`ROOT_PASSWORD`) sont stockés dans
Secret Manager et injectés dans le service à l'exécution. La tâche `db-init` utilise
`ROOT_PASSWORD` pour installer les extensions ; Cyclos utilise `DB_PASSWORD` pour se connecter à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et
la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont acheminés vers Cloud Logging ; les métriques de Cloud Run et de Cloud SQL vers Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cyclos {#3-cyclos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche `db-init` s'exécute en tant que superutilisateur PostgreSQL et,
  de manière idempotente : crée l'utilisateur de base de données `cyclos`, crée la base de données de l'application,
  installe les six extensions requises (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`,
  `postgis`, `unaccent`) et accorde les privilèges nécessaires. Elle peut être relancée sans risque.

  Inspectez la tâche et ses exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Gestion du schéma au démarrage.** Cyclos crée et fait évoluer son propre schéma PostgreSQL
  au démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5 minutes.
- **Sonde de démarrage TCP.** Lors d'une mise à jour progressive, la nouvelle instance doit acquérir le
  verrou d'initialisation de la base de données Cyclos avant que l'ancienne instance ne le libère. Une sonde HTTP
  sur `/api` ne réussirait jamais avant l'initialisation complète de Cyclos, ce qui provoque un interblocage. La sonde
  de démarrage TCP réussit dès que Tomcat écoute (~32 secondes), ce qui permet le basculement du trafic
  vers la nouvelle révision, lequel envoie SIGTERM à l'ancienne instance et libère le verrou.
  La sonde de vivacité détecte ensuite tout contexte Spring non initialisé et déclenche un redémarrage
  propre.
- **Dimensionnement du tas JVM.** Définissez la variable d'environnement `CYCLOS_OPTIONS` pour plafonner le tas JVM —
  par exemple `{ CYCLOS_OPTIONS = "-Xmx2g" }` pour une limite mémoire de 4 GiB. Sans cela,
  la JVM peut consommer toute la mémoire disponible du conteneur et être tuée pour manque de mémoire (OOMKilled).
- **Instance unique par défaut.** Cyclos Community Edition utilise par défaut une seule instance
  (`max_instance_count = 1`). L'augmenter sans configuration du clustering Hazelcast entraîne
  un traitement non atomique des transactions et une corruption potentielle des données.
- **Envoi des e-mails.** Cyclos envoie les e-mails transactionnels via SMTP. Le module pré-remplit
  des valeurs SMTP fictives dans `environment_variables` — mettez-les à jour avant la mise en production :
  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Utilisez `secret_environment_variables` pour `SMTP_PASSWORD`.
- **Connexion TCP directe à la base de données.** `DB_HOST` est défini sur l'adresse IP privée de Cloud SQL
  (et non sur un chemin de socket). Assurez-vous que Private Service Access est configuré sur le VPC afin que le service Cloud
  Run puisse joindre l'instance Cloud SQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les paramètres
propres à Cyclos ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cyclos` | Nom de base des ressources. **Ne le modifiez pas après le premier déploiement.** |
| `display_name` | `Cyclos Community Edition` | Nom convivial affiché dans la console et les tableaux de bord de supervision. |
| `description` | `Cyclos Banking System on Cloud Run` | Description du service. |
| `application_version` | `4.16.17` | Tag de version de l'image Cyclos. Incrémentez-le pour déclencher une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. **Passez à `2000m` en production.** |
| `memory_limit` | `2Gi` | Mémoire par instance. **Passez à `4Gi` en production.** |
| `min_instance_count` | `1` | Nombre minimal d'instances. Gardez ≥ 1 pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Gardez `1` sauf si le clustering Hazelcast est configuré. |
| `container_port` | `8080` | Cyclos/Tomcat écoute sur le port 8080. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. Gen2 est requis pour la sortie VPC vers l'adresse IP privée de Cloud SQL. |
| `enable_cloudsql_volume` | `false` | Cyclos utilise par défaut TCP vers l'adresse IP privée de Cloud SQL ; activez uniquement si vous utilisez l'Auth Proxy. |
| `traffic_split` | `[]` | Allocation du trafic canary/blue-green entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | table de valeurs SMTP fictives | Pré-remplie avec des valeurs SMTP par défaut — configurez-la avant la mise en production. Les variables Cyclos principales sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. Repassez à `false` après une importation réussie. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et cycle de vie des images {#group-10--load-balancer-cdn--image-lifecycle}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires (le bucket principal `cyclos-storage` est provisionné automatiquement). |
| `enable_nfs` | `false` | NFS n'est pas utilisé par le conteneur Cyclos (GCS sert de stockage de fichiers). |
| `gcs_volumes` | `[]` | Montages GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `cyclos` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `cyclos` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (crée les extensions, l'utilisateur et la base de données). |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, port 8080, 60s de délai, 20s de période, 15 échecs | La sonde TCP évite l'interblocage du verrou de base de données lors d'une mise à jour progressive. |
| `liveness_probe` | HTTP `/api`, 120s de délai, 30s de période, 3 échecs | La sonde HTTP détecte un contexte Spring non initialisé après le démarrage. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés. |
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
| `database_type` | `POSTGRES_15` (codé en dur via Cyclos_Common) | Critical | Cyclos exige PostgreSQL avec six extensions. MySQL ou `NONE` empêche complètement le démarrage. |
| `db_name` / `db_user` | définis une fois (`cyclos` / `cyclos`) | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelines toutes les données financières. |
| `max_instance_count` | `1` (par défaut) | Critical | Plus de 1 sans clustering Hazelcast entraîne des transactions non atomiques et une corruption potentielle des données. |
| `application_name` | `cyclos` (ne pas modifier) | Critical | Intégré au nom du service Cloud Run, au dépôt Artifact Registry, aux secrets Secret Manager et au nom du bucket GCS. Le modifier rend orphelines toutes les ressources. |
| `application_version` | tag épinglé (par ex. `4.16.17`) | Critical | Les migrations de schéma de Cyclos sont à sens unique ; déployer une version plus récente sans chemin de migration testé corrompt le schéma. |
| Variable d'environnement `cyclos.storedFileContentManager` | `gcs` (codé en dur) | Critical | La surcharger avec `local` écrit les fichiers dans le stockage éphémère du conteneur ; tous les téléversements sont perdus au redémarrage. |
| `memory_limit` | `≥ 2Gi` (`4Gi` recommandé) | Critical | La JVM lève `OutOfMemoryError` ; le conteneur est tué pour manque de mémoire (code de sortie 137). |
| Variable d'environnement `CYCLOS_OPTIONS` | `-Xmx2g` pour une limite de 4 GiB | Critical | Sans plafond du tas JVM, Cyclos consomme toute la mémoire du conteneur et est tué pour manque de mémoire sous charge. |
| `startup_probe.type` | `TCP` (par défaut) | High | Une sonde HTTP sur `/api` pendant une mise à jour progressive provoque un interblocage du verrou de base de données ; la nouvelle révision ne devient jamais saine. |
| `startup_probe.path` (vivacité) | `/api` | Critical | Chemin erroné : la sonde ne reçoit jamais de HTTP 200 ; Cloud Run arrête la révision. |
| `enable_cloudsql_volume` | `false` (par défaut) | High | Si Private Service Access n'est pas configuré, la connexion TCP directe à l'adresse IP privée de Cloud SQL échoue ; db-init et le démarrage de l'application échouent tous deux. |
| `min_instance_count` | `1` | High | `0` (mise à l'échelle à zéro) ajoute des démarrages à froid de la JVM de 45 à 120 s ; les transactions bancaires expirent. |
| `execution_environment` | `gen2` | High | Gen1 peut rencontrer des problèmes de routage vers l'adresse IP privée de Cloud SQL via le VPC. Utilisez toujours gen2 pour Cyclos. |
| `enable_backup_import` | `false` après restauration | High | Le laisser à `true` relance la restauration à chaque apply et écrase les données financières en production. |
| `SMTP_HOST` / `EMAIL_FROM` | serveur réel / adresse réelle | High | Les valeurs fictives par défaut n'envoient aucun e-mail ; les réinitialisations de mot de passe et les notifications de transaction sont silencieusement perdues. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Medium | Sinon, l'interface d'administration de Cyclos est joignable publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour la conservation réglementaire des données financières. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Cyclos, partagée avec la variante GKE, est décrite dans
**[Cyclos_Common](Cyclos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cyclos sur Cloud Run](../labs/Cyclos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cyclos sur GKE Autopilot](Cyclos_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Cyclos Common — Configuration applicative partagée](Cyclos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [EspoCRM sur Google Cloud Run](EspoCRM_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Financial Inclusion & Community Banking**.
