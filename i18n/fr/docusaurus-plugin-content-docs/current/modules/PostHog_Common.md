---
title: "PostHog Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module PostHog — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PostHog_Common.md @ 3055034 sha256:2246bf872730 -->

# PostHog Common — Configuration applicative partagée {#posthog-common--shared-application-configuration}

`PostHog_Common` est la **couche applicative partagée** de PostHog. Elle n'est pas
déployée seule ; elle fournit la configuration propre à PostHog sur laquelle s'appuie
[PostHog_GKE](PostHog_GKE.md). Contrairement à la plupart des paires d'applications de ce
catalogue, il n'existe délibérément **aucune variante `PostHog_CloudRun`** — le pipeline
d'événements de PostHog impose Kafka (ingestion) et ClickHouse (le magasin d'événements
analytiques), deux services avec état et de longue durée, incompatibles avec le modèle
serverless de Cloud Run qui réduit à zéro — `PostHog_GKE` est donc le seul consommateur de
cette couche. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement PostHog, consultez le guide de
plateforme ([PostHog_GKE](PostHog_GKE.md)) et le guide du socle ([App_GKE](App_GKE.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par PostHog_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé léger `FROM posthog/posthog` ajoutant un point d'entrée cloud et une surcharge de `docker-boot.sh` ; construit via Cloud Build avec l'ARG de build propre à l'application `POSTHOG_VERSION` | Sortie `container_image` du déploiement de plateforme |
| Résolution de version | `application_version = "latest"` est utilisé tel quel — `posthog/posthog` publie un tag `latest` réellement à jour qui suit master, contrairement à plusieurs applications de ce catalogue qui nécessitent une substitution de tag glissant | Tag de l'image sur le conteneur déployé |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) — ne contient que les métadonnées applicatives de Django (utilisateurs, équipes, feature flags, tableaux de bord) ; aucune donnée analytique | §Base de données du guide de plateforme |
| Initialisation de la base de données | Définit la tâche `db-init` du premier déploiement, qui crée la base de données, l'utilisateur et les droits. Aucune extension — tout le stockage analytique est dans ClickHouse | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un unique bucket Cloud Storage, atteint via le **client natif compatible S3** de PostHog sur l'API d'interopérabilité S3 de GCS — un compte de service dédié + une paire de clés HMAC, PAS un montage GCS FUSE | Sortie `storage_buckets`, sortie `storage_sa_email` |
| Secrets | Génère `SECRET_KEY` (clé de signature Django) et une paire de clés d'accès/secrète HMAC d'interopérabilité S3 ; transmet éventuellement un `CLICKHOUSE_PASSWORD` externe | Secret Manager, via la sortie `secret_ids` |
| Paramètres principaux | `CLICKHOUSE_DATABASE`/`USER`/`SECURE`/`VERIFY`, `OBJECT_STORAGE_*`, `IS_BEHIND_PROXY`, `DISABLE_SECURE_SSL_REDIRECT` | Comportement de l'application dans le guide de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/_readyz` et `/_livez` | §Observabilité du guide de plateforme |
| Explicitement NON fourni ici | La résolution des points de terminaison ClickHouse/Kafka et les `additional_services` Redpanda/ClickHouse intégrés — ils nécessitent des noms DNS de Service locaux à GKE, connus uniquement au niveau de la variante `PostHog_GKE` | Voir le câblage propre à `PostHog_GKE` |

---

## 2. Image de conteneur et point d'entrée {#2-container-image-and-entrypoint}

L'image personnalisée enveloppe `posthog/posthog:<version>` avec **deux** scripts, ajoutés
par-dessus l'image amont sans toucher à son propre `ENTRYPOINT` — l'étape finale amont est
construite sur la base de serveur d'applications `nginx/unit` (`unit:*-python3.13`), dont le
point d'entrée hérité peut effectuer un travail d'amorçage allant au-delà de « exécuter le
CMD » ; seul `CMD` est donc remplacé :

- **`cloud-entrypoint.sh`** — l'hybride Django/Node de PostHog lit des DSN complets sous
  forme de chaînes de connexion (`DATABASE_URL`, `REDIS_URL`), et non des variables
  distinctes d'hôte/port/utilisateur (confirmé dans `posthog/settings/data_stores.py`) ; le
  point d'entrée les compose donc au démarrage du conteneur à partir des primitives
  `DB_*`/`REDIS_*` injectées par le socle, plutôt que de s'appuyer sur les références
  Kubernetes `$(VAR)` (qui ne se résolvent que par rapport aux entrées d'environnement
  définies *plus tôt* dans la liste rendue par ordre alphabétique — un piège d'ordre déjà
  documenté pour Immich/GoToSocial dans ce catalogue). Il échoue également immédiatement,
  avec une erreur claire, si `REDIS_HOST`, `CLICKHOUSE_HOST` ou `KAFKA_HOSTS` est vide — les
  trois sont obligatoires au fonctionnement de PostHog.
- **`docker-boot.sh`** — un remplaçant du `./bin/docker` amont, qui exécute la séquence
  identique `migrate` → `(celery worker+beat, backgrounded)` → `gunicorn/docker-server`,
  **sans** la ligne `./bin/posthog-node`. Voir §6.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

PostHog n'a besoin de **PostgreSQL** que pour les métadonnées de sa propre application
Django — `PostHog_Common` épingle `POSTGRES_15`. **Chaque événement analytique, fiche de
personne et index d'enregistrement de session réside dans ClickHouse, et non dans
Postgres.** Lors du premier déploiement, une tâche ponctuelle (`db-init`,
`postgres:15-alpine`, délai d'expiration de 600s) exécute `scripts/db-init.sh`, qui, de
manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (en se rabattant sur `DB_IP`/`DB_HOST` en TCP),
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) l'utilisateur applicatif avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données applicative avec cet utilisateur comme propriétaire,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`.

Aucune extension PostgreSQL n'est installée — contrairement à de nombreuses applications
de ce catalogue, PostHog n'en a besoin d'aucune. La tâche peut être réexécutée sans risque.
Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Stockage d'objets — interopérabilité S3, pas GCS FUSE {#4-object-storage--s3-interop-not-gcs-fuse}

PostHog n'a **aucune médiathèque sur système de fichiers** : les enregistrements de
relecture de session et les exports de données passent par le client natif compatible S3
de PostHog, dirigé vers l'API XML d'interopérabilité S3 de GCS via un compte de service
dédié et une paire de clés HMAC (le même modèle déjà éprouvé dans ce catalogue par
`GoToSocial_Common`). Par conséquent, cette couche ne déclare aucun volume GCS FUSE.

```bash
gcloud storage buckets list --project "$PROJECT"
```

L'adresse e-mail du compte de service de stockage est exposée par la sortie
`storage_sa_email` ; `PostHog_GKE` lui accorde directement `roles/storage.objectAdmin` sur
le bucket créé par le socle (en associant le compte de service de cette couche au bucket que
crée le socle), plutôt que de dépendre de l'ensemble du module applicatif — PostHog peut
démarrer sans que le stockage d'objets soit joignable (les téléversements échouent
simplement jusqu'à ce que l'attribution soit effective).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

Valeurs d'environnement par défaut injectées dans `config.environment_variables` (les
`environment_variables` fournies par l'appelant sont fusionnées par-dessus) :

| Variable | Valeur | Remarques |
|---|---|---|
| `CLICKHOUSE_DATABASE` / `CLICKHOUSE_USER` | `posthog` / `default` | Base de données et nom d'utilisateur ClickHouse |
| `CLICKHOUSE_SECURE` / `CLICKHOUSE_VERIFY` | `"false"` | Trafic interne au VPC/au cluster — pas de TLS |
| `OBJECT_STORAGE_ENABLED` / `_ENDPOINT` / `_BUCKET` / `_REGION` / `_FORCE_PATH_STYLE` | Configuration d'interopérabilité S3 | Voir §4 |
| `IS_BEHIND_PROXY` | `"true"` | Le LoadBalancer/Gateway de GKE assure la terminaison en externe |
| `DISABLE_SECURE_SSL_REDIRECT` | `"true"` | Empêche une boucle de redirection HTTPS derrière le proxy interne |

Valeurs de dimensionnement par défaut : `cpu_limit = "4000m"`, `memory_limit = "8Gi"` — toutes
deux relevées par rapport aux valeurs génériques après vérification en conditions réelles de
la séquence d'import/migration, réellement lourde, du premier démarrage de PostHog.

**Non défini ici :** `CLICKHOUSE_HOST`/`PORT`, `KAFKA_HOSTS` et `SITE_URL` dépendent de
noms de ressources connus uniquement au niveau de la variante `PostHog_GKE` (un point de
terminaison externe, ou le nom DNS de Service de la solution de repli intégrée au module) et
y sont injectés via `module_env_vars`. Le broker Redpanda intégré et la solution de repli
ClickHouse facultative intégrée au module sont de même câblés directement dans
`PostHog_GKE`, afin que la structure de leur liste `additional_services` (y compris les noms
de services) soit connue au moment du plan Terraform.

---

## 6. Le plugin-server Node.js manquant — une lacune amont connue {#6-the-missing-nodejs-plugin-server--a-known-upstream-gap}

Vérifié en conditions réelles (2026-07-22, sur `:latest` et sur un build plus ancien de 6
jours) : l'image `posthog/posthog` actuelle ne contient plus du tout `/code/nodejs`. Le
script de démarrage `bin/posthog-node` de PostHog tente pourtant toujours, sans condition,
de faire un `cd` dans ce répertoire et de l'exécuter, le tout enveloppé dans une « boucle de
résilience » infinie qui réessaie toutes les 2 secondes sans jamais se terminer. Comme cela
s'exécute en arrière-plan dans `bin/docker-worker` (lui-même lancé en arrière-plan depuis
`bin/docker`), le conteneur externe ne plante jamais — mais la boucle serrée de
plantage/relance maintient le CPU à ~100 % indéfiniment, privant de ressources le processus
qui doit répondre à temps au `/_readyz` de la sonde de démarrage. Vu de l'extérieur, cela
ressemble exactement à « démarre correctement mais ne devient jamais Ready », sans erreur
évidente dans les journaux visibles.

