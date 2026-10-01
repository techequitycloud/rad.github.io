---
title: "Vikunja sur Google Cloud Run"
description: "Référence de configuration pour déployer Vikunja sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Vikunja_CloudRun.md @ 3055034 sha256:b1ea23588ca1 -->

# Vikunja sur Google Cloud Run {#vikunja-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_CloudRun.png" alt="Vikunja sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vikunja est une application open source et auto-hébergée de gestion de tâches et de projets —
listes, tableaux kanban, diagrammes de Gantt, calendriers, rappels et partage en équipe, via une
API REST et une interface web. Ce module déploie Vikunja sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Vikunja et sur la manière de les explorer et
de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage
de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Vikunja s'exécute sous la forme d'un unique conteneur Go sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 MiB par défaut, instance unique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Vikunja ne prend pas en charge MySQL dans ce module |
| Build du conteneur | Cloud Build + Artifact Registry | Enveloppe l'image amont `scratch` avec un busybox greffé |
| Secrets | Secret Manager | `VIKUNJA_SERVICE_JWTSECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir un autre moteur empêche le démarrage.
- **L'application se connecte via l'IP privée Cloud SQL, pas via le socket.** Vikunja construit
  en interne une URL `postgres://`, et les deux-points du chemin de socket de l'Auth Proxy cassent l'analyse
  de l'URL. Le point d'entrée se connecte via l'IP privée avec `sslmode=require`.
- **L'image est basée sur `scratch` et reçoit une greffe busybox.** L'image amont
  `vikunja/vikunja` ne contient pas de shell ; le build personnalisé y copie donc un busybox
  statique pour exécuter le point d'entrée. `container_image_source` vaut `"custom"` par défaut.
- **`VIKUNJA_SERVICE_JWTSECRET` est généré automatiquement** et stocké dans Secret
  Manager. Le renouveler après le premier démarrage invalide toutes les sessions utilisateur actives.
- **`cpu_always_allocated = true` par défaut.** Vikunja exécute un planificateur
  de rappels/cron intégré au processus qui doit tourner sans requête entrante ; le CPU n'est donc pas
  bridé entre les requêtes. Cela garde une instance unique active.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Vikunja n'a aucune coordination intégrée pour plusieurs instances simultanées.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que l'interface et l'API soient
  accessibles. Activez IAP pour exiger une connexion Google.
- **NFS est désactivé par défaut.** Vikunja stocke ses données dans PostgreSQL ; n'activez NFS que
  si vous avez besoin de pièces jointes durables dans `/app/vikunja/files`.
- **`VIKUNJA_SERVICE_PUBLICURL` est défini à l'exécution** à partir de la valeur réelle de
  `CLOUDRUN_SERVICE_URL`, de sorte que les liens et le frontend utilisent toujours la véritable URL du service.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Vikunja {#a-cloud-run--the-vikunja-service}

Vikunja s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Vikunja stocke toutes les données de l'application (tâches, projets, tableaux, utilisateurs, équipes) dans une
instance gérée Cloud SQL for PostgreSQL 15. Le Job `db-init` se connecte via le
**Cloud SQL Auth Proxy** par un socket Unix ; l'application en cours d'exécution se connecte via
l'**IP privée** Cloud SQL avec `sslmode=require` (son constructeur d'URL ne peut pas utiliser le
chemin du socket). Aucune IP publique n'est exposée.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et le renouvellement du mot de passe.

### C. Cloud Build et Artifact Registry {#c-cloud-build--artifact-registry}

Comme l'image amont de Vikunja est basée sur `scratch`, le module construit une image
d'enveloppe via Cloud Build (en y greffant un busybox statique et le point d'entrée) et la pousse
vers Artifact Registry.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`VIKUNJA_SERVICE_JWTSECRET` (utilisé pour signer les JWT de session des utilisateurs). Le mot de passe de la base de données
est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de renouvellement.

### E. Cloud Storage et pièces jointes (facultatif) {#e-cloud-storage--file-attachments-optional}

Vikunja stocke les pièces jointes sur le système de fichiers du conteneur dans
`/app/vikunja/files`, qui est éphémère sur Cloud Run. Activez NFS et montez-le sur
ce chemin pour des pièces jointes durables ; le module ne déclare aucun bucket GCS dédié par
défaut.

