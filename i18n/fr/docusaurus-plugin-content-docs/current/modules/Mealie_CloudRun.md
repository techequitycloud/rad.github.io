---
title: "Mealie sur Google Cloud Run"
description: "Référence de configuration pour déployer Mealie sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mealie_CloudRun.md @ 3055034 sha256:fb915b9ef24e -->

# Mealie sur Google Cloud Run {#mealie-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mealie_CloudRun.png" alt="Mealie sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mealie est un gestionnaire de recettes et planificateur de repas open source et
auto-hébergé, doté d'un backend FastAPI et d'un frontend Vue, qui propose
l'import automatique de recettes par URL en plus d'un éditeur manuel dans
l'interface. Ce module déploie Mealie sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Mealie et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mealie s'exécute sous forme d'un unique conteneur FastAPI/Vue sur Cloud Run v2. Le
déploiement assemble un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service FastAPI, 1 vCPU / 512 MiB par défaut, mise à l'échelle à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Mealie lit des variables d'environnement `POSTGRES_*` distinctes, et non un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les images des recettes et monté automatiquement sur `/app/data` |
| Cache et file d'attente | aucun | Mealie ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — Mealie n'a aucun identifiant administrateur configurable par variable d'environnement |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Mealie_Common` fixe
  `database_type = "POSTGRES_15"` et définit explicitement `DB_ENGINE=postgres` —
  sinon, Mealie utilise par défaut SQLite embarqué.
- **Aucun build de conteneur personnalisé.** Les variables d'environnement
  Postgres distinctes de Mealie ne nécessitent aucune construction de DSN ;
  l'image officielle préconstruite (`ghcr.io/mealie-recipes/mealie`) est donc
  utilisée directement.
- **Un compte administrateur par défaut, et non une première inscription — et il
  n'est PAS configurable.** Contrairement à certaines applications de ce
  catalogue, Mealie ne permet pas au premier visiteur de s'inscrire lui-même en
  tant qu'administrateur, et contrairement aux versions antérieures de Mealie, son
  identifiant initial ne peut plus être défini via des variables d'environnement
  (les paramètres sous-jacents sont des champs privés, non liables à
  l'environnement, depuis la v3.x — voir le [guide Common](Mealie_Common.md) pour
  le détail au niveau du code source). Chaque déploiement démarre avec le **même
  compte bien connu** : `changeme@example.com` / `MyPassword`. Connectez-vous
  immédiatement après le premier déploiement et modifiez à la fois le mot de
  passe et, idéalement, l'adresse e-mail de l'administrateur — Mealie impose une
  réinitialisation du mot de passe à la première connexion, ce qui constitue ici
  la véritable barrière de sécurité, et non le secret de l'identifiant initial.
- **Les images des recettes sont persistées par défaut.** `Mealie_Common` déclare
  une entrée `gcs_volumes` qui monte le bucket GCS `data` sur le chemin
  `/app/data` de Mealie, afin que les images de recettes téléversées survivent au
  redémarrage d'une révision. Les données *textuelles* des recettes ne sont pas
  concernées dans un cas comme dans l'autre (elles sont stockées dans
  PostgreSQL).
- **Facturation à la requête par défaut.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — l'extraction des recettes importées par URL dans
  Mealie s'exécute de manière synchrone dans la requête qui la déclenche, et non
  en tant que tâche d'arrière-plan.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Mealie {#a-cloud-run--the-mealie-service}

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence et
la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Mealie stocke toutes les recettes, tous les plans de repas et toutes les données
utilisateur dans une instance Cloud SQL for PostgreSQL 15 gérée, à laquelle il se
connecte de manière privée via le **Cloud SQL Auth Proxy** par un socket Unix. Au
premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` est provisionné automatiquement pour les images des recettes et
est monté par défaut dans le conteneur sur `/app/data`.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mealie {#3-mealie-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`, ce
  qui crée de manière idempotente le rôle et la base de données de
  l'application.
- **Migrations du schéma au démarrage.** Mealie applique automatiquement ses
  propres migrations internes à chaque démarrage.
- **Identifiant administrateur par défaut fixe — non configurable.** Mealie crée
  `changeme@example.com` / `MyPassword` lors de la première initialisation de la
  base de données. Il s'agit d'une valeur par défaut codée en dur en amont (aucune
  variable d'environnement ne la remplace depuis la v3.x), et non d'un secret
  généré — une réinitialisation du mot de passe est imposée à la première
  connexion, et les opérateurs doivent l'effectuer immédiatement après le
  déploiement.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent
  `/api/app/about` — le véritable point de terminaison d'information non
  authentifié de Mealie.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Mealie ou notables pour
lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mealie` | Nom de base des ressources. |
| `application_version` | `latest` | Mealie publie un véritable tag `latest` — aucune réassociation nécessaire. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire — les variables d'environnement Postgres distinctes ne nécessitent aucune construction de DSN. |
| `container_port` | `9000` | Port natif par défaut de Mealie. |
| `cpu_always_allocated` | `false` | Facturation à la requête. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à l'échelle à zéro par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement sur `/app/data` pour les images des recettes. |
| `gcs_volumes` | `[]` | Une liste vide signifie « utiliser le propre montage `/app/data` de `Mealie_Common` » ; une liste non vide le remplace. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Expose la variable `DB_HOST` de la plateforme sous le nom attendu par Mealie. |
| `db_user_env_var_name` | `POSTGRES_USER` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Alias de `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/app/about`, délai de 30s | Les sondes ciblent le véritable point de terminaison d'information de Mealie. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Cloud Run et URL `run.app` par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` des images des recettes. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | High | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module — le build échoue. |
| Identifiant administrateur par défaut (`changeme@example.com` / `MyPassword`) | Connectez-vous et modifiez-le immédiatement après le premier déploiement | **Critical** | Il s'agit d'une valeur par défaut amont fixe et documentée publiquement — et non d'un secret généré — dès que la base de données est initialisée, quiconque connaît l'identifiant par défaut de Mealie peut se connecter tant que vous n'avez pas effectué la réinitialisation du mot de passe imposée à la première connexion. |
| `gcs_volumes` pour les images des recettes | Laisser vide (utiliser le propre montage `/app/data` du module) | Medium | `Mealie_Common` monte déjà le bucket `data` sur `/app/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas aussi `/app/data`, les images de recettes téléversées retombent sur le système de fichiers éphémère de Cloud Run et ne survivent pas au redémarrage d'une révision. Le texte des recettes n'est pas concerné. |
| Variables `db_*_env_var_name` | Les laisser à leurs valeurs par défaut propres à Mealie | Critical | Les modifier ou les vider casse entièrement la connexion Postgres de Mealie — il lit `POSTGRES_*`, et non `DB_*`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Mealie, partagée avec la variante GKE, est décrite dans
**[Mealie_Common](Mealie_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mealie sur Cloud Run](../labs/Mealie_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mealie sur GKE Autopilot](Mealie_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mealie Common — Configuration applicative partagée](Mealie_Common.md) — la configuration partagée par les deux cibles de déploiement.
