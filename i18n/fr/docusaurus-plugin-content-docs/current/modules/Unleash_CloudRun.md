---
title: "Unleash sur Google Cloud Run"
description: "Référence de configuration pour déployer Unleash sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Unleash_CloudRun.md @ 3055034 sha256:d5605fbf7ce9 -->

# Unleash sur Google Cloud Run {#unleash-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Unleash_CloudRun.png" alt="Unleash sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Unleash est une plateforme open source, sous licence Apache 2.0, de gestion des
feature flags et des bascules de fonctionnalités, pour la livraison progressive, les
tests A/B et les déploiements graduels. Ce module déploie Unleash sur **Cloud Run v2**
en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Unleash et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Unleash s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Unleash ne prend en charge ni MySQL ni d'autres moteurs |
| Secrets | Secret Manager | Jeton d'API administrateur d'amorçage généré automatiquement (`INIT_ADMIN_API_TOKENS`) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Unleash est sans état.** Toutes les données de flags, de bascules, de stratégies,
  de segments et d'audit résident dans PostgreSQL — aucun stockage objet, NFS ou
  volume persistant n'est provisionné, et n'importe quelle instance peut traiter
  n'importe quelle requête.
- **Aucun backend Redis ni file d'attente.** Unleash n'a besoin ni de cache ni de file
  d'attente ; il se met à l'échelle horizontalement en dirigeant davantage d'instances
  vers la même base de données.
- **`INIT_ADMIN_API_TOKENS` est généré automatiquement** et stocké dans Secret Manager.
  Unleash enregistre ce jeton d'API administrateur à accès total (`*:*`) dans sa base
  de données au premier démarrage, afin que l'automatisation puisse appeler l'Admin
  API immédiatement.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Les démarrages à froid ajoutent quelques secondes à
  la première requête après une période d'inactivité. Définissez
  `min_instance_count = 1` si les clients SDK interrogent le service à intervalles
  rapprochés et que la latence de démarrage à froid est inacceptable.
- **`DATABASE_URL` est assemblée au démarrage du conteneur** à partir des variables
  `DB_*` injectées par la plateforme, par le point d'entrée de l'image personnalisée,
  qui s'adapte au type de connexion (socket, proxy en boucle locale ou IP privée) et
  maintient la vérification des certificats TLS pour les connexions directes par IP
  privée (sécurisé par défaut).
