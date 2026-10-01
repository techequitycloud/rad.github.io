---
title: "Homebox sur Google Cloud Run"
description: "Référence de configuration pour déployer Homebox sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Homebox_CloudRun.md @ 3055034 sha256:53bc0498088b -->

# Homebox sur Google Cloud Run {#homebox-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_CloudRun.png" alt="Homebox sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox est un système open source et auto-hébergé d'inventaire et d'organisation
domestique, doté d'un backend d'API REST en Go (de style Echo, ORM Ent) et d'un
frontend Vue 3/Nuxt servi de manière intégrée par le même binaire — suivez vos
objets, joignez des photos et organisez-les par emplacement. Ce module déploie
Homebox sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Homebox et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Homebox s'exécute sous la forme d'un unique binaire Go (API + frontend intégré)
sur Cloud Run v2. Le déploiement assemble un ensemble restreint et ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go/Echo, 1 vCPU / 512 MiB par défaut, mise à l'échelle à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Homebox lit des variables d'environnement `HBOX_DATABASE_*` distinctes, et non un DSN construit |
| Stockage objet | Cloud Storage | Un bucket `data` est créé pour les photos et pièces jointes des objets et monté automatiquement sur `/data` |
| Cache et file d'attente | aucun | Homebox ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données plus `HBOX_AUTH_API_KEY_PEPPER` (un véritable secret consommé par l'application) |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Homebox_Common` fixe
  `database_type = "POSTGRES_15"` et définit explicitement
  `HBOX_DATABASE_DRIVER=postgres` — sinon, Homebox utilise par défaut SQLite
  intégré, dont le DSN par défaut impose `journal_mode=WAL`, ce qui n'est pas sûr
  sur NFS/gcsfuse.
- **Aucun build de conteneur personnalisé.** Les variables d'environnement
  Postgres distinctes de Homebox ne nécessitent aucune construction de DSN ;
  l'image préconstruite officielle (`ghcr.io/sysadminsmedia/homebox`) est donc
  utilisée directement.
- **Inscription libre, et non un compte administrateur par défaut.**
  Contrairement à certaines applications de ce catalogue, Homebox n'est pas livré
  avec un identifiant codé en dur : la première personne qui soumet le formulaire
  « Register » sur une instance neuve devient l'utilisateur administrateur
  initial. Il n'y a pas de risque de sécurité lié à des identifiants par défaut,
  mais les opérateurs doivent ensuite définir
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` pour fermer les inscriptions publiques —
  consultez le [guide Common](Homebox_Common.md) pour plus de détails.
- **Les photos des objets sont conservées par défaut.** `Homebox_Common` déclare
  une entrée `gcs_volumes` qui monte le bucket GCS `data` sur le chemin `/data` de
  Homebox, afin que les photos et pièces jointes téléversées survivent au
  redémarrage d'une révision. Les *métadonnées* des objets ne sont pas concernées
  dans un cas comme dans l'autre (elles sont stockées dans PostgreSQL).
- **Facturation à la requête par défaut.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Homebox est une simple application
  requête/réponse, sans planificateur en arrière-plan ni worker de file
  d'attente.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Homebox {#a-cloud-run--the-homebox-service}

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Homebox stocke toutes les données des objets, des emplacements et des
utilisateurs dans une instance gérée Cloud SQL for PostgreSQL 15, connectée en
privé via le **Cloud SQL Auth Proxy** sur un socket Unix. Au premier déploiement,
un Job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` est provisionné automatiquement pour les photos et pièces jointes
des objets, et il est monté par défaut dans le conteneur sur `/data`.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Comportement de l'application Homebox {#3-homebox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`,
  créant de manière idempotente le rôle et la base de données de l'application.
- **Migrations de schéma au démarrage.** L'ORM Ent de Homebox applique
  automatiquement ses propres migrations internes à chaque démarrage — aucun job
  de migration distinct ne s'exécute au niveau de la plateforme.
- **Inscription libre — aucun identifiant administrateur par défaut.** Le premier
  visiteur qui remplit le formulaire « Register » devient l'administrateur. Il n'y
  a aucun identifiant à récupérer, réinitialiser ou faire tourner — définissez
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois le compte administrateur créé
  pour fermer les inscriptions publiques.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/v1/status` — le véritable point de terminaison d'état de Homebox, non
  authentifié, confirmé par l'instruction `HEALTHCHECK` du Dockerfile officiel
  lui-même.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Homebox ou notables pour
lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homebox` | Nom de base des ressources. |
| `application_version` | `latest` | Homebox publie un véritable tag `latest` — aucun remappage nécessaire. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire — les variables d'environnement Postgres distinctes ne requièrent aucune construction de DSN. |
| `container_port` | `7745` | Port par défaut natif de Homebox. |
| `cpu_always_allocated` | `false` | Facturation à la requête. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à l'échelle à zéro par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement sur `/data` pour les photos des objets. |
| `gcs_volumes` | `[]` | Une liste vide signifie « utiliser le montage `/data` propre à `Homebox_Common` » ; une liste non vide le remplace. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Associe la variable `DB_HOST` de la plateforme au nom attendu par Homebox. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Alias de `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status`, délai de 30s | Les sondes ciblent le véritable point de terminaison d'état de Homebox. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Cloud Run et URL `run.app` par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` des photos et pièces jointes des objets. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile alors que ce module ne contient pas de Dockerfile — le build échoue. |
| Première inscription | À effectuer rapidement après le déploiement | **Moyen** | La première personne à s'inscrire sur une instance neuve accessible publiquement devient l'administrateur — tant que vous ne vous êtes pas inscrit et n'avez pas défini `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, quiconque découvre l'URL peut s'approprier le compte administrateur. |
| `gcs_volumes` pour les photos des objets | Laisser vide (utiliser le montage `/data` propre au module) | **Élevé** | `Homebox_Common` monte déjà le bucket `data` sur `/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas aussi `/data`, les photos et pièces jointes téléversées retombent sur le système de fichiers éphémère de Cloud Run et ne survivent pas au redémarrage d'une révision. Les métadonnées des objets ne sont pas concernées. |
| Variables `db_*_env_var_name` | Conserver leurs valeurs par défaut propres à Homebox | Critique | Les modifier ou les vider rompt entièrement la connexion Postgres de Homebox — il lit `HBOX_DATABASE_*`, et non `DB_*`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Homebox, partagée avec la variante GKE, est décrite dans
**[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homebox sur Cloud Run](../labs/Homebox_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Homebox sur GKE Autopilot](Homebox_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homebox Common — Configuration applicative partagée](Homebox_Common.md) — la configuration partagée par les deux cibles de déploiement.
