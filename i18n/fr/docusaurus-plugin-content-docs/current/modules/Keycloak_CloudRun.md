---
title: "Keycloak sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Keycloak sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Keycloak_CloudRun.md @ 15fd4c7 sha256:564008761d76 -->

# Keycloak sur Google Cloud Run {#keycloak-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Keycloak_CloudRun.png" alt="Keycloak sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Keycloak est une plateforme open source de gestion des identités et des accès (un projet CNCF) offrant l'authentification unique (SSO), OAuth 2.0/OIDC, SAML 2.0, la connexion sociale, la fédération d'utilisateurs (LDAP/Active Directory) et une autorisation granulaire — une alternative auto-hébergée à Auth0/Okta sans frais par utilisateur. Ce module déploie Keycloak sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Keycloak utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Keycloak s'exécute comme un conteneur JVM (Quarkus) sur Cloud Run v2, construit en **mode production (optimisé)** via Cloud Build. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service JVM, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes, gen2 |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Keycloak y stocke les royaumes, les clients, les utilisateurs et les sessions |
| Build de conteneur | Cloud Build + Artifact Registry | Image personnalisée : `kc.sh build` intègre le fournisseur Postgres, puis `start --optimized` |
| Secrets | Secret Manager | Mot de passe administrateur de démarrage et mot de passe de base de données gérés automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Observabilité | Cloud Logging & Monitoring | Journaux de conteneurs, métriques, test de disponibilité facultatif sur `/` |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé par `Keycloak_Common` ; MySQL n'est pas pris en charge.
- **La connexion à la base de données est TCP sur le VPC privé, pas le socket Cloud SQL.** `enable_cloudsql_volume` est par défaut `false` car le **pilote JDBC** PostgreSQL intégré de Keycloak **ne peut pas utiliser les sockets Unix** — le point d'entrée assemble `KC_DB_URL = jdbc:postgresql://<private-ip>:5432/<db>` à l'exécution, et revient automatiquement d'un chemin de socket à `DB_IP` si un socket est monté.
- **Un job `db-init` s'exécute à chaque apply** (`postgres:15-alpine`) pour créer de manière idempotente la base de données et le rôle Keycloak.
- **L'identifiant administrateur de démarrage est généré automatiquement.** Nom d'utilisateur `admin` (`KC_BOOTSTRAP_ADMIN_USERNAME`), mot de passe aléatoire et stocké dans Secret Manager, injecté comme `KC_BOOTSTRAP_ADMIN_PASSWORD`.
- **La santé est sur le port de gestion 9000, pas 8080.** Keycloak 25+ sert `/health`, `/health/ready` et `/metrics` sur un port de gestion séparé que la plateforme ne sonde pas — la **sonde de démarrage est donc TCP sur 8080** ; la sonde de vivacité cible HTTP `/`.
- **Mise à l'échelle à zéro par défaut** (`min_instance_count = 0`). Les démarrages à froid de la JVM prennent 60 à 120 secondes — définissez `1` pour un IdP de production.
- **Redis, NFS et les buckets GCS ne sont pas utilisés** — tout l'état de Keycloak est dans PostgreSQL.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Keycloak {#a-cloud-run--the-keycloak-service}

Keycloak s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Keycloak stocke toutes les données de l'application (domaines, clients, utilisateurs, sessions et configuration) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte via **TCP à l'adresse IP privée de l'instance** via le VPC (pas d'IP publique) — le socket du proxy d'authentification Cloud SQL n'est intentionnellement pas utilisé car JDBC ne peut pas se connecter via des sockets Unix. Lors du premier déploiement, un job `db-init` crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Build et Artifact Registry — l'image optimisée {#c-cloud-build--artifact-registry--the-optimized-image}

