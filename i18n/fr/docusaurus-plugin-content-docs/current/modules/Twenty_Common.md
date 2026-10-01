---
title: "Twenty Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Twenty — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Twenty_Common.md @ 3055034 sha256:83ff30520c1c -->

# Twenty Common — Configuration applicative partagée {#twenty-common--shared-application-configuration}

`Twenty_Common` est la **couche applicative partagée** de Twenty CRM. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Twenty sur laquelle
s'appuient à la fois [Twenty_GKE](Twenty_GKE.md) et
[Twenty_CloudRun](Twenty_CloudRun.md), afin que les deux variantes de plateforme se
comportent de manière identique là où c'est important. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a pas d'entrées propres dans
l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Twenty, consultez les
guides des plateformes ([Twenty_GKE](Twenty_GKE.md),
[Twenty_CloudRun](Twenty_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Twenty_Common | Où cela apparaît |
|---|---|---|
| Secret applicatif | Génère `APP_SECRET` / `ENCRYPTION_KEY` et le stocke dans **Secret Manager** | Récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle `twentycrm/twenty` et l'enveloppe d'un point d'entrée personnalisé via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit trois tâches de premier déploiement : `db-init` (crée la base et l'utilisateur), `twenty-migrate` (exécute les migrations de schéma) et `twenty-verify` (fait échouer l'apply si le schéma reste vide) | Sortie `initialization_jobs` |
| Mode des tâches d'arrière-plan | Définit `MESSAGE_QUEUE_TYPE` sur `pg-boss` (par défaut) ou `bull-mq` (lorsque Redis est activé) | Comportement de l'application dans les guides des plateformes |
| Stockage d'objets | Déclare le bucket **Cloud Storage** lorsque `enable_gcs_storage = true` | Sortie `storage_buckets` |
| Paramètres de base | Injecte les variables d'environnement de base (`SERVER_URL`, `FRONT_BASE_URL`, `STORAGE_TYPE`, `DISABLE_DB_MIGRATIONS`) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage et de vivacité (`/healthz` avec une fenêtre généreuse au premier démarrage) | Section Observabilité des guides des plateformes |

---

## 2. Secret applicatif dans Secret Manager {#2-app-secret-in-secret-manager}

Le `APP_SECRET` / `ENCRYPTION_KEY` est généré automatiquement et stocké en tant que
secret Secret Manager — il n'est jamais défini en clair. Un délai de propagation de
30 secondes garantit que la réplication de Secret Manager est terminée avant que le
service ou les pods ne tentent de le lire.

Récupérez le secret après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
gcloud secrets versions access latest --secret=<app-secret-name> --project "$PROJECT"
```

Le secret est associé aux deux noms de variables d'environnement `APP_SECRET` et
`ENCRYPTION_KEY`, ce qui assure la compatibilité entre les versions de Twenty qui
utilisent l'un ou l'autre nom pour la signature des JWT. Ne faites pas de rotation
manuelle de ce secret, sauf si vous êtes prêt à invalider toutes les sessions
utilisateur actives.

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Twenty exige **PostgreSQL 15** ; le moteur est imposé et MySQL n'est pas pris en
charge. Au premier déploiement, trois tâches ponctuelles s'exécutent l'une après
l'autre avant le démarrage de l'application :

1. **`db-init`** — utilise l'image `postgres:15-alpine`, se connecte à Cloud SQL via
   l'Auth Proxy (avec `ROOT_PASSWORD` provenant de Secret Manager) et, de manière
   idempotente :
   - crée l'utilisateur applicatif avec le mot de passe généré,
   - crée la base de données applicative appartenant à cet utilisateur,
   - accorde tous les privilèges sur la base de données et le schéma,
   - installe l'extension `uuid-ossp` (requise par Twenty).

2. **`twenty-migrate`** — utilise l'image applicative Twenty déployée avec
   `DISABLE_DB_MIGRATIONS=false` pour exécuter les migrations de schéma TypeORM et
   enregistrer les tâches cron d'arrière-plan dans la base. Elle utilise le point
   d'entrée propre à Twenty, aucun outil externe n'est donc nécessaire. Cette tâche
   attend la fin de `db-init` et effectue jusqu'à 3 nouvelles tentatives, car
   l'instance Cloud SQL d'un nouveau tenant peut être encore en cours de
   stabilisation lorsqu'elle démarre.

3. **`twenty-verify`** — une tâche de garde qui attend la fin de `twenty-migrate`.
   Un échec de tâche d'initialisation NE fait PAS échouer à lui seul l'apply du
   module ; un `twenty-migrate` concurrent ou échoué pourrait donc sinon laisser un
   service apparemment sain pointant vers une base de données **vide** — chaque
   requête backend échoue alors avec `relation "core.keyValuePair" does not exist`,
   et l'interface affiche « Unable to Reach Back-end ». `twenty-verify` se connecte
   avec l'image `postgres:15-alpine`, compte les tables du schéma `core` et **fait
   échouer l'apply** s'il n'en trouve aucune, transformant un déploiement silencieux
   sur une base vide en une erreur visible et réessayable.

Les trois tâches peuvent être réexécutées sans risque. Le conteneur applicatif
principal s'exécute avec `DISABLE_DB_MIGRATIONS=true` afin que les démarrages à
froid suivants restent rapides (quelques secondes au lieu de plusieurs minutes).
Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres applicatifs de base {#4-core-application-settings}

`Twenty_Common` établit l'environnement Twenty de base afin que l'application
démarre correctement dès le premier démarrage :

- **Mode de la file de tâches** — `MESSAGE_QUEUE_TYPE` vaut par défaut `pg-boss`
  (adossé à PostgreSQL, sans infrastructure supplémentaire). Lorsque
  `enable_redis = true`, il passe à `bull-mq`, qui nécessite une connexion Redis et
  un processus worker distinct.
- **Mode de stockage des fichiers** — `STORAGE_TYPE` vaut par défaut `local`
  (stockage éphémère du conteneur). Lorsque `enable_gcs_storage = true`, il passe à
  `s3` (API compatible S3 de GCS), et le nom du bucket, la région et le point de
  terminaison sont injectés automatiquement.
- **URL Redis** — `REDIS_URL` n'est injectée que lorsque `enable_redis = true`
  **et** que `redis_host` n'est pas vide. Injecter une URL factice alors qu'aucun
  serveur Redis n'est joignable amène ioredis à réessayer indéfiniment et bloque le
  démarrage de Twenty pendant toute la fenêtre de la sonde.
- **URL du serveur** — `SERVER_URL` et `FRONT_BASE_URL` sont injectées par défaut
  sous forme de chaînes vides et **doivent être remplacées** via les
  `environment_variables` du module de la plateforme. Sans URL valides, les liens
  d'API sont incorrects, des erreurs CORS se produisent sur toutes les requêtes et
  les invitations par e-mail ne peuvent pas être générées.
- **Migrations désactivées** — `DISABLE_DB_MIGRATIONS=true` et
  `DISABLE_CRON_JOBS_REGISTRATION=true` sont définis dans le conteneur principal,
  de sorte que la tâche d'initialisation `twenty-migrate` est la seule voie pour les
  modifications de schéma.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison `/healthz` de Twenty, qui
renvoie HTTP 200 lorsque le serveur Node.js est prêt et que la connexion à la base
de données est saine :

- **Sonde de démarrage** — HTTP GET `/healthz`, délai initial de 120 secondes,
  période d'interrogation de 15 secondes, seuil de 40 échecs. Cela laisse jusqu'à
  ~10 minutes au total pour les migrations du premier démarrage (qui s'exécutent via
  la tâche d'initialisation `twenty-migrate` avant le démarrage du pod, mais avec
  une marge pour les variations). GKE et Cloud Run utilisent la même sonde HTTP, car
  Twenty n'émet pas de redirections HTTP→HTTPS sur le chemin de santé.
- **Sonde de vivacité** — HTTP GET `/healthz`, délai initial de 30 secondes, période
  d'interrogation de 30 secondes, seuil de 3 échecs. Un conteneur est redémarré
  après 3 échecs consécutifs.

---

## 6. Stockage d'objets {#6-object-storage}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié est déclaré
ici et provisionné par le socle, qui accorde également l'accès au compte de service
de la charge de travail. Le bucket est configuré pour l'API compatible S3 de GCS :

- `STORAGE_TYPE = "s3"` est injecté automatiquement.
- `STORAGE_S3_NAME`, `STORAGE_S3_REGION` et `STORAGE_S3_ENDPOINT` sont injectés à
  partir du nom du bucket, de la région du déploiement et du point de terminaison
  compatible S3 de GCS (`https://storage.googleapis.com`).
- Les clés HMAC GCS (`STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY`)
  ne sont **pas** générées automatiquement — vous devez les créer dans la console
  (Cloud Storage → Settings → Interoperability) et les fournir via
  `secret_environment_variables`.

Listez le bucket provisionné :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration de Twenty destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Twenty_GKE](Twenty_GKE.md)** et
**[Twenty_CloudRun](Twenty_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Twenty CRM sur GKE Autopilot](Twenty_GKE.md) — cette configuration déployée sur GKE.
