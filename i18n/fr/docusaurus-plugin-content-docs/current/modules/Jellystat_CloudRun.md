---
title: "Jellystat sur Google Cloud Run"
description: "Référence de configuration pour déployer Jellystat sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Jellystat_CloudRun.md @ 3055034 sha256:5548e870bf8d -->

# Jellystat sur Google Cloud Run {#jellystat-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellystat_CloudRun.png" alt="Jellystat sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Jellystat](https://github.com/CyferShepard/Jellystat) est un tableau de bord open
source de statistiques et d'analyse pour les serveurs multimédias
[Jellyfin](https://jellyfin.org/), qui suit l'historique de lecture, les sessions
actives, l'activité des utilisateurs, la croissance des bibliothèques et les
tendances de visionnage. Ce module déploie Jellystat sur **Cloud Run v2** au-dessus
du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Jellystat et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Jellystat s'exécute comme un conteneur Node.js/Express unique (avec un frontend
React intégré) sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique serverless ; mise à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — noms de variables d'environnement `POSTGRES_*` non standard |
| Stockage objet | Cloud Storage | Un petit bucket `backups` facultatif pour les archives d'export de la base de données |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée.
- **Noms de variables d'environnement de base de données non standard.** Jellystat
  lit `POSTGRES_IP`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` et
  `POSTGRES_DATABASE` — **pas** `POSTGRES_DB`** (la communauté a confirmé que ce nom
  ne fonctionne pas), ni les noms génériques `DB_*` de la plateforme. Les deux jeux
  sont injectés côte à côte via l'aliasing `db_*_env_var_name` de `main.tf`.
- **`container_port = 3000` est fixe.** Le serveur de Jellystat code ce port en dur ;
  il n'est pas configurable par variable d'environnement (voir l'issue amont #314).
  La variable n'existe que par souci de cohérence avec les conventions du socle.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il
  signe les jetons de session/d'authentification de Jellystat.
- **Pas de prise en charge de Redis.** Jellystat n'a aucune intégration native de
  Redis ; `enable_redis` et les variables associées sont inertes.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent quelques secondes de latence à la première requête
  après une période d'inactivité.
- **Aucune variable d'environnement n'associe Jellystat à un serveur Jellyfin.**
  C'est le fait opérationnel le plus important concernant ce module : la connexion
  de Jellystat à Jellyfin (URL du serveur + clé d'API) se saisit entièrement via sa
  propre interface web après le premier démarrage, et n'a aucun équivalent
  automatisable par Terraform. Voir le §3 ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Jellystat {#a-cloud-run--the-jellystat-service}

Jellystat s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge des requêtes, entre les nombres minimal et maximal
d'instances.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Jellystat stocke toutes ses données de lecture et d'analyse dans une instance gérée
Cloud SQL for PostgreSQL 15. Le service s'y connecte de manière privée via le
**Cloud SQL Auth Proxy** sur un socket Unix. Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.
Jellystat applique ensuite automatiquement ses propres migrations de schéma au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un petit bucket **Cloud Storage** facultatif (`backups`) est provisionné pour la
fonctionnalité d'export/archivage de sauvegarde de la base de données propre à
Jellystat.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`JWT_SECRET` (utilisé pour signer les jetons de session/d'authentification de
Jellystat). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Jellystat {#3-jellystat-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de
  données de l'application. Le job peut être relancé sans risque.
- **Migrations de la base de données au démarrage.** Jellystat applique
  automatiquement ses propres migrations de schéma à chaque démarrage — ce module ne
  comporte aucun job de migration distinct.
- **`JWT_SECRET` est généré une seule fois et stocké dans Secret Manager.** Sa
  rotation invalide toutes les sessions utilisateur actives (les utilisateurs doivent
  se reconnecter), mais n'entraîne aucune perte de données.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `GET /auth/isConfigured` — un point de terminaison public et non
  authentifié qui renvoie 200 dès que le serveur est démarré.
- **L'association manuelle à Jellyfin est requise après le premier démarrage — elle
  ne peut pas être automatisée par Terraform.** Jellystat n'a aucune variable
  d'environnement pour l'URL ou la clé d'API du serveur Jellyfin associé ;
  l'association se fait entièrement via l'interface :
  1. Ouvrez l'URL de Jellystat déployé et créez le premier compte administrateur.
  2. Dans le Dashboard → API Keys de votre propre serveur Jellyfin, générez une
     nouvelle clé d'API pour Jellystat.
  3. Dans les paramètres de Jellystat, saisissez l'URL de votre serveur Jellyfin et
     collez cette clé d'API.
  Si vous n'avez pas encore de serveur Jellyfin déployé, déployez-en d'abord un avec
  le module apparenté **Jellyfin_CloudRun** (ou **Jellyfin_GKE**) — consultez son
  propre guide de configuration.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Jellystat ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellystat` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Jellystat` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image de conteneur — transmis comme tag de l'image `cyfershepard/jellystat`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `cyfershepard/jellystat`. Ne définissez pas `custom` — il n'existe pas de Dockerfile pour cette application. |
| `container_image` | `""` | Laissez vide pour utiliser l'image par défaut. |
| `container_port` | `3000` | Fixe — correspond au port interne codé en dur de Jellystat. Modifier cette variable n'a aucun effet sur l'application. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Ressources du conteneur. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à zéro par défaut. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé — Jellystat n'a pas besoin de stockage de fichiers partagé. |
| `create_cloud_storage` | `true` | Crée le petit bucket `backups`. |
| `gcs_volumes` | `[]` | Non utilisé par défaut. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe. |
| `application_database_name` | `jellystat_db` | Injecté à la fois comme `DB_NAME` et `POSTGRES_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `jellystat_user` | Injecté à la fois comme `DB_USER` et `POSTGRES_USER`. |
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/auth/isConfigured` | Point de terminaison de santé public et non authentifié. |
| `uptime_check_config` | `{ enabled = false, path = "/auth/isConfigured" }` | À activer explicitement. |

### Groupe 21 — Redis (non utilisé) {#group-21--redis-not-consumed}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | désactivé / vide | **Non utilisé.** Jellystat n'a aucune intégration native de Redis. |

Toutes les autres entrées sont héritées d'[App_CloudRun.md](App_CloudRun.md) avec
leur comportement standard.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (`backups`). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État de la surveillance et tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `JWT_SECRET` (généré automatiquement) | À ne faire tourner que délibérément | Moyen | Sa rotation invalide toutes les sessions actives — les utilisateurs doivent se reconnecter — mais n'entraîne aucune perte de données. |
| `container_image_source` | `prebuilt` | Critique | Définir `custom` fait échouer l'étape Cloud Build — ce catalogue ne contient pas de Dockerfile pour Jellystat. |
| `container_port` | `3000` (à titre informatif) | Faible | Le serveur de Jellystat code le port 3000 en dur, quelle que soit la valeur de cette variable. |
| Association URL/clé d'API Jellyfin | Manuelle, après le déploiement | Élevé | Il n'existe aucune variable d'environnement pour cela — omettre l'étape manuelle dans l'interface laisse Jellystat sans aucune donnée, même si le déploiement est sain. |
| `enable_redis` | laisser `false` | Faible | Jellystat n'a aucune intégration Redis ; définir `true` n'a aucun effet. |
| Chemin de `startup_probe`/`liveness_probe` | `/auth/isConfigured` | Élevé | Diriger les sondes vers un point de terminaison authentifié provoque des 401/403 et la révision ne devient jamais Ready. |
| `min_instance_count` | `0` (par défaut) convient | Faible | Jellystat est un tableau de bord requête/réponse sans planificateur en arrière-plan — inutile de disposer d'un CPU toujours actif. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et simultanéité, entrée et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Jellystat, partagée avec la variante GKE, est décrite dans
**[Jellystat_Common](Jellystat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellystat sur Cloud Run](../labs/Jellystat_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jellystat sur GKE Autopilot](Jellystat_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellystat Common — Configuration applicative partagée](Jellystat_Common.md) — la configuration partagée par les deux cibles de déploiement.