`docker-boot.sh` (§2) contourne le problème en exécutant tout le reste à l'identique et en
omettant la ligne `./bin/posthog-node`. Il semble s'agir d'une véritable lacune amont — une
grande partie de la logique d'ingestion/traitement a visiblement migré vers des applications
Python `products.*` dans la même image, si bien que le composant Node n'est peut-être plus
qu'un vestige — plutôt que d'un problème corrigeable en épinglant un tag plus ancien.
**Ce que les opérateurs doivent savoir :** l'ingestion des événements et l'analytique de base
fonctionnent correctement avec cette surcharge ; les fonctionnalités dépendant de plugins qui
reposaient spécifiquement sur le plugin-server Node peuvent ne pas fonctionner, jusqu'à ce
que l'amont le rétablisse ou achève la migration qui l'abandonne.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent les points de terminaison de santé
propres à PostHog (vérifiés dans le code source `posthog/health.py`) :

- **`GET /_readyz`** — contrôles approfondis des dépendances (état des migrations Postgres,
  ClickHouse, Kafka, broker Celery, cache). `failure_threshold = 145` avec une période de
  10 secondes (~25 minutes) est délibérément élevé — vérifié en conditions réelles sur une
  base Cloud SQL neuve, l'étape `migrate` de Django exécutée en mode intégré (inline) par PostHog déroule
  l'intégralité de son très volumineux historique de migrations multi-applications et a
  dépassé un budget précédent plus serré.
