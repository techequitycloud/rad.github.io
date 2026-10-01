---
title: "GlitchTip Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module GlitchTip — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/GlitchTip_Common.md @ 3055034 sha256:bc0da27eac7c -->

# GlitchTip Common — Configuration applicative partagée {#glitchtip-common--shared-application-configuration}

`GlitchTip_Common` est la **couche applicative partagée** de GlitchTip. Elle n'est pas
déployée seule ; elle fournit la configuration propre à GlitchTip sur laquelle
reposent [GlitchTip_GKE](GlitchTip_GKE.md) et [GlitchTip_CloudRun](GlitchTip_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche —
elle n'a pas d'entrées propres dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement GlitchTip, consultez les
guides des plateformes ([GlitchTip_GKE](GlitchTip_GKE.md), [GlitchTip_CloudRun](GlitchTip_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

GlitchTip est une plateforme open source de **suivi des erreurs et de surveillance des
performances** compatible avec Sentry (Django/Python). Vos applications envoient des
événements au point de terminaison d'ingestion de GlitchTip, qui parle le protocole
Sentry ; GlitchTip les stocke, les regroupe et déclenche des alertes.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par GlitchTip_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère la `SECRET_KEY` Django (50 caractères) et le mot de passe initial du superutilisateur (24 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image officielle `glitchtip/glitchtip:<version>` (`latest` par défaut) avec un point d'entrée cloud ; build via Cloud Build | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit deux jobs de premier déploiement (`db-init`, `glitchtip-migrate`) qui créent la base/l'utilisateur, exécutent les migrations Django et créent le superutilisateur | Output `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** (suffixe `storage`) | Output `storage_buckets` |
| Paramètres de base | Définit l'environnement de référence de GlitchTip : `SERVER_ROLE=all_in_one`, état de l'inscription, rétention des événements, Valkey/Redis désactivé | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit dans son output `config` une `readiness_probe` (`/_health/`) qu'aucun des deux modules du socle n'utilise (configuration morte) ; les sondes de démarrage/vivacité réelles proviennent de variables propres à chaque variante, qui remplacent la valeur par défaut `/_health/` de cette couche par `/` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair :

- **`SECRET_KEY`** — une chaîne aléatoire de 50 caractères générée une seule fois et
  stockée sous `secret-<prefix>-<app>-secret-key`. GlitchTip (Django) l'utilise pour
  signer les sessions et les cookies. Elle est injectée dans le conteneur en cours
  d'exécution comme variable d'environnement `SECRET_KEY`. La renouveler après le
  premier démarrage invalide toutes les sessions actives et oblige chaque utilisateur à
  se reconnecter.
- **Mot de passe du superutilisateur** — une chaîne aléatoire de 24 caractères stockée
  sous `secret-<prefix>-<app>-superuser-password`. Il n'est **pas** injecté dans le
  service en cours d'exécution ; c'est le job `glitchtip-migrate` qui le lit pour créer
  le compte administrateur/propriétaire initial (`SUPERUSER_EMAIL`, par défaut
  `admin@techequity.cloud`), afin que l'instance ait un propriétaire sans ouvrir
  l'inscription en libre-service.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read the initial admin password:
gcloud secrets versions access latest --secret=<superuser-password-secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

GlitchTip exige **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres moteurs ne
sont pas pris en charge. GlitchTip lit une unique `DATABASE_URL`, mais le mot de passe
de la base est une valeur Secret Manager d'exécution qui ne peut pas être interpolée
dans une URL au moment du plan ; le point d'entrée cloud du conteneur compose donc
`DATABASE_URL` à partir des variables `DB_*` injectées, à l'exécution.

Deux jobs ponctuels s'exécutent lors du premier déploiement :

1. **`db-init`** (`postgres:15-alpine`), de façon idempotente :
   - détecte le socket / loopback du Cloud SQL Auth Proxy et attend PostgreSQL,
   - crée (ou met à jour) le rôle applicatif avec `LOGIN CREATEDB` et le mot de passe
     généré,
   - crée la base de données de l'application (propriété de `postgres` ; Cloud SQL ne
     peut pas faire de `SET ROLE` vers les rôles applicatifs),
   - accorde l'ensemble des privilèges sur la base et le schéma public et réattribue la
     propriété de `public` au rôle applicatif (Postgres 15 n'accorde plus `CREATE` sur
     `public` par défaut),
   - signale au Cloud SQL Auth Proxy de s'arrêter proprement.
2. **`glitchtip-migrate`** (l'image applicative GlitchTip construite,
   `depends_on = ["db-init"]`), de façon idempotente :
   - compose `DATABASE_URL` de la même manière que le point d'entrée d'exécution,
   - exécute `./manage.py migrate --noinput` (migrations de schéma Django),
   - exécute `createsuperuser --noinput` avec `SUPERUSER_EMAIL` et le mot de passe du
     superutilisateur stocké dans Secret Manager (le modèle utilisateur de GlitchTip
     utilise l'e-mail comme nom d'utilisateur ; un doublon est ignoré, de sorte que les
     relances sont sûres),
   - signale à l'Auth Proxy de s'arrêter.

Les deux jobs s'exécutent à l'apply (`execute_on_apply = true`) et peuvent être relancés
sans risque. Inspectez directement la base avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base et de l'utilisateur figurent dans les outputs du
déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée enveloppe `glitchtip/glitchtip:<version>` (`latest` par défaut) avec un point d'entrée POSIX-sh léger
(`entrypoint.sh`, installé sous `/usr/local/bin/cloud-entrypoint.sh`) qui s'exécute avant
le `./bin/start.sh` propre à l'image :

- **Compose `DATABASE_URL`** à partir des `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`, `DB_IP` injectés par la plateforme. Il distingue selon `DB_HOST` :
  - un **répertoire de socket** `/…` (Cloud Run) → `postgres://u:p@/db?host=<socketdir>`
    (les deux-points du chemin de socket cassent la forme d'URL `host:port`, il passe
    donc dans `?host=`) ;
  - `127.0.0.1` / `localhost` (sidecar Auth Proxy sur **GKE**) → TCP loopback simple,
    sans SSL ;
  - sinon une **IP privée** → TCP avec `sslmode=require` (Cloud SQL refuse le TCP non
    chiffré vers l'IP privée). Les identifiants et le chemin de socket sont encodés en
    URL avec Python 3 (présent dans l'image).
- **Désactive Valkey/Redis** — exporte `VALKEY_URL=""` pour que GlitchTip utilise
  PostgreSQL pour la file de tâches, le cache et les sessions (une valeur non définie
  basculerait par défaut sur Redis).
- **Déduit `GLITCHTIP_DOMAIN`** — le schéma+hôte public, à partir des
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés ; les opérateurs peuvent le
  surcharger pour un domaine personnalisé.
- **Définit `PORT=8080` et `SERVER_ROLE=all_in_one`**, puis fait un `exec` de la
  commande par défaut de l'image (`./bin/start.sh`), qui exécute le serveur web ainsi
  que le worker et le beat Celery dans un seul processus.

Le `Dockerfile`/`entrypoint.sh` sont intégrés à l'image : les modifier exige donc une
reconstruction ; les scripts de jobs `db-init.sh` et `glitchtip-migrate.sh` sont montés
au moment de l'apply et prennent effet à l'apply suivant sans reconstruction.

---

## 5. Paramètres applicatifs de base {#5-core-application-settings}

`GlitchTip_Common` établit l'environnement de référence de GlitchTip afin que
l'application démarre correctement dès le premier lancement :

- **Rôle tout-en-un** — `SERVER_ROLE = "all_in_one"` exécute le serveur web, le worker
  Celery et Celery beat dans un seul conteneur. Comme le worker et le beat s'exécutent
  dans le même processus, la plateforme maintient `min_instance_count >= 1` (et, sur
  Cloud Run, `cpu_always_allocated = true`) afin que le traitement des événements en
  arrière-plan se poursuive entre les requêtes HTTP.
- **Backend de file/cache** — `VALKEY_URL = ""` → file et cache adossés à PostgreSQL ;
  aucun Redis n'est nécessaire pour une instance unique.
- **Débogage** — `DEBUG = "false"`.
- **Inscription** — `ENABLE_OPEN_USER_REGISTRATION` et `ENABLE_USER_REGISTRATION` valent
  `"false"` par défaut (issus de `enable_open_user_registration`). Le propriétaire de
  l'instance est le superutilisateur créé par `glitchtip-migrate` ; les opérateurs les
  activent pour autoriser l'inscription en libre-service.
- **Rétention des événements** — `GLITCHTIP_MAX_EVENT_LIFE_DAYS = "90"` (issu de
  `max_event_life_days`) purge les événements d'erreur stockés depuis plus de N jours.
- **Port** — `container_port = 8080` (Granian).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

L'output `config` propre à ce module définit par défaut `startup_probe`/`liveness_probe`
sur `/_health/` et définit une `readiness_probe` sur le même chemin. Aucune de ces
valeurs par défaut n'est toutefois celle qui est réellement livrée : `GlitchTip_CloudRun`
comme `GlitchTip_GKE` déclarent leurs propres variables `startup_probe`/`liveness_probe`
et les transmettent directement à l'appel de ce module, ce qui remplace la valeur par
défaut `/_health/` ci-dessus. Ces variables propres aux variantes ont pour chemin par
défaut `/` (également un point de terminaison 200 non authentifié) : **`/` est donc le
chemin de sonde par défaut réellement déployé sur les deux plateformes**, et non
`/_health/`. Le champ `readiness_probe` est défini ici mais n'est jamais lu par
`App_CloudRun` ni par `App_GKE` — aucun des deux modules du socle ne câble de
`readiness_probe`/`readinessProbe` dans ses ressources Cloud Run ou Kubernetes — il
s'agit donc d'une configuration morte sans effet sur le comportement déployé.

Valeurs par défaut réellement déployées (issues du `variables.tf` de
`GlitchTip_CloudRun`/`GlitchTip_GKE`, identiques sur les deux plateformes) :

- **Démarrage** — HTTP `GET /`, délai initial de 60 s, période de 15 s, 30 échecs. Laisse
  une large fenêtre pour les migrations du premier démarrage exécutées par
  `glitchtip-migrate`.
- **Vivacité** — HTTP `GET /`, délai initial de 60 s, période de 30 s, 3 échecs.
- **Disponibilité (readiness)** — sans objet ; la `readiness_probe` définie par ce module
  n'est utilisée par aucun des deux modules du socle.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié (déclaré avec le suffixe de nom `storage`)
est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de
service de la charge de travail. Il héberge les pièces jointes/source maps téléversées
de GlitchTip lorsque le stockage d'objets est utilisé ; les variantes de plateforme
montent aussi NFS sur `/opt/glitchtip/storage` pour le stockage partagé des pièces
jointes. Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration de GlitchTip visible par l'utilisateur (variables par groupe,
outputs et manière d'explorer chaque service depuis la console et la CLI), consultez les
guides des plateformes :
**[GlitchTip_GKE](GlitchTip_GKE.md)** et **[GlitchTip_CloudRun](GlitchTip_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [GlitchTip sur GKE Autopilot](GlitchTip_GKE.md) — cette configuration déployée sur GKE.
