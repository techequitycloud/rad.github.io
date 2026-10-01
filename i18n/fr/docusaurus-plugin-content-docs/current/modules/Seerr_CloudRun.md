---
title: "Seerr sur Google Cloud Run"
description: "Référence de configuration pour déployer Seerr sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Seerr_CloudRun.md @ 3055034 sha256:f2751051f44a -->

# Seerr sur Google Cloud Run {#seerr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_CloudRun.png" alt="Seerr sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr est la fusion, en 2026, de **Jellyseerr** et d'**Overseerr** — une
interface de demandes open source sous licence MIT, placée devant un serveur
multimédia Jellyfin, Plex ou Emby. Les utilisateurs parcourent et demandent des
titres ; un administrateur approuve la demande, et Seerr appelle les API de
Sonarr et Radarr pour déclencher l'acquisition. Ce module déploie Seerr sur
**Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Seerr et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toute application Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Seerr s'exécute comme un unique conteneur Node.js/Next.js sur Cloud Run v2. Le
déploiement assemble un petit ensemble de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul processus Node.js, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL PostgreSQL 15 | Contient les données de demandes et d'utilisateurs ; les migrations s'exécutent automatiquement à chaque démarrage |
| Stockage d'objets | Cloud Storage | Un bucket `storage` monté sur `/app/config` via GCS FUSE — contient `settings.json`, les paramètres propres à Seerr |
| Cache et file d'attente | aucun | Seerr ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Uniquement le mot de passe de base de données généré — Seerr n'amorce aucun identifiant propre (son premier administrateur provient de l'assistant de configuration web de l'application) |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Réellement préconstruit — aucune image personnalisée.** Le répertoire
  `scripts/` de `Seerr_Common` est vide. `container_image_source = "prebuilt"`
  déploie directement `ghcr.io/seerr-team/seerr` ; il n'y a aucune étape Cloud
  Build pour l'image principale.
- **`DB_TYPE=postgres` est défini sans condition.** La logique de source de
  données de Seerr (`process.env.DB_TYPE === 'postgres'`, confirmée via
  `/app/dist/datasource.js` dans l'image réelle) se rabat sur un fichier SQLite
  interne au conteneur — effacé à chaque redémarrage, sans aucune erreur — si
  cette variable vient à manquer. `Seerr_Common` la définit comme variable
  d'environnement statique, de sorte qu'un déploiement standard est toujours
  correct.
- **Port 5055, chemin de santé `/api/v1/status`.** Confirmé par des tests
  locaux avec `docker run` et par un déploiement réel : `GET /api/v1/status`
  renvoie un `200` non authentifié avec du JSON
  (`{"version":...,"commitTag":...}`) une fois l'application prête.
- **Deux éléments d'état distincts.** PostgreSQL contient les données de
  demandes et d'utilisateurs. Les paramètres propres à Seerr (serveurs
  multimédias connectés, curseurs de découverte, agents de notification) sont
  écrits dans un simple fichier `settings.json` sous `/app/config`
  **quel que soit le backend de base de données** — confirmé par l'inspection
  directe du système de fichiers du conteneur. Ce module monte un volume GCS
  persistant sur ce chemin en plus de la connexion Postgres.
