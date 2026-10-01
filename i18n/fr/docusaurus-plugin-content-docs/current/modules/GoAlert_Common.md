---
title: "GoAlert Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module GoAlert — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/GoAlert_Common.md @ 3055034 sha256:07472cf1a280 -->

# GoAlert Common — Configuration applicative partagée {#goalert-common--shared-application-configuration}

`GoAlert_Common` est la **couche applicative partagée** de GoAlert. Elle n'est pas
déployée seule ; elle fournit la configuration propre à GoAlert sur laquelle s'appuient
[GoAlert_GKE](GoAlert_GKE.md) et [GoAlert_CloudRun](GoAlert_CloudRun.md), de sorte que
les deux variantes de plateforme se comportent de manière identique là où cela compte.
Les utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède
aucune entrée d'interface de déploiement propre — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement GoAlert, consultez les guides
des plateformes ([GoAlert_GKE](GoAlert_GKE.md), [GoAlert_CloudRun](GoAlert_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par GoAlert_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe l'image officielle `goalert/goalert` avec un `entrypoint.sh` personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL** (`POSTGRES_17`) comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit une chaîne de jobs d'initialisation en 3 étapes — `db-init` → `db-migrate` → `admin-bootstrap` | Sortie `initialization_jobs` |
| Extension Postgres | Installe `pgcrypto` sans condition (`enable_postgres_extensions = true`, `postgres_extensions = ["pgcrypto"]`), requise par le schéma de GoAlert | Objet `config` |
| Secrets | Génère et stocke dans **Secret Manager** le mot de passe administrateur initial et une clé de chiffrement des données | Sorties `secret_ids`, `secret_values`, `admin_password_secret_id` |
| Stockage d'objets | Aucun — GoAlert ne dispose d'aucune fonctionnalité de téléversement de fichiers | La sortie `storage_buckets` vaut toujours `[]` |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur et point d'entrée {#2-container-image-and-entrypoint}

L'image propre à GoAlert (`goalert/goalert`) est livrée sous la forme d'un unique binaire
statique, sans prise en charge intégrée de l'assemblage à l'exécution d'une chaîne de
connexion Postgres à partir de composants hôte/utilisateur/mot de passe distincts ; le
`Dockerfile` de `GoAlert_Common` l'enveloppe donc avec un fin point d'entrée shell :

```dockerfile
ARG GOALERT_VERSION=v0.34.1
FROM goalert/goalert:${GOALERT_VERSION}

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER 1000

ENTRYPOINT ["/entrypoint.sh"]
```

`entrypoint.sh` s'exécute avant le démarrage du véritable processus `goalert` :

1. **Détecte le mode de connexion à Cloud SQL.** Si `/cloudsql` contient un socket Unix
   (Cloud Run avec `enable_cloudsql_volume = true`), il crée un lien symbolique du socket
   vers `/tmp/.s.PGSQL.5432` et définit `DB_HOST=/tmp`, `DB_IP=""`. Sur GKE, le sidecar
   cloud-sql-proxy écoute plutôt en TCP sur l'interface de bouclage ; cette branche est
   donc ignorée.
2. **Encode `DB_PASSWORD` pour une URL.** Comme le mot de passe issu de Secret Manager à
   l'exécution peut contenir des caractères (`@`, `:`, `/`, `?`, `#`, `'`, espace) qui
   cassent une URL s'ils restent bruts, une expression entre crochets `sed` portable gère
   l'encodage — délibérément `s/[?]/%3F/g`, et non `s/\?/%3F/g`, propre à GNU, car le
   `/bin/sh` de cette image est BusyBox (`goalert/goalert` basée sur Alpine), qui rejette
   l'extension GNU.
3. **Assemble `GOALERT_DB_URL`.** GoAlert accepte exactement une chaîne de connexion
   Postgres. La forme du DSN est choisie selon l'hôte résolu : un hôte socket/de bouclage
   utilise `postgres://user:pass@/db?host=<path>&sslmode=disable` ; une véritable IP TCP
   utilise `postgres://user:pass@host:5432/db?sslmode=require`.
4. **Exécute (exec) le véritable binaire** à `/usr/bin/goalert` — **et non** `/bin/goalert**, une
   supposition naturelle mais erronée ; l'image officielle ne contient le binaire qu'au
   premier chemin.

`db-migrate.sh` et `admin-bootstrap.sh` (les deux scripts de jobs d'initialisation qui
dialoguent avec Postgres) dupliquent cette même logique de détection du socket, d'encodage
d'URL et d'assemblage du DSN, car les Cloud Run Jobs et les Jobs Kubernetes s'exécutent
dans des conteneurs ponctuels distincts du serveur principal, chacun devant construire sa
propre `GOALERT_DB_URL`.

---

## 3. Moteur de base de données et chaîne d'amorçage en 3 étapes {#3-database-engine-and-the-3-stage-bootstrap-chain}

GoAlert nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_17`, et MySQL ou
d'autres moteurs ne sont pas pris en charge. Comme une instance Cloud SQL vierge a besoin
d'un rôle, d'une base de données, d'un schéma et d'un premier compte administrateur avant
que GoAlert soit réellement utilisable, `GoAlert_Common` définit **trois jobs ponctuels
ordonnés**, chacun dépendant du précédent via `depends_on_jobs`, tous avec
`execute_on_apply = true` :

1. **`db-init`** (`postgres:15-alpine`, `depends_on_jobs = []`)
   - Détecte le socket du Cloud SQL Auth Proxy (reprend la logique d'`entrypoint.sh`).
   - Attend que PostgreSQL devienne joignable (boucle d'interrogation `pg_isready`).
   - Crée (ou met à jour) le rôle de l'application avec le mot de passe généré.
   - Accorde ce rôle à `postgres` afin que la propriété puisse être attribuée.
   - Crée la base de données de l'application (ou en réattribue la propriété).
   - Accorde tous les privilèges sur la base de données et le schéma `public`.
   - Signale la fin au point de terminaison `/quitquitquit` du Cloud SQL Auth Proxy afin
     que le Job se termine proprement.

2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
   - Exécute `goalert migrate --db-url="$GOALERT_DB_URL"`, qui applique les migrations de
     schéma propres à GoAlert.
   - **Doit se terminer avant `admin-bootstrap`** — `goalert add-user` (le job suivant)
     ne comporte aucune logique de migration. Sur une base de données vierge sans schéma,
     il échoue immédiatement avec `relation "auth_basic_users" does not exist`.
   - Réessaie jusqu'à 10 fois en interne (à 5s d'intervalle) pour absorber la latence de
     disponibilité de Cloud SQL, en plus du `max_retries = 3` propre au Cloud Run Job / Job
     Kubernetes.

3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
   ["db-migrate"]`)
   - Exécute `goalert add-user --admin --user="$GOALERT_ADMIN_USER"
     --email="$GOALERT_ADMIN_EMAIL" --pass="$GOALERT_ADMIN_PASSWORD"` directement
     sur Postgres.
   - Son exécution au moment de l'application (`execute_on_apply = true`) est sans risque
     — contrairement à un amorçage via HTTP, qui exigerait que le serveur principal soit
     déjà à l'écoute, ce job s'adresse directement à la base de données.
   - Tolère les réexécutions : si l'utilisateur administrateur existe déjà, le script
     détecte « already exists »/« duplicate » dans la sortie d'erreur et se termine avec
     le code 0 au lieu d'échouer.
   - Réessaie lui aussi jusqu'à 10 fois en interne.

Les champs `command`/`args` de chaque job sont laissés vides ; le socle génère
automatiquement `["/bin/sh", "-c", file(script_path)]` lorsque `script_path` est défini,
en intégrant directement le contenu du script dans la spécification du Job — le modèle
utilisé par ce catalogue pour éviter de monter `scripts/` en tant que volume dans un
conteneur qui ne dispose pas d'un tel montage.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Extension Postgres : `pgcrypto` {#4-postgres-extension-pgcrypto}

Le schéma de GoAlert nécessite l'extension `pgcrypto`, mais le rôle de base de données
propre au tenant ne dispose pas du privilège `CREATE EXTENSION` sur Cloud SQL.
`GoAlert_Common` définit `enable_postgres_extensions = true` et `postgres_extensions = ["pgcrypto"]`
sans condition dans l'objet `config` qu'il renvoie — ce comportement n'est **pas** piloté
par une variable d'entrée exposée à l'opérateur ; il a toujours lieu. Le job
d'initialisation privilégié `postgres-extensions` du socle l'installe avant que la
base de données de l'application soit utilisable par ailleurs.

---

## 5. Secrets dans Secret Manager {#5-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **Mot de passe administrateur** (`secret-<prefix>-<app>-admin-password`) — un mot de
  passe aléatoire de 20 caractères (`special = false`) consommé par le job
  d'initialisation `admin-bootstrap` sous la forme de `GOALERT_ADMIN_PASSWORD`.
  Récupérez-le après le déploiement :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```
- **Clé de chiffrement des données** (`secret-<prefix>-<app>-data-encryption-key`) — une
  chaîne hexadécimale aléatoire de 32 octets. Recommandée par la documentation amont de
  GoAlert pour chiffrer au repos les clés d'API et la configuration sensible stockées —
  **non** imposée par le code au démarrage par ce module, mais exposée via
  `secret_ids.GOALERT_DATA_ENCRYPTION_KEY` afin d'être injectée comme variable
  d'environnement secrète du conteneur. Toutes les instances partageant une base de
  données doivent utiliser la même clé.

Le mot de passe de la base de données lui-même est généré et géré séparément par le
socle ; le nom de son secret Secret Manager figure dans les sorties du déploiement de
la plateforme (`database_password_secret`).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/health` — le point de terminaison public et non
authentifié documenté de GoAlert (200 dès que le cycle de vie de l'application a quitté
l'état « Starting »). Les variantes Cloud Run et GKE effectuent toutes deux par défaut une
vérification de port **TCP** plutôt qu'une vérification de chemin HTTP, une valeur par
défaut prudente et cohérente avec le catalogue ; une vérification en conditions réelles a
confirmé que `/health` renvoie lui aussi un véritable HTTP 200, avec d'authentiques lignes
de journal serveur « listening and serving HTTP », de sorte qu'une sonde sur chemin HTTP
aurait également fonctionné. Un délai initial de 30 secondes et un seuil d'échec élevé
(30 tentatives) absorbent la durée de migration du schéma du job d'initialisation
`db-migrate` au premier démarrage.

---

## 7. Sorties {#7-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Objet de configuration complet de l'application (image, variables d'environnement, paramètres de base de données, sondes, chaîne d'initialisation de 3 jobs). |
| `secret_ids` | `map(string)` | `{ GOALERT_DATA_ENCRYPTION_KEY = <secret-id> }`. `DB_PASSWORD` est géré par le socle lui-même. |
| `secret_values` | `sensitive object` | `{ ADMIN_PASSWORD = <generated-password> }`, transmis comme `explicit_secret_values` afin que le premier apply puisse matérialiser les secrets avant que les valeurs Secret Manager existent pour être lues par le câblage (nécessaire sur le chemin SecretSync de GKE). |
| `storage_buckets` | `list(object)` | Toujours `[]`. |
| `admin_password_secret_id` | `string` | ID du secret Secret Manager contenant le mot de passe administrateur amorcé. |
| `path` | `string` | Chemin absolu sur le système de fichiers vers le répertoire du module `GoAlert_Common` (utilisé pour résoudre `scripts_dir`). |
| `resource_prefix` | `string` | Préfixe de nommage des ressources du tenant, calculé. |
| `service_name` | `string` | Nom de service propre à l'application, calculé. |

---

## 8. Port du conteneur et paramètres réseau {#8-container-port-and-network-settings}

GoAlert écoute sur **`0.0.0.0:8081`** (`GOALERT_LISTEN`), valeur fixée dans le local des
variables d'environnement — les deux variantes de plateforme définissent également par
défaut `container_port = 8081`.

---

Pour la configuration propre à GoAlert destinée aux utilisateurs (variables par groupe,
sorties et façon d'explorer chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[GoAlert_GKE](GoAlert_GKE.md)** et
**[GoAlert_CloudRun](GoAlert_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [GoAlert sur GKE Autopilot](GoAlert_GKE.md) — cette configuration déployée sur GKE.
