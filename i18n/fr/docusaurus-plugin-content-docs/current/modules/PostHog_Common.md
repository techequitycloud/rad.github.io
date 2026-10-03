---
title: "PostHog Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module PostHog — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PostHog_Common.md @ 15fd4c7 sha256:566090c451f4 -->

# PostHog Common — Configuration d'application partagée {#posthog-common--shared-application-configuration}

`PostHog_Common` est la **couche d'application partagée** pour PostHog. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à PostHog sur laquelle [PostHog_GKE](PostHog_GKE.md) s'appuie. Contrairement à la plupart des paires d'applications de ce catalogue, il n'y a délibérément **pas de variante `PostHog_CloudRun`** — le pipeline d'événements de PostHog exige Kafka (ingestion) et ClickHouse (le magasin d'événements analytiques), tous deux des services avec état et de longue durée incompatibles avec le modèle sans serveur et de mise à l'échelle à zéro de Cloud Run — donc `PostHog_GKE` est le seul consommateur de cette couche. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute PostHog, consultez le guide de la plateforme ([PostHog_GKE](PostHog_GKE.md)) et le guide de la fondation ([App_GKE](App_GKE.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par PostHog_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé léger `FROM posthog/posthog` ajoutant un point d'entrée cloud plus un remplacement `docker-boot.sh` ; builds via Cloud Build avec l'ARG de build `POSTHOG_VERSION` spécifique à l'application | Sortie `container_image` du déploiement de la plateforme |
| Résolution de version | `application_version = "latest"` est utilisé tel quel — `posthog/posthog` publie une balise `latest` réellement fraîche suivant master, contrairement à plusieurs applications de ce catalogue qui nécessitent une substitution de balise glissante | Balise d'image sur le conteneur déployé |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** (`POSTGRES_15`) — ne contient que les métadonnées de l'application Django (utilisateurs, équipes, indicateurs de fonctionnalités, tableaux de bord) ; pas de données analytiques | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` de premier déploiement qui crée la base de données, l'utilisateur et les autorisations. Pas d'extensions — tout le stockage analytique est dans ClickHouse | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un seul bucket Cloud Storage, accessible via le **client natif compatible S3** de PostHog contre l'API d'interopérabilité S3 de GCS — une paire de clés HMAC + compte de service dédié, PAS un montage GCS FUSE | Sortie `storage_buckets`, sortie `storage_sa_email` |
| Secrets | Génère `SECRET_KEY` (clé de signature Django) et une paire de clés d'accès/secrètes HMAC d'interopérabilité S3 ; transmet un `CLICKHOUSE_PASSWORD` externe, ou en génère un lorsque `generate_clickhouse_password = true` (défini par `PostHog_GKE` pour son ClickHouse intégré) | Secret Manager, via la sortie `secret_ids` |
| Paramètres de base | `CLICKHOUSE_DATABASE`/`USER`/`SECURE`/`VERIFY`, `OBJECT_STORAGE_*`, `IS_BEHIND_PROXY`, `DISABLE_SECURE_SSL_REDIRECT` | Comportement de l'application dans le guide de la plateforme |
| Vérifications de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/_readyz` et `/_livez` | §Observabilité dans le guide de la plateforme |
| NON fourni explicitement ici | Résolution des points de terminaison ClickHouse/Kafka et le Redpanda/ClickHouse `additional_services` groupé — ceux-ci nécessitent des noms DNS de service locaux à GKE connus uniquement au niveau de la variante `PostHog_GKE` | Voir le câblage propre à `PostHog_GKE` |

---

## 2. Image de conteneur et point d'entrée {#2-container-image-and-entrypoint}

L'image personnalisée enveloppe `posthog/posthog:<version>` avec **deux** scripts, superposés
à l'image amont sans toucher à son propre `ENTRYPOINT` — l'étape finale amont est
construite sur la base de serveur d'applications `nginx/unit` (`unit:*-python3.13`), dont le
point d'entrée hérité peut effectuer un travail d'amorçage au-delà de "exec the CMD", donc seul `CMD` est
remplacé :