- **Le point de terminaison de santé est `/health`** — un point de terminaison public,
  sans authentification, qui renvoie 200. L'Admin API sous `/api/admin/*` exige un
  jeton.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Unleash {#a-cloud-run--the-unleash-service}

Unleash s'exécute comme un service Cloud Run v2 qui se met automatiquement à l'échelle
selon la charge de requêtes, entre les nombres minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Unleash stocke toutes les données applicatives (projets, feature flags, stratégies,
segments, jetons d'API, utilisateurs et journal des modifications/d'audit) dans une
instance gérée Cloud SQL for PostgreSQL 15. Le service se connecte de manière privée
via le **Cloud SQL Auth Proxy** ; aucune IP publique n'est exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application, et Unleash applique ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Un jeton d'API administrateur d'amorçage est généré automatiquement et stocké dans
Secret Manager, puis injecté sous le nom `INIT_ADMIN_API_TOKENS`. Le mot de passe de la
base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Use the token against the Admin API:
  curl -s -H "Authorization: <token>" "$SERVICE_URL/api/admin/projects"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, ce qui assure l'accès public
dont les clients SDK et les systèmes de CI ont besoin pour atteindre l'API Unleash. Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor
peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Unleash {#3-unleash-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et l'utilisateur de l'application, puis accorde les privilèges. Le job peut
  être relancé sans risque ; il ne crée **pas** de tables.
- **Migrations de schéma au démarrage.** Unleash applique automatiquement ses propres
  migrations de schéma à chaque démarrage : la mise à niveau de la version de
  l'application applique donc les modifications de schéma sans étape de migration
  distincte. Prévoyez une marge de démarrage généreuse lors du premier démarrage sur
  une base de données vide.
- **`DATABASE_URL` est composée à l'exécution.** Le point d'entrée de l'image
  personnalisée assemble la chaîne de connexion à partir des variables `DB_*`
  injectées. Vérifiez les variables injectées dans la révision en cours d'exécution
  lorsque vous déboguez un problème de connexion :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Jeton d'API administrateur d'amorçage.** `INIT_ADMIN_API_TOKENS` enregistre un
  jeton d'API administrateur à accès total (`*:*`) au premier démarrage, afin que la
  CI, l'Unleash CLI et les backends des SDK puissent appeler l'Admin API sans
  connexion à l'interface. Récupérez-le dans Secret Manager (§2C).
- **Identifiants par défaut de l'interface.** L'interface d'administration est livrée
  avec un compte de premier lancement bien connu — `admin` / `unleash4all`. Changez le
  mot de passe immédiatement après la première connexion.
- **Chemin de santé.** Les sondes de démarrage et de vivacité (liveness) ciblent
  `/health` — un point de terminaison public, sans authentification, qui ne renvoie
  200 que lorsque le serveur est initialisé et connecté à PostgreSQL. L'Admin API sous
  `/api/admin/*` exige un jeton : elle ne doit donc jamais servir de chemin de sonde.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Unleash ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `unleash` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Unleash` | Nom lisible affiché dans la console. |
| `application_description` | `Unleash Analytics on Cloud Run` | Description du service. |
| `application_version` | `5.7.0` | Tag de l'image `unleashorg/unleash-server` ; `latest` est remplacé par un tag figé au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Cloud Build encapsule `unleashorg/unleash-server` avec le point d'entrée DATABASE_URL. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU suffit pour la plupart des déploiements. |
| `memory_limit` | `512Mi` | Mémoire par instance ; passez à `1Gi` en cas d'usage intensif de l'administration ou du reporting. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour une interrogation SDK fréquente. |
| `max_instance_count` | `3` | Unleash se met à l'échelle horizontalement — tout l'état réside dans PostgreSQL. |
| `cpu_always_allocated` | `false` | Facturation à la requête ; Unleash n'effectue aucun travail en arrière-plan nécessitant un CPU toujours alloué. |
| `container_port` | `4242` | Unleash écoute sur le port 4242. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux clients SDK et à la CI d'atteindre l'API Unleash. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque le trafic SDK authentifié par jeton.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `DATABASE_URL` est assemblée à l'exécution — ne la définissez pas ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Expression cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Principales entrées : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Unleash ne nécessite aucun stockage de fichiers. |
| `enable_nfs` | `false` | NFS est désactivé ; Unleash est sans état. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Unleash nécessite PostgreSQL. |
| `application_database_name` | `unleash` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `unleash` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Extensions PostgreSQL facultatives. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler et Cloud Run Jobs planifiés. |
| `additional_services` | `[]` | Services Cloud Run sidecar ou auxiliaires. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30 s, 30 tentatives | Sonde de démarrage. Prévoyez une marge pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30 s | Sonde de vivacité (liveness). |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage Cloud Run structurée. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité Cloud Run structurée. |
| `uptime_check_config` | désactivé, `/health` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Unleash ne nécessite pas Redis ; laissez-le désactivé. |
| `redis_host` | `""` | Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (détecte automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Unleash). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | État de la CI/CD et dépôt connecté. |
| `deployment_id` / `project_id` | Identifiants de nommage et de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Tout autre moteur empêche le démarrage d'Unleash — il ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données des flags. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` (auto) | Conserver `true` sur IP privée | Critical | Désactiver la vérification des certificats sur une connexion TCP par IP privée affaiblit la sécurité du transport. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| Chemin de `startup_probe` / `liveness_probe` | `/health` | High | Diriger une sonde vers `/api/admin/*` renvoie 401/403 et la révision ne devient jamais Ready. |
| `enable_iap` | uniquement en l'absence de trafic SDK | High | IAP bloque toutes les requêtes non authentifiées, y compris les appels SDK/CI authentifiés par jeton vers l'API Unleash. |
| `ingress_settings` | `all` | High | `internal` empêche les clients SDK externes et la CI d'atteindre l'API Unleash. |
| `INIT_ADMIN_API_TOKENS` (auto) | À récupérer dans Secret Manager | Medium | Le jeton enregistré accorde des droits d'administration complets sur l'API — traitez-le comme un secret et effectuez sa rotation s'il est exposé. |
| Identifiants par défaut de l'interface `admin` / `unleash4all` | À modifier à la première connexion | High | Conserver le mot de passe par défaut expose le contrôle administrateur complet de tous les flags. |
| `min_instance_count` | `0` (défaut) ou `1` | Medium | La mise à l'échelle à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et simultanéité, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Unleash,
partagée avec la variante GKE, est décrite dans
**[Unleash_Common](Unleash_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Unleash sur Cloud Run](../labs/Unleash_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Unleash sur GKE Autopilot](Unleash_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Unleash Common — Configuration applicative partagée](Unleash_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) et [Tolgee sur Google Cloud Run](Tolgee_CloudRun.md) dans la solution **Release Management & Quality**.