- **`DB_PASS`, et non `DB_PASSWORD`.** La source de données TypeORM de Seerr lit
  une variable d'environnement nommée précisément `DB_PASS` pour le mot de passe
  de la base de données. Ce module définit `db_password_env_var_name = "DB_PASS"`
  en conséquence.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Seerr {#a-cloud-run--the-seerr-service}

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence et la répartition du trafic.

### B. Cloud SQL — données de demandes et d'utilisateurs {#b-cloud-sql--requestuser-data}

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Cloud Storage — le volume des paramètres {#c-cloud-storage--the-settings-volume}

Le bucket `storage` est monté sur `/app/config` via GCS FUSE. Il contient
`settings.json` (ainsi que `settings.old.json`, un répertoire `db/` et `logs/`) —
la configuration applicative propre à Seerr, distincte de tout ce qui est stocké
dans PostgreSQL.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  gcloud storage ls "gs://<bucket-name>/"
  ```

### D. Secret Manager {#d-secret-manager}

Seul le mot de passe de base de données généré automatiquement se trouve ici —
Seerr n'a aucun secret d'identifiant administrateur propre.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
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

## 3. Comportement de l'application Seerr {#3-seerr-application-behaviour}

- **Aucun job de schéma de base de données au premier déploiement.** Le fichier
  `dist/index.js` de Seerr appelle explicitement `dbConnection.runMigrations()`
  à chaque démarrage ; ce module ne comporte donc aucun job
  `db-init`/de migration, et aucun n'est nécessaire. `initialization_jobs` est
  vide par défaut.
- **La configuration initiale se fait entièrement dans l'interface web de
  l'application.** Aucun identifiant administrateur n'est amorcé, de quelque
  sorte que ce soit — ouvrez l'URL du service après le premier déploiement et
  terminez l'assistant de configuration de Seerr : connectez
  Jellyfin/Plex/Emby, puis Sonarr/Radarr.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /api/v1/status` — un `200` non authentifié avec une charge utile JSON
  une fois que l'application a fini de démarrer et de se connecter à Postgres.
- **Inspecter l'exécution des jobs (ne devrait rien afficher, par conception) :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ Le piège DB_TYPE — le point le plus important à connaître sur ce module {#-the-db_type-trap--the-most-important-thing-to-know-about-this-module}

La sélection de la source de données de Seerr repose sur une unique
vérification de variable d'environnement, facile à manquer, confirmée par la
lecture de `/app/dist/datasource.js` dans l'image réellement en cours
d'exécution :

```js
exports.isPgsql = process.env.DB_TYPE === 'postgres';
```

Si `DB_TYPE` n'est pas défini exactement à `postgres`, Seerr se rabat
**silencieusement** sur un fichier de base de données SQLite interne au
conteneur — aucune erreur, aucun avertissement dans les journaux, et un
déploiement qui paraît par ailleurs parfaitement sain (le conteneur démarre, la
vérification de santé réussit, l'interface se charge). Chaque écriture — y
compris toute la configuration initiale — aboutit dans un fichier effacé au
prochain redémarrage ou démarrage à froid.

`Seerr_Common` comble cette lacune avec une variable d'environnement statique
définie sans condition, avant toute `environment_variables` fournie par
l'appelant :

```hcl
environment_variables = merge(
  { DB_TYPE = "postgres" },
  var.environment_variables
)
```

Un déploiement standard de ce module est correct d'emblée. Le risque n'apparaît
que si vous forkez le module Common ou remplacez `environment_variables` en bloc
au lieu d'y superposer des ajouts — vérifiez que `DB_TYPE=postgres` survit à
toute modification de ce type avec :

```bash
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env)' | grep DB_TYPE
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Seerr ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `seerr` | Nom de base des ressources. |
| `display_name` | `Seerr` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Récupéré directement comme tag de l'image `ghcr.io/seerr-team/seerr` — aucune étape de build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5055` | Confirmé via `docker run` en local et un déploiement réel. |
| `container_image_source` | `prebuilt` | Seerr ne prend en charge que l'image officielle ; `Seerr_Common` code également cette valeur en dur en interne. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Voir le §6 ci-dessous — `max_instance_count = 5` est une valeur par défaut plus permissive que ne le suggérerait le modèle de paramètres à écrivain unique de Seerr. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry (évite les limites de débit de GHCR). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Bucket supplémentaire, distinct du bucket `storage` automatique. |
| `gcs_volumes` | `[]` | Le montage du bucket `storage` sur `/app/config` est ajouté automatiquement ; utilisez ce paramètre uniquement pour des volumes *supplémentaires*. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Obligatoire — Seerr ne dispose d'aucun chemin hors Postgres. |
| `db_name` / `db_user` | `seerr` / `seerr` | Transmis à `Seerr_Common`, injectés sous forme de `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critique** — la source de données de Seerr lit précisément `DB_PASS`, et non le `DB_PASSWORD` par défaut du socle. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide, et le reste généralement — `dbConnection.runMigrations()` s'exécute à chaque démarrage au sein même de l'application. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Point de terminaison d'état JSON non authentifié renvoyant `200` ; la valeur par défaut du `variables.tf` propre à la variante (HTTP `/`) est remplacée par la valeur par défaut plus précise de `Seerr_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom et URL du service Cloud Run. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Identifiants de l'instance Cloud SQL et de la base de données Seerr. |
| `storage_buckets` | Le bucket `storage` qui sous-tend `/app/config`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Seerr). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement `DB_TYPE` | Laissez intacte la valeur par défaut de `Seerr_Common` (`postgres`) | **Critique** | Un `DB_TYPE` manquant ou écrasé fait basculer silencieusement Seerr sur un fichier SQLite propre à chaque conteneur, effacé à chaque redémarrage — l'application paraît saine, mais rien n'est conservé. |
| `db_password_env_var_name` | Laissez à `DB_PASS` | **Critique** | La source de données TypeORM de Seerr ne lit que `DB_PASS` ; le `DB_PASSWORD` par défaut du socle n'est jamais lu à lui seul, et l'application ne peut pas s'authentifier auprès de Postgres. |
| `max_instance_count` | Définissez `1` si les modifications de paramètres (configuration des serveurs multimédias, curseurs de découverte, agents de notification) ne doivent jamais entrer en concurrence | Moyen | `settings.json` est un unique fichier modifiable, et non une base de données transactionnelle — des écrivains concurrents issus de plusieurs instances risquent une écriture perdue. La valeur par défaut du module est `5`, plus permissive que la valeur sûre pour un écrivain unique. |
| `gcs_volumes` / stockage sur `/app/config` | Conservez le montage `storage` automatique | **Critique** | Supprimer ou mal configurer ce volume fait perdre tous les paramètres applicatifs (serveurs multimédias, curseurs, agents de notification) au prochain démarrage à froid, même si les données Postgres restent intactes. |
| Chemin de sonde | Laissez à `/api/v1/status` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait la révision durablement non saine, alors que l'application a démarré correctement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à Seerr, partagée avec la variante GKE, est
décrite dans **[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Seerr sur Cloud Run](../labs/Seerr_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Seerr sur GKE Autopilot](Seerr_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Seerr Common — configuration applicative partagée](Seerr_Common.md) — la configuration partagée par les deux cibles de déploiement.