- **Console :** Filestore / Compute Engine (VM NFS) lorsque `enable_nfs = true`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options NFS et GCS Fuse.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité (l'application atteint Cloud SQL via
une sortie VPC limitée aux plages privées).

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Vikunja {#3-vikunja-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `create-db-and-user.sh`
  avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données et le rôle de l'application, puis accorde les privilèges. Le
  job peut être relancé sans risque.
- **Migrations du schéma au démarrage.** Vikunja applique automatiquement ses propres migrations de schéma
  au premier démarrage de l'application — le job `db-init` ne provisionne
  qu'une base de données vide ; prévoyez donc un délai supplémentaire pour que la première révision devienne opérationnelle.
- **`VIKUNJA_SERVICE_JWTSECRET` est immuable après le premier démarrage.** Il est généré une seule fois
  et écrit dans Secret Manager. Le modifier invalide toutes les sessions utilisateur actives.
  Ne le renouvelez que pendant une fenêtre de maintenance planifiée.
- **Le premier compte enregistré devient le propriétaire.** Vikunja ne fournit aucun administrateur pré-créé.
  Ouvrez `$SERVICE_URL` et inscrivez-vous — le premier compte possède l'instance. Désactivez ensuite
  l'inscription ouverte :
  ```bash
  # add VIKUNJA_SERVICE_ENABLEREGISTRATION="false" to environment_variables and Update
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` — un point de terminaison public
  et non authentifié qui renvoie 200 dès que le serveur s'est lié à son port.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Vikunja ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vikunja` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Vikunja` | Nom lisible affiché dans la Console. |
| `application_description` | `Vikunja task manager on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Vikunja ; `latest` construit une version récente épinglée (`2.3.0`). |
| `application_database_name` | `vikunja` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `vikunja` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'enveloppe avec greffe busybox via Cloud Build ; `prebuilt` déploie l'image officielle. |
| `container_image` | `vikunja/vikunja` | Image amont qu'enveloppe le build personnalisé. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance ; gen2 impose un minimum de 512Mi. |
| `container_port` | `3456` | Port sur lequel écoute le serveur Go de Vikunja. |
| `min_instance_count` | `1` | Maintenu à 1 pour que le planificateur de rappels reste actif. |
| `max_instance_count` | `1` | Instance unique — Vikunja n'a aucune coordination multi-instance. |
| `cpu_always_allocated` | `true` | Garde le CPU alloué pour que le planificateur de rappels intégré s'exécute entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 est requis pour le minimum de 512Mi et les montages NFS/GCS. |
| `enable_cloudsql_volume` | `true` | Socket Auth Proxy pour le job `db-init` ; l'application elle-même utilise l'IP privée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image d'enveloppe dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'interface/l'API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918 (atteint l'IP privée Cloud SQL). |
| `enable_iap` | `false` | Exige une connexion Google devant Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `VIKUNJA_*` supplémentaires (p. ex. `VIKUNJA_SERVICE_ENABLEREGISTRATION`). Ne définissez pas `VIKUNJA_DATABASE_*` ni `VIKUNJA_SERVICE_JWTSECRET` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de renouvellement de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes Cloud SQL automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vikunja ne déclare aucun bucket par défaut. |
| `enable_nfs` | `false` | À activer pour des pièces jointes durables dans `/app/vikunja/files`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Mot de passe de la base de données {#group-12--database-password}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Renouvellement du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs en option. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` délai de 30s | Sonde de démarrage ; large fenêtre de nouvelles tentatives pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/health` délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
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
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critical | Le renouveler invalide toutes les sessions utilisateur actives et force chacun à se reconnecter immédiatement. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_nfs` (pour les pièces jointes) | `true` si les pièces jointes comptent | High | Sans NFS, les pièces jointes résident sur un disque éphémère et sont perdues à chaque révision/redémarrage. |
| `memory_limit` | `512Mi` (minimum gen2) | High | Les valeurs inférieures à 512Mi sont rejetées au moment du plan sur gen2. |
| `cpu_always_allocated` | `true` | Medium | Le passer à `false` met en pause le planificateur de rappels intégré lorsque l'instance est inactive — les rappels ne se déclenchent pas avant la requête suivante. |
| `container_image_source` | `custom` | High | `prebuilt` déploie l'image `scratch` brute sans shell ni mappage du point d'entrée — le conteneur ne peut pas mapper `DB_*` et ne parvient pas à se connecter. |
| `ingress_settings` | `all` | Medium | `internal` rend l'interface/l'API inaccessibles depuis l'extérieur du VPC. |
| `enable_iap` | à activer pour les instances privées | Medium | Sans IAP, l'interface est publique ; toute personne disposant de l'URL peut atteindre la page de connexion/d'inscription. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (variable d'environnement) | `"false"` après le premier administrateur | High | Laisser l'inscription ouverte permet à toute personne disposant de l'URL de créer un compte. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Vikunja
partagée avec la variante GKE est décrite dans
**[Vikunja_Common](Vikunja_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vikunja sur Cloud Run](../labs/Vikunja_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Vikunja sur GKE Autopilot](Vikunja_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vikunja Common — Configuration applicative partagée](Vikunja_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **Team Workspace**.