- **`cloud-entrypoint.sh`** — l'hybride Django/Node de PostHog lit les DSN de chaîne de connexion complètes
  (`DATABASE_URL`, `REDIS_URL`), et non des variables d'hôte/port/utilisateur discrètes (confirmé
  contre `posthog/settings/data_stores.py`), donc le point d'entrée les compose à partir des primitives
  `DB_*`/`REDIS_*` injectées par la Fondation au démarrage du conteneur plutôt que de s'appuyer
  sur les références `$(VAR)` de Kubernetes (qui ne se résolvent que par rapport aux entrées d'environnement définies
  *plus tôt* dans la liste rendue alphabétiquement — un piège d'ordonnancement déjà documenté pour
  Immich/GoToSocial dans ce catalogue). Il échoue également rapidement avec une erreur claire si
  `REDIS_HOST`, `CLICKHOUSE_HOST`, ou `KAFKA_HOSTS` est vide — les trois sont obligatoires
  pour que PostHog fonctionne.
- **`docker-boot.sh`** — un remplacement pour le `./bin/docker` amont, exécutant la
  séquence identique `migrate` → `(celery worker+beat, backgrounded)` → `gunicorn/docker-server`,
  **moins** la ligne `./bin/posthog-node`. Voir §6.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

PostHog nécessite **PostgreSQL** uniquement pour les métadonnées de son application Django —
`PostHog_Common` épingle `POSTGRES_15`. **Chaque événement analytique, enregistrement de personne et index d'enregistrement de session vit dans ClickHouse, pas dans Postgres.** Lors du premier déploiement, un job ponctuel
(`db-init`, `postgres:15-alpine`, délai de 600s) exécute `scripts/db-init.sh`, qui
de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL (en se rabattant sur `DB_IP`/`DB_HOST` via TCP),
2. Attend que PostgreSQL soit accessible,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec cet utilisateur comme propriétaire,
5. Accorde tous les privilèges sur la base de données et le schéma `public`.

