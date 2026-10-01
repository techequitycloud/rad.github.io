---
title: "Authentik sur Google Cloud Run"
description: "Référence de configuration pour déployer Authentik sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Authentik_CloudRun.md @ 3055034 sha256:a7cde13ee297 -->

# Authentik sur Google Cloud Run {#authentik-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_CloudRun.png" alt="Authentik sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) est un fournisseur d'identité
open source (MIT, open-core) : authentification unique via OIDC et SAML, LDAP et
SCIM, authentification multifacteur et authentification par proxy — une alternative
auto-hébergée à Okta, Auth0 et Keycloak. Ce module déploie authentik sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise authentik et sur la façon de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

authentik s'exécute comme un conteneur Python/Django sur Cloud Run v2, son worker
d'arrière-plan (`ak worker`) étant colocalisé dans le même conteneur. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur + worker colocalisé, 2 vCPU / 2 GiB par défaut, CPU toujours allouée, 1 instance minimum |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — authentik a besoin de PostgreSQL ≥ 14 ; MySQL est bloqué |
| Cache et file d'attente | **Aucun — pas de Redis** | authentik ≥ 2025.10 a déplacé le cache, les sessions, la file de tâches et la couche de canaux WebSocket dans PostgreSQL |
| Stockage des médias | Cloud Storage (GCS Fuse) | Bucket monté sur `/media` pour les icônes téléversées et les arrière-plans des flux |
| Secrets | Secret Manager | `AUTHENTIK_SECRET_KEY` stable, mot de passe d'amorçage de `akadmin`, mot de passe de la base de données |
| Image | Artifact Registry + Cloud Build | Build personnalisé léger `FROM ghcr.io/goauthentik/server` (point d'entrée cloud + lanceur du worker) |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et constitue le *seul* magasin de données.** Pas de
  Redis, pas de backend de recherche — les sessions, le cache et la file de tâches
  résident tous dans Cloud SQL.
- **Le worker est colocalisé.** Le point d'entrée du conteneur démarre `ak worker` en
  arrière-plan à côté du serveur (le même modèle que le worker Sidekiq de Chatwoot).
  C'est pourquoi `cpu_always_allocated = true` et `min_instance_count = 1` sont les
  valeurs par défaut : les tâches planifiées, la synchronisation des outposts et la
  file d'attente adossée à Postgres doivent continuer à être traitées entre les
  requêtes, les outposts maintiennent un WebSocket vers le serveur, et la latence de
  connexion compte pour un IdP. La variable documente le retour en arrière pour les
  labs/démos (`false` + `min_instance_count = 0`).
- **`max_instance_count = 5`.** authentik est sans état d'une instance à l'autre —
  tout l'état est dans PostgreSQL — si bien que plusieurs instances (chacune avec son
  propre worker) ne posent pas de problème.
- **`AUTHENTIK_SECRET_KEY` est généré automatiquement** et stocké dans Secret
  Manager. Il doit rester stable pendant toute la durée de vie du déploiement — le
  renouveler invalide toutes les sessions et rend illisibles les champs chiffrés.
- **Le compte administrateur `akadmin` est amorcé au premier démarrage** avec
  `bootstrap_email` (par défaut `admin@techequity.cloud`) et un mot de passe stocké
  dans Secret Manager. Les variables d'amorçage ne s'appliquent qu'au **premier**
  démarrage.
- **`application_version = "latest"` est épinglé.** authentik ne publie pas de tag
  `latest` sur GHCR ; le build épingle `latest` sur une version éprouvée
  (`2026.5.4`) via l'ARG de build propre à l'application `AUTHENTIK_VERSION`.
- **Les migrations s'exécutent automatiquement au démarrage** (protégées par un
  verrou consultatif), si bien que les mises à niveau de version ne nécessitent pas de
  job de migration distinct — le seuil généreux de la sonde de démarrage couvre la
  série de migrations du premier démarrage.