- **`GET /_livez`** — le contrôle de vivacité léger ; il ne vérifie pas les dépendances en
  aval.

Les deux sont non authentifiés — les sondes s'exécutent sans authentification, si bien qu'un
point de terminaison protégé renverrait 401/403 et bloquerait le déploiement progressif.

---

## 8. Sorties {#8-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Configuration applicative complète (image + configuration de build, port, contrat de base de données, variables d'environnement, tâche `db-init`, sondes). |
| `secret_ids` | `map(string)` | `SECRET_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` et (si défini) `CLICKHOUSE_PASSWORD`. |
| `secret_values` | `map(string)` | `{}` (sensible). |
| `storage_buckets` | `list(object)` | Un unique bucket (`name_suffix = "storage"`). |
| `resolved_version` | `string` | Tag d'image réellement déployé — égal à `application_version`, inchangé. |
| `path` | `string` | Chemin absolu de ce répertoire de module. |
| `resource_prefix` | `string` | Préfixe de nommage des ressources (transmis depuis l'entrée). |
| `service_name` | `string` | `<application_name><resource_prefix>`. |
| `storage_sa_email` | `string` | Adresse e-mail du compte de service HMAC du stockage d'objets — `PostHog_GKE` lui accorde `roles/storage.objectAdmin`. |

---

Pour la configuration propre à PostHog exposée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez le guide de
plateforme : **[PostHog_GKE](PostHog_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PostHog sur GKE Autopilot](PostHog_GKE.md) — cette configuration déployée sur GKE.