Aucune extension PostgreSQL n'est installée — contrairement à de nombreuses applications de ce catalogue, PostHog
n'en a pas besoin. Le job peut être réexécuté en toute sécurité. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Stockage d'objets — interopérabilité S3, pas GCS FUSE {#4-object-storage--s3-interop-not-gcs-fuse}

PostHog n'a **pas de bibliothèque de médias de système de fichiers** : les enregistrements de relecture de session et les exportations de données
passent par le client natif compatible S3 de PostHog, pointé vers l'API XML d'interopérabilité S3 de GCS via
un compte de service dédié et une paire de clés HMAC (le même modèle déjà prouvé dans ce
catalogue par `GoToSocial_Common`). Par conséquent, cette couche ne déclare aucun volume GCS FUSE.

```bash
gcloud storage buckets list --project "$PROJECT"
```

L'e-mail du compte de service de stockage est exposé comme sortie `storage_sa_email` ;
`PostHog_GKE` lui accorde `roles/storage.objectAdmin` sur le bucket créé par la Fondation
directement (joignant le SA de cette couche avec le bucket que la Fondation crée), plutôt
que de dépendre de l'ensemble du module d'application — PostHog peut démarrer sans stockage d'objets
accessible (les téléchargements échouent simplement jusqu'à ce que l'autorisation soit effective).

---

## 5. Paramètres d'application de base {#5-core-application-settings}

Valeurs par défaut de l'environnement injectées dans `config.environment_variables` (les
`environment_variables` fournis par l'appelant sont fusionnés par-dessus) :

| Variable | Valeur | Notes |
|---|---|---|
| `CLICKHOUSE_DATABASE` / `CLICKHOUSE_USER` | `posthog` / `default` | Base de données et nom d'utilisateur ClickHouse |
| `CLICKHOUSE_SECURE` / `CLICKHOUSE_VERIFY` | `"false"` | Trafic intra-VPC/intra-cluster — pas de TLS |
| `OBJECT_STORAGE_ENABLED` / `_ENDPOINT` / `_BUCKET` / `_REGION` / `_FORCE_PATH_STYLE` | Configuration d'interopérabilité S3 | Voir §4 |
| `IS_BEHIND_PROXY` | `"true"` | Le LoadBalancer/Gateway de GKE termine en externe |
| `DISABLE_SECURE_SSL_REDIRECT` | `"true"` | Empêche une boucle de redirection HTTPS derrière le proxy interne |

Valeurs par défaut de dimensionnement : `cpu_limit = "4000m"`, `memory_limit = "8Gi"` — toutes deux augmentées par rapport aux
valeurs par défaut génériques après vérification en direct de la séquence d'importation/migration
initiale de PostHog, qui est réellement lourde.

**Non défini ici :** `CLICKHOUSE_HOST`/`PORT`, `KAFKA_HOSTS`, et `SITE_URL` dépendent des
noms de ressources connus uniquement au niveau de la variante `PostHog_GKE` (un point de terminaison externe, ou le
nom DNS du service de secours intégré au module) et sont injectés là via `module_env_vars`. Le
broker Redpanda groupé et le secours ClickHouse optionnel intégré au module sont également câblés
directement dans `PostHog_GKE` afin que leur structure de liste `additional_services` (y compris
les noms de service) soit connue au moment du plan Terraform.

---

## 6. Le serveur de plugins Node.js manquant — une lacune amont connue {#6-the-missing-nodejs-plugin-server--a-known-upstream-gap}

Vérifié en direct (22/07/2026, à la fois `:latest` et une build 6 jours plus ancienne) : l'image
`posthog/posthog` actuelle n'embarque plus du tout `/code/nodejs`. Le script de démarrage
`bin/posthog-node` de PostHog essaie toujours inconditionnellement de `cd` dans ce répertoire
et de l'exécuter, enveloppé dans une "boucle de résilience" infinie qui réessaie toutes les 2 secondes indéfiniment
sans jamais se terminer. Puisque cela s'exécute en arrière-plan à l'intérieur de `bin/docker-worker` (lui-même
en arrière-plan depuis `bin/docker`), le conteneur externe ne plante jamais — mais la boucle de
redémarrage rapide en cas de crash bloque le CPU à ~100% indéfiniment, affamant le processus qui doit répondre
à la `/_readyz` de la sonde de démarrage à temps. De l'extérieur, cela ressemble exactement à "démarre
bien mais ne devient jamais prêt", sans erreur évidente dans les journaux visibles.

`docker-boot.sh` (§2) contourne cela en exécutant tout le reste de manière identique et
en omettant la ligne `./bin/posthog-node`. Cela semble être une véritable lacune amont — une
grande partie de la logique d'ingestion/traitement a visiblement été déplacée vers les applications Python `products.*`
dans la même image, de sorte que le composant Node peut simplement être vestigial maintenant — plutôt que
quelque chose de réparable en épinglant une balise plus ancienne. **Les opérateurs doivent savoir :** l'ingestion
d'événements et l'analyse de base fonctionnent bien avec cette surcharge ; les fonctionnalités dépendantes des plugins qui
s'appuyaient spécifiquement sur le serveur de plugins Node peuvent ne pas fonctionner, jusqu'à ce que l'amont le restaure ou
termine la migration.

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent les points de terminaison de santé propres à PostHog
(vérifié à la source contre `posthog/health.py`) :

- **`GET /_readyz`** — vérifications approfondies des dépendances (état de la migration Postgres, ClickHouse,
  Kafka, broker Celery, cache). `failure_threshold = 145` avec une période de 10 secondes
  (~25 minutes) est délibérément large — vérifié en direct contre une nouvelle base de données Cloud SQL,
  l'étape `migrate` Django intégrée de PostHog exécute son historique de migration complet et très important
  multi-applications et a dépassé un budget précédent plus serré.
- **`GET /_livez`** — la vérification de vivacité légère ; ne vérifie pas les dépendances en aval.

Les deux sont non authentifiées — les sondes s'exécutent sans authentification, donc un point de terminaison protégé par authentification
renverrait 401/403 et bloquerait le déploiement.

---

## 8. Sorties {#8-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Configuration complète de l'application (image + configuration de build, port, contrat de base de données, variables d'environnement, job `db-init`, sondes). |
| `secret_ids` | `map(string)` | `SECRET_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, et `CLICKHOUSE_PASSWORD` (lorsqu'un secret externe est défini ou qu'un est généré). |
| `secret_values` | `map(string)` | `{}` (sensible). |
| `storage_buckets` | `list(object)` | Un seul bucket (`name_suffix = "storage"`). |
| `resolved_version` | `string` | Balise d'image réellement déployée — égale à `application_version` inchangée. |
| `path` | `string` | Chemin absolu vers ce répertoire de module. |
| `resource_prefix` | `string` | Préfixe de nommage des ressources (transmis depuis l'entrée). |
| `service_name` | `string` | `<application_name><resource_prefix>`. |
| `storage_sa_email` | `string` | E-mail du compte de service HMAC du stockage d'objets — `PostHog_GKE` lui accorde `roles/storage.objectAdmin`. |

---

Pour la configuration spécifique à PostHog, destinée à l'utilisateur (variables par groupe, sorties et comment
explorer chaque service depuis la Console et la CLI), consultez le guide de la plateforme :
**[PostHog_GKE](PostHog_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PostHog sur GKE Autopilot](PostHog_GKE.md) — cette configuration déployée sur GKE.
