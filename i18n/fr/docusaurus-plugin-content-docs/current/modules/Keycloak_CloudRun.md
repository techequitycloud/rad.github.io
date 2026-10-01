---
title: "Keycloak sur Google Cloud Run"
description: "Référence de configuration pour déployer Keycloak sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Keycloak_CloudRun.md @ 3055034 sha256:d21ba9a68ff8 -->

# Keycloak sur Google Cloud Run {#keycloak-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Keycloak_CloudRun.png" alt="Keycloak sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Keycloak est une plateforme open source de gestion des identités et des accès (un projet CNCF) qui fournit l'authentification unique (SSO), OAuth 2.0/OIDC, SAML 2.0, la connexion via les réseaux sociaux, la fédération d'utilisateurs (LDAP/Active Directory) et une autorisation fine — une alternative auto-hébergée à Auth0/Okta sans frais par utilisateur. Ce module déploie Keycloak sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Keycloak et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Keycloak s'exécute comme un conteneur JVM (Quarkus) sur Cloud Run v2, construit en **mode production (optimisé)** via Cloud Build. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service JVM, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes, gen2 |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Keycloak y stocke les realms, clients, utilisateurs et sessions |
| Build du conteneur | Cloud Build + Artifact Registry | Image personnalisée : `kc.sh build` intègre le fournisseur Postgres, puis `start --optimized` |
| Secrets | Secret Manager | Mot de passe de l'administrateur d'amorçage et mot de passe de la base de données gérés automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé en option |
| Observabilité | Cloud Logging et Monitoring | Journaux du conteneur, métriques, test de disponibilité optionnel sur `/` |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé par `Keycloak_Common` ; MySQL n'est pas pris en charge.
- **La connexion à la base de données passe en TCP par le VPC privé, et non par le socket Cloud SQL.** `enable_cloudsql_volume` vaut `false` par défaut car le **pilote JDBC PostgreSQL** fourni avec Keycloak **ne peut pas utiliser les sockets Unix** — le point d'entrée assemble `KC_DB_URL = jdbc:postgresql://<private-ip>:5432/<db>` à l'exécution et, si un socket est un jour monté, bascule automatiquement d'un chemin de socket vers `DB_IP`.
- **Une tâche `db-init` s'exécute à chaque apply** (`postgres:15-alpine`) pour créer de manière idempotente la base de données et le rôle Keycloak.
- **L'identifiant de l'administrateur d'amorçage est généré automatiquement.** Nom d'utilisateur `admin` (`KC_BOOTSTRAP_ADMIN_USERNAME`), mot de passe aléatoire stocké dans Secret Manager et injecté sous la forme `KC_BOOTSTRAP_ADMIN_PASSWORD`.
- **La santé est exposée sur le port de gestion 9000, et non 8080.** Keycloak 25+ sert `/health`, `/health/ready` et `/metrics` sur un port de gestion distinct que la plateforme ne sonde pas — la **sonde de démarrage est donc en TCP sur 8080** ; la sonde de vivacité cible HTTP `/`.
- **Mise à l'échelle jusqu'à zéro par défaut** (`min_instance_count = 0`). Les démarrages à froid de la JVM prennent 60 à 120 secondes — définissez `1` pour un IdP de production.
- **Redis, NFS et les buckets GCS ne sont pas utilisés** — tout l'état de Keycloak se trouve dans PostgreSQL.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Keycloak {#a-cloud-run--the-keycloak-service}