- **Les points de terminaison de contrôle d'état ne sont pas authentifiés** :
  démarrage `GET /-/health/ready/`, vivacité `GET /-/health/live/`.
- **Les outposts LDAP/RADIUS sont hors périmètre sur Cloud Run** (écouteurs
  persistants non HTTP). Le SSO navigateur (OIDC/SAML) et l'outpost embarqué
  fonctionnent normalement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service authentik {#a-cloud-run--the-authentik-service}

authentik s'exécute comme un service Cloud Run v2 avec une facturation à l'instance
(CPU toujours allouée) afin que le worker colocalisé continue son traitement entre
les requêtes. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

authentik stocke *tout* ici — utilisateurs, groupes, flux, fournisseurs, sessions,
cache et file de tâches d'arrière-plan. Le service se connecte de manière privée via
le **Cloud SQL Auth Proxy** sur un socket Unix ; le point d'entrée du conteneur
mappe les variables `DB_*` injectées sur la convention `AUTHENTIK_POSTGRESQL__*`
d'authentik et définit le mode SSL selon le type de connexion. Lors du premier
déploiement, un unique job `db-init` crée la base de données et le rôle propres au
locataire.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs) (les noms de la base de données et de
l'utilisateur sont préfixés par le locataire). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et le
renouvellement du mot de passe.

### C. Cloud Storage — médias {#c-cloud-storage--media}

Un bucket dédié est monté sur `/media` via GCS Fuse pour les médias téléversés
(icônes d'applications, arrière-plans des flux). Les téléversements survivent au
remplacement des instances et à la mise à l'échelle.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets authentik sont générés automatiquement :

- `AUTHENTIK_SECRET_KEY` — signe les sessions/cookies et sert à dériver le
  chiffrement interne. **Ne le renouvelez jamais.**
- `AUTHENTIK_BOOTSTRAP_PASSWORD` — le mot de passe initial d'`akadmin`, appliqué au
  premier démarrage uniquement.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~authentik"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [Authentik_Common](Authentik_Common.md) pour le modèle de secrets complet.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté par-dessus. Pour un IdP, un nom d'hôte stable et protégé par TLS est
important — les URI de redirection OIDC/SAML que vous enregistrez dans les
applications clientes doivent correspondre à l'URL par laquelle les utilisateurs
atteignent authentik.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du serveur **et du worker** sont tous envoyés vers Cloud Logging (ils
partagent le stdout/stderr du conteneur). Les métriques Cloud Run et Cloud SQL sont
envoyées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application authentik {#3-authentik-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un unique job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine` : il attend
  PostgreSQL, crée le rôle et la base de données propres au locataire, accorde les
  privilèges et accorde par précaution `cloudsqlsuperuser` (afin que tout futur
  `CREATE EXTENSION` dans les migrations amont réussisse). Le job est idempotent et
  peut être relancé sans risque.
- **Démarrage avec auto-migration.** Le serveur d'authentik exécute ses propres
  migrations Django à chaque démarrage, protégées par un verrou consultatif
  PostgreSQL. Il n'y a pas de job de migration distinct. Le premier démarrage exécute
  la série complète — comptez plusieurs minutes avant que `/-/health/ready/` ne
  renvoie 200 ; la sonde de démarrage accorde ~11 minutes.
- **Première connexion.** Connectez-vous en tant que **`akadmin`** avec la valeur de
  `bootstrap_email` et le mot de passe du secret `...-bootstrap-password`. Si les
  variables d'amorçage étaient absentes au premier démarrage, terminez plutôt la
  configuration sur `<service-url>/if/flow/initial-setup/`.
- **Les applications et les fournisseurs se configurent dans l'application après le
  déploiement.** Les fournisseurs OIDC/SAML, les applications, les outposts et les
  flux relèvent de la configuration d'authentik, et non d'entrées Terraform —
  créez-les dans l'interface d'administration (`<service-url>/if/admin/`) une fois le
  service démarré.
- **Colocalisation du worker.** `ak worker` s'exécute dans le même conteneur ; ses
  lignes de journal sont entremêlées avec celles du serveur dans Cloud Logging. Il
  nécessite la CPU toujours allouée par défaut — passer à une facturation à la
  requête bride le worker entre les requêtes.
- **Points de terminaison de contrôle d'état.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspectez l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à authentik ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `bootstrap_email` | `admin@techequity.cloud` | Adresse e-mail du compte intégré `akadmin`, définie au premier démarrage. |
| `bootstrap_password` | `""` (généré automatiquement) | Mot de passe initial d'`akadmin`. **Premier démarrage uniquement** ; stocké dans Secret Manager. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `authentik` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version d'authentik ; `latest` est épinglé sur `2026.5.4` au moment du build (pas de tag `latest` en amont). Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Image wrapper légère construite via Cloud Build (ajoute le point d'entrée cloud + le lanceur du worker). |
| `cpu_limit` | `2000m` | CPU par instance — partagée par le serveur et le worker. |
| `memory_limit` | `2Gi` | Mémoire par instance — 2 GiB est le plancher fiable pour serveur + worker. |
| `cpu_always_allocated` | `true` | **Laissez à true.** Le worker colocalisé et les WebSockets des outposts travaillent entre les requêtes. Passez à `false` + `min_instance_count = 0` uniquement pour un démarrage à froid privilégiant le coût en lab/démo. |
| `min_instance_count` | `1` | Maintient le worker en fonctionnement et les WebSockets des outposts connectés. |
| `max_instance_count` | `5` | Peut être augmenté sans risque — authentik est sans état d'une instance à l'autre. |
| `container_port` | `9000` | Port HTTP d'authentik. |
| `enable_cloudsql_volume` | `true` | Socket Unix de l'Auth Proxy — le point d'entrée définit `SSLMODE=disable` pour l'Auth Proxy (répertoire de socket ou TCP en loopback ; le proxy ne parle pas SSL lui-même), et `require` uniquement pour une connexion TCP directe vers tout autre hôte. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |

### Groupe 5 — Contrôle de l'accès et de l'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | authentik est un IdP destiné aux utilisateurs ; les navigateurs et les redirections OAuth doivent pouvoir l'atteindre. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Placer IAP devant un IdP impose une double barrière à chaque connexion et bloque les callbacks OIDC des identités non Google — laissez-le désactivé sauf si vous savez en avoir besoin. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `AUTHENTIK_*` supplémentaires (p. ex. e-mail/SMTP : `AUTHENTIK_EMAIL__HOST`, …). Ne définissez pas `AUTHENTIK_SECRET_KEY` ni `AUTHENTIK_POSTGRESQL__*` ici. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et domaine personnalisé {#group-10--load-balancer-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Équilibreur de charge HTTPS global + WAF Cloud Armor — recommandé pour un IdP public. |
| `application_domains` | `[]` | Nom(s) d'hôte personnalisé(s). Enregistrez les URI de redirection OIDC sur le domaine que les utilisateurs atteignent réellement. |
| `enable_cdn` | `false` | Le CDN apporte peu à un IdP (trafic dynamique et authentifié). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `/media` est déclaré par `Authentik_Common`. |
| `enable_nfs` | `true` | Facultatif ; authentik conserve les médias sur GCS, pas sur NFS. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires ; `/media` est ajouté automatiquement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik exige PostgreSQL — les valeurs MySQL sont rejetées par la validation. |
| `db_name` | `authentik` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `db_user` | `authentik` | Nom de base de l'utilisateur applicatif de la base de données (préfixé par le locataire). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser l'unique job `db-init` intégré. |
| `cron_jobs` | `[]` | Inutile — le worker colocalisé exécute les tâches planifiées d'authentik. |

### Groupe 14 — Observabilité et contrôles d'état {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, délai de 60s, 40×15s | Non authentifiée. Seuil généreux pour les migrations du premier démarrage (budget d'~11 min). |
| `liveness_probe` | HTTP `/-/health/live/`, délai de 60s, 3×30s | Vérification non authentifiée que le processus est actif. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif (à pointer vers `/-/health/live/`). |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Inerte.** authentik ≥ 2025.10 a entièrement supprimé Redis ; `main.tf` fixe `enable_redis = false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsque le déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Noms des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative (préfixés par le locataire). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (généré automatiquement) | Ne jamais le renouveler | Critique | Le renouveler invalide **toutes** les sessions actives et rend illisibles les champs chiffrés (identifiants et jetons stockés). |
| `database_type` | `POSTGRES_15` | Critique | MySQL est bloqué par la validation — authentik exige PostgreSQL ≥ 14. |
| `db_name` / `db_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données d'identité. |
| Ports d'écoute du worker (gérés par le point d'entrée) | Conserver les valeurs par défaut en loopback `AUTHENTIK_LISTEN__*` du point d'entrée | Critique | Le `ak worker` colocalisé démarre lui aussi un écouteur HTTP et hérite de la valeur par défaut du serveur, `0.0.0.0:9000` ; s'il remporte la course au bind, il répond à **toutes** les routes — points de contrôle d'état compris — par des 200 vides : une interface blanche avec des sondes faussement saines. Le point d'entrée cantonne le worker à des ports en loopback (`127.0.0.1:9001`/`9444`/`9301`) afin que le serveur possède `:9000` — un 200 avec un corps vide signifie que le mauvais processus a répondu. |
| `min_instance_count` | `1` (avec CPU toujours allouée) | Élevé | `0` laisse l'instance disparaître : les WebSockets des outposts se déconnectent et les tâches d'arrière-plan (jobs planifiés, synchronisation des outposts) sont retardées jusqu'à ce que la requête suivante réveille une instance. |
| `cpu_always_allocated` | `true` | Élevé | La facturation à la requête bride le worker colocalisé entre les requêtes — la file de tâches se bloque même avec `min=1`. |
| `startup_probe.path` | `/-/health/ready/` (non authentifié) | Moyen | Pointer la sonde vers une page authentifiée renvoie 401/403 au sondeur — la révision ne devient jamais prête alors qu'authentik a bien démarré. |
| `bootstrap_password` / `bootstrap_email` | À définir avant le premier déploiement | Moyen | Appliqués au **premier** démarrage uniquement. Les modifier ensuite n'a aucun effet — gérez `akadmin` dans l'application, ou utilisez `/if/flow/initial-setup/` si les variables d'amorçage étaient absentes au premier démarrage. |
| `application_version` | Épingler une version | Moyen | `latest` est silencieusement épinglé sur `2026.5.4` ; un épinglage explicite rend les mises à niveau délibérées. Des tags inexistants font échouer le Cloud Build avec `MANIFEST_UNKNOWN`. |
| `memory_limit` | `2Gi` | Moyen | Le serveur et le worker partagent la limite ; des valeurs plus basses exposent à un OOM pendant les migrations ou les imports de flux. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Ne pas définir | Moyen | Le point d'entrée mappe les valeurs `DB_*` injectées ; coder en dur des noms de base de données courts conduit à s'authentifier avec un rôle inexistant (les noms sont préfixés par le locataire). |
| Outposts LDAP/RADIUS | Pas sur Cloud Run | Faible | Les écouteurs non HTTP ne peuvent pas être servis par Cloud Run — utilisez la variante GKE ou un hôte externe pour ces outposts. |
| `enable_iap` | `false` | Moyen | IAP impose une double barrière à chaque connexion et casse les callbacks OAuth/SAML provenant de tiers externes. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à authentik partagée avec la variante GKE est décrite dans
**[Authentik_Common](Authentik_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Authentik sur Cloud Run](../labs/Authentik_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Authentik sur GKE Autopilot](Authentik_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Authentik Common — Configuration applicative partagée](Authentik_Common.md) — la configuration partagée par les deux cibles de déploiement.