Le module construit une **image personnalisée** (`container_image_source = "custom"`) : un Dockerfile multi-étapes exécute `kc.sh build` sur l'image officielle `quay.io/keycloak/keycloak` pour intégrer le fournisseur PostgreSQL et les fonctionnalités de santé/métriques, puis superpose un point d'entrée de plateforme et démarre avec `kc.sh start --optimized` — Keycloak ne réexécute pas son étape de build lente à chaque démarrage.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets protègent le déploiement : le **mot de passe administrateur de démarrage** (créé par `Keycloak_Common`, injecté comme `KC_BOOTSTRAP_ADMIN_PASSWORD`) et le **mot de passe de la base de données** (créé par la fondation). Les deux sont injectés à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité. Notez que Keycloak valide son nom d'hôte public — le point d'entrée détecte automatiquement l'URL `run.app` comme `KC_HOSTNAME`, donc si vous placez Keycloak derrière un équilibreur de charge ou un domaine personnalisé, définissez `KC_HOSTNAME` explicitement via `environment_variables`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte facultatifs. Le point d'entrée imprime un résumé de la configuration (`KC_DB_URL`, `KC_HOSTNAME`, paramètres de proxy) à chaque démarrage — le premier endroit où chercher lors du diagnostic de la connectivité.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Keycloak {#3-keycloak-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (`postgres:15-alpine`) crée de manière idempotente le rôle et la base de données Keycloak, accorde les privilèges et accorde `ALL ON SCHEMA public` (requis pour PostgreSQL 15+). Il s'exécute à chaque apply avec jusqu'à 3 tentatives et peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Keycloak crée et migre son schéma automatiquement au premier démarrage sur la base de données vide. Les migrations sont unidirectionnelles — **ne jamais rétrograder `application_version`**.
- **Mappage d'environnement d'exécution.** Le point d'entrée personnalisé mappe les `DB_HOST`/`DB_IP`, `DB_PORT`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` injectés par la fondation sur les `KC_DB_URL`, `KC_DB_USERNAME` et `KC_DB_PASSWORD` de Keycloak. Si `DB_HOST` est un répertoire de socket Cloud SQL (commence par `/`), il revient à `DB_IP` car JDBC ne peut pas utiliser les sockets Unix. Les variables `KC_DB_*` définies explicitement ont toujours la priorité.
- **Détection automatique du nom d'hôte.** Le point d'entrée exporte le `CLOUDRUN_SERVICE_URL` injecté par la fondation (le `service_url` du module) comme `KC_HOSTNAME` au démarrage, de sorte que l'émetteur OIDC est stable (avec `KC_HOSTNAME_STRICT=false` derrière le frontal de terminaison TLS). Remplacez `KC_HOSTNAME` via `environment_variables` lors de l'utilisation d'un domaine personnalisé.
- **Conscient du proxy inverse.** `KC_PROXY_HEADERS=xforwarded` et `KC_HTTP_ENABLED=true` sont injectés afin que Keycloak fasse confiance aux en-têtes `X-Forwarded-*` définis par le frontal de terminaison TLS de Cloud Run.
- **Administrateur de démarrage.** Au premier démarrage, Keycloak crée un administrateur de démarrage **temporaire** (`admin` / mot de passe Secret Manager). Connectez-vous à `<url>/admin`, créez un administrateur permanent, puis supprimez ou faites pivoter l'utilisateur de démarrage.
- **Piège de la santé — port 9000.** `/health`, `/health/ready`, `/health/live` et `/metrics` sont servis sur le **port de gestion 9000**, que Cloud Run n'expose pas. Sonder `8080/health` renverrait toujours un 404 — c'est pourquoi la sonde de démarrage est TCP sur 8080.
- **Vérification.** Le document de découverte OIDC est public et confirme la santé de bout en bout :
  ```bash
  curl -s "$SERVICE_URL/realms/master/.well-known/openid-configuration" | head -c 300
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Keycloak sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder et alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `keycloak` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Keycloak SSO` | Nom convivial affiché dans la console. |
| `application_version` | `26.0` | Tag de l'image Keycloak. **Ne jamais rétrograder** — les migrations de schéma sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` construit l'image optimisée via Cloud Build — requis ; l'image amont n'a pas le point d'entrée qui mappe les identifiants de base de données et détecte le nom d'hôte. |
| `cpu_limit` | `2000m` | Keycloak (JVM) a besoin d'au moins 1 vCPU ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Le tas JVM a besoin d'au moins 1 GiB ; 2 GiB recommandés. |
| `container_port` | `8080` | Écouteur HTTP Keycloak. La santé/les métriques sont sur le port de gestion séparé 9000. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro. Les démarrages à froid de la JVM prennent 60 à 120 s — définissez `1` pour un IdP de production. |
| `max_instance_count` | `3` | Plafond de coût. |
| `enable_cloudsql_volume` | `false` | **Gardez `false`.** JDBC ne peut pas utiliser le socket Unix Cloud SQL ; Keycloak se connecte via TCP sur IP privée. |
| `execution_environment` | `gen2` | Recommandé pour un démarrage plus rapide. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Keycloak est un IdP accessible sur Internet par défaut ; utilisez `internal-and-cloud-load-balancing` derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Requis pour que Keycloak puisse atteindre l'IP privée de Cloud SQL via le VPC. |
| `enable_iap` | `false` | IAP devant un IdP OIDC/SAML interrompt les flux de redirection du navigateur — désactivez-le sauf si la console est uniquement interne. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `KC_*` supplémentaires (par exemple `KC_LOG_LEVEL`, `KC_FEATURES` ou un `KC_HOSTNAME` explicite). `KC_DB`, `KC_PROXY_HEADERS`, `KC_HTTP_ENABLED`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED` et `KC_BOOTSTRAP_ADMIN_USERNAME` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, mots de passe de truststore). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Comportement de sauvegarde standard d'App_CloudRun (`backup_schedule` `0 2 * * *`, `backup_retention_days` `7`, `enable_backup_import` facultatif). Tout l'état est dans PostgreSQL, donc les sauvegardes de base de données capturent l'intégralité de la configuration Keycloak.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. **Définissez `KC_HOSTNAME` pour correspondre** — Keycloak émet des jetons et des redirections pour son nom d'hôte configuré. |
| `enable_cloud_armor` | `false` | WAF devant l'IdP — recommandé pour les connexions de production accessibles sur Internet. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

Keycloak n'a pas besoin de stockage d'objets ou de fichiers — `storage_buckets` et `gcs_volumes` sont par défaut `[]` et `enable_nfs` à `false`. Tout l'état est dans PostgreSQL. Toutes les entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Keycloak nécessite PostgreSQL — ne pas modifier. |
| `db_name` | `keycloak` | Nom de la base de données (préfixé par le locataire au moment du déploiement). Immuable après le premier déploiement. |
| `db_user` | `keycloak` | Rôle de l'application (préfixé par le locataire au moment du déploiement). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`, 3 tentatives). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP sur 8080**, délai initial de 30 s, 30 échecs (budget d'environ 330 s) | TCP car `/health` se trouve sur le port de gestion non exposé 9000. Budget généreux pour le démarrage de la JVM + les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60 s | Le chemin racine de Keycloak répond sur 8080 une fois démarré. |
| `uptime_check_config` | désactivé, chemin `/` | Activez pour la production ; Keycloak sert une page d'accueil publique à `/`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak n'utilise pas Redis — laissez `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC — utile pour un IdP détenant des identifiants. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Keycloak n'en utilise aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Keycloak nécessite PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `enable_cloudsql_volume` | `false` | Critique | JDBC ne peut pas utiliser le socket Unix Cloud SQL. Avec une connexion uniquement par socket et sans repli `DB_IP`, Keycloak ne peut pas atteindre PostgreSQL. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit tous les domaines et utilisateurs. |
| `application_version` | ne jamais rétrograder | Critique | Les migrations de schéma Keycloak sont unidirectionnelles ; une rétrogradation corrompt ou refuse le schéma. |
| `container_image_source` | `custom` | Élevé | L'image amont n'a pas le point d'entrée qui mappe les identifiants de base de données, assemble l'URL JDBC et détecte `KC_HOSTNAME` — et elle n'est pas pré-construite pour `start --optimized`. |
| `startup_probe` | TCP sur 8080, ≥30 échecs | Élevé | Une sonde HTTP sur `8080/health` renvoie toujours un 404 (la santé est sur le port 9000) ; la révision ne devient jamais prête même si Keycloak a bien démarré. |
| Administrateur de démarrage | remplacer après la première connexion | Élevé | `admin` + le mot de passe Secret Manager est un identifiant de démarrage **temporaire** ; le laisser comme seul administrateur est un risque permanent. |
| `KC_HOSTNAME` (via `environment_variables`) | explicite lors de l'utilisation d'un domaine personnalisé / équilibreur de charge | Élevé | La détection automatique épingle l'URL `run.app` ; les redirections OIDC et les URL d'émetteur ne correspondent alors pas au domaine que les utilisateurs visitent réellement. |
| `memory_limit` | `2Gi` | Élevé | JVM OOM en dessous d'environ 1 GiB, surtout pendant les migrations au premier démarrage. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` (ou `ALL_TRAFFIC`) | Élevé | Sans egress VPC, le service ne peut pas atteindre l'IP privée de Cloud SQL. |
| `min_instance_count` | `1` pour la production | Moyen | `0` ajoute un démarrage à froid de la JVM de 60 à 120 s à la première redirection SSO après l'inactivité — très visible dans les flux de connexion. |
| `enable_cloud_armor` | activé pour les connexions accessibles sur Internet | Moyen | Les points de terminaison de connexion et d'administration sont autrement non protégés contre le trafic volumétrique/de bourrage d'identifiants. |
| `enable_redis` | `false` | Faible | Keycloak n'utilise pas Redis ; l'activer n'injecte que des variables d'environnement inutilisées. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Keycloak partagée avec la variante GKE est décrite dans **[Keycloak_Common](Keycloak_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Keycloak sur Cloud Run](../labs/Keycloak_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Keycloak sur GKE Autopilot](Keycloak_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Keycloak Common — Configuration d'application partagée](Keycloak_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md), [Infisical sur Google Cloud Run](Infisical_CloudRun.md) dans la solution **SSO Foundation**.