Keycloak s'exécute comme un service Cloud Run v2 qui se met à l'échelle selon la charge des requêtes entre les nombres minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Keycloak stocke toutes les données applicatives (realms, clients, utilisateurs, sessions et configuration) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service se connecte en **TCP à l'IP privée de l'instance** via le VPC (aucune IP publique) — le socket du Cloud SQL Auth Proxy n'est volontairement pas utilisé car JDBC ne peut pas se connecter via des sockets Unix. Lors du premier déploiement, un Job `db-init` crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Build et Artifact Registry — l'image optimisée {#c-cloud-build--artifact-registry--the-optimized-image}

Le module construit une **image personnalisée** (`container_image_source = "custom"`) : un Dockerfile multi-étapes exécute `kc.sh build` sur l'image officielle `quay.io/keycloak/keycloak` pour y intégrer le fournisseur PostgreSQL et les fonctionnalités de santé/métriques, puis superpose un point d'entrée de la plateforme et démarre avec `kc.sh start --optimized` — Keycloak ne réexécute pas sa lente étape de build à chaque démarrage.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets protègent le déploiement : le **mot de passe de l'administrateur d'amorçage** (créé par `Keycloak_Common`, injecté sous la forme `KC_BOOTSTRAP_ADMIN_PASSWORD`) et le **mot de passe de la base de données** (créé par le socle). Tous deux sont injectés à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress et l'egress VPC contrôlent la connectivité. Notez que Keycloak valide son nom d'hôte public — le point d'entrée détecte automatiquement l'URL `run.app` comme `KC_HOSTNAME` ; si vous placez Keycloak derrière un équilibreur de charge ou un domaine personnalisé, définissez donc `KC_HOSTNAME` explicitement via `environment_variables`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte optionnels. Le point d'entrée affiche un résumé de la configuration (`KC_DB_URL`, `KC_HOSTNAME`, paramètres de proxy) à chaque démarrage — le premier endroit à consulter pour diagnostiquer un problème de connectivité.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Keycloak {#3-keycloak-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` (`postgres:15-alpine`) crée de manière idempotente le rôle et la base de données Keycloak, accorde les privilèges et accorde `ALL ON SCHEMA public` (requis pour PostgreSQL 15+). Il s'exécute à chaque apply avec jusqu'à 3 nouvelles tentatives et peut être relancé sans risque.
- **Migrations de schéma au démarrage.** Keycloak crée et migre automatiquement son schéma au premier démarrage sur la base de données vide. Les migrations sont à sens unique — **ne rétrogradez jamais `application_version`**.
- **Mappage des variables d'environnement à l'exécution.** Le point d'entrée personnalisé mappe les variables `DB_HOST`/`DB_IP`, `DB_PORT`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` injectées par le socle sur `KC_DB_URL`, `KC_DB_USERNAME` et `KC_DB_PASSWORD` de Keycloak. Si `DB_HOST` est un répertoire de socket Cloud SQL (commence par `/`), il bascule vers `DB_IP` car JDBC ne peut pas utiliser les sockets Unix. Les variables `KC_DB_*` définies explicitement sont toujours prioritaires.
- **Détection automatique du nom d'hôte.** Au démarrage, le point d'entrée interroge l'API de métadonnées/Admin de Cloud Run pour découvrir l'URL publique du service et l'exporte sous la forme `KC_HOSTNAME` (avec `KC_HOSTNAME_STRICT=false` derrière le front-end qui termine TLS). Remplacez `KC_HOSTNAME` via `environment_variables` lorsque vous utilisez un domaine personnalisé.
- **Compatible avec un proxy inverse.** `KC_PROXY_HEADERS=xforwarded` et `KC_HTTP_ENABLED=true` sont injectées afin que Keycloak fasse confiance aux en-têtes `X-Forwarded-*` définis par le front-end de Cloud Run qui termine TLS.
- **Administrateur d'amorçage.** Au premier démarrage, Keycloak crée un administrateur d'amorçage **temporaire** (`admin` / mot de passe Secret Manager). Connectez-vous sur `<url>/admin`, créez un administrateur permanent, puis supprimez l'utilisateur d'amorçage ou changez son mot de passe.
- **Piège de santé — port 9000.** `/health`, `/health/ready`, `/health/live` et `/metrics` sont servis sur le **port de gestion 9000**, que Cloud Run n'expose pas. Sonder `8080/health` renverrait toujours 404 — c'est pourquoi la sonde de démarrage est en TCP sur 8080.
- **Vérification.** Le document de découverte OIDC est public et confirme la santé de bout en bout :
  ```bash
  curl -s "$SERVICE_URL/realms/master/.well-known/openid-configuration" | head -c 300
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Keycloak ou notables pour lui sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès et les alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `keycloak` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Keycloak SSO` | Nom convivial affiché dans la console. |
| `application_version` | `26.0` | Tag de l'image Keycloak. **Ne jamais rétrograder** — les migrations de schéma sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` construit l'image optimisée via Cloud Build — obligatoire ; l'image amont ne dispose pas du point d'entrée qui mappe les identifiants de la base de données et détecte le nom d'hôte. |
| `cpu_limit` | `2000m` | Keycloak (JVM) a besoin d'au moins 1 vCPU ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Le tas de la JVM a besoin d'au moins 1 GiB ; 2 GiB recommandés. |
| `container_port` | `8080` | Écouteur HTTP de Keycloak. La santé et les métriques sont sur le port de gestion distinct 9000. |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro. Les démarrages à froid de la JVM prennent 60 à 120 s — définissez `1` pour un IdP de production. |
| `max_instance_count` | `3` | Plafond de coût. |
| `enable_cloudsql_volume` | `false` | **Conservez `false`.** JDBC ne peut pas utiliser le socket Unix Cloud SQL ; Keycloak se connecte en TCP via l'IP privée. |
| `execution_environment` | `gen2` | Recommandé pour un démarrage plus rapide. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Keycloak est par défaut un IdP exposé à Internet ; utilisez `internal-and-cloud-load-balancing` derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Requis pour que Keycloak puisse atteindre l'IP privée de Cloud SQL via le VPC. |
| `enable_iap` | `false` | IAP placé devant un IdP OIDC/SAML casse les flux de redirection du navigateur — laissez-le désactivé sauf si la console est réservée à un usage interne. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `KC_*` supplémentaires (par ex. `KC_LOG_LEVEL`, `KC_FEATURES` ou un `KC_HOSTNAME` explicite). `KC_DB`, `KC_PROXY_HEADERS`, `KC_HTTP_ENABLED`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED` et `KC_BOOTSTRAP_ADMIN_USERNAME` sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager (par ex. mots de passe de truststore). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Comportement de sauvegarde standard d'App_CloudRun (`backup_schedule` `0 2 * * *`, `backup_retention_days` `7`, `enable_backup_import` optionnelle). Tout l'état se trouve dans PostgreSQL, si bien que les sauvegardes de la base de données capturent l'intégralité de la configuration Keycloak.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. **Définissez `KC_HOSTNAME` en conséquence** — Keycloak émet les jetons et les redirections pour son nom d'hôte configuré. |
| `enable_cloud_armor` | `false` | WAF devant l'IdP — recommandé pour les connexions de production exposées à Internet. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

Keycloak n'a besoin d'aucun stockage objet ni stockage de fichiers — `storage_buckets` et `gcs_volumes` valent `[]` par défaut et `enable_nfs` vaut `false`. Tout l'état se trouve dans PostgreSQL. Toutes les entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Keycloak nécessite PostgreSQL — ne pas modifier. |
| `db_name` | `keycloak` | Nom de la base de données (préfixé par le tenant au moment du déploiement). Immuable après le premier déploiement. |
| `db_user` | `keycloak` | Rôle applicatif (préfixé par le tenant au moment du déploiement). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (`postgres:15-alpine`, 3 nouvelles tentatives). |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP sur 8080**, délai initial de 30 s, 30 échecs (budget d'environ 330 s) | TCP car `/health` se trouve sur le port de gestion 9000 non exposé. Budget généreux pour le démarrage de la JVM et les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60 s | Le chemin racine de Keycloak répond sur 8080 une fois démarré. |
| `uptime_check_config` | désactivé, chemin `/` | À activer en production ; Keycloak sert une page d'accueil publique sur `/`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak n'utilise pas Redis — laissez `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC — utile pour un IdP qui détient des identifiants. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Keycloak n'en utilise aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Keycloak nécessite PostgreSQL ; tout autre moteur empêche le démarrage. |
| `enable_cloudsql_volume` | `false` | Critique | JDBC ne peut pas utiliser le socket Unix Cloud SQL. Avec une connexion par socket uniquement et sans repli sur `DB_IP`, Keycloak ne peut pas atteindre PostgreSQL. |
| `db_name` / `db_user` | à définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit tous les realms et utilisateurs. |
| `application_version` | ne jamais rétrograder | Critique | Les migrations de schéma de Keycloak sont à sens unique ; une rétrogradation corrompt le schéma ou le refuse. |
| `container_image_source` | `custom` | Élevé | L'image amont ne dispose pas du point d'entrée qui mappe les identifiants de la base de données, assemble l'URL JDBC et détecte `KC_HOSTNAME` — et elle n'est pas pré-construite pour `start --optimized`. |
| `startup_probe` | TCP sur 8080, ≥30 échecs | Élevé | Une sonde HTTP sur `8080/health` renvoie toujours 404 (la santé est sur le port 9000) ; la révision ne devient jamais prête alors que Keycloak a bien démarré. |
| Administrateur d'amorçage | à remplacer après la première connexion | Élevé | `admin` + le mot de passe Secret Manager est un identifiant d'amorçage **temporaire** ; le conserver comme unique administrateur constitue un risque permanent. |
| `KC_HOSTNAME` (via `environment_variables`) | explicite en cas de domaine personnalisé / équilibreur de charge | Élevé | La détection automatique fige l'URL `run.app` ; les redirections OIDC et les URL d'émetteur ne correspondent alors plus au domaine réellement visité par les utilisateurs. |
| `memory_limit` | `2Gi` | Élevé | OOM de la JVM en dessous d'environ 1 GiB, en particulier pendant les migrations du premier démarrage. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` (ou `ALL_TRAFFIC`) | Élevé | Sans egress VPC, le service ne peut pas atteindre l'IP privée de Cloud SQL. |
| `min_instance_count` | `1` en production | Moyen | `0` ajoute un démarrage à froid de la JVM de 60 à 120 s à la première redirection SSO après une période d'inactivité — très visible dans les flux de connexion. |
| `enable_cloud_armor` | activé pour les connexions exposées à Internet | Moyen | Sinon, les points de terminaison de connexion et d'administration ne sont pas protégés contre le trafic volumétrique ou le bourrage d'identifiants. |
| `enable_redis` | `false` | Faible | Keycloak n'utilise pas Redis ; l'activer ne fait qu'injecter des variables d'environnement inutilisées. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Keycloak partagée avec la variante GKE est décrite dans **[Keycloak_Common](Keycloak_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Keycloak sur Cloud Run](../labs/Keycloak_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Keycloak sur GKE Autopilot](Keycloak_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Keycloak Common — Configuration applicative partagée](Keycloak_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) et [Infisical sur Google Cloud Run](Infisical_CloudRun.md) dans la solution **SSO Foundation**.
