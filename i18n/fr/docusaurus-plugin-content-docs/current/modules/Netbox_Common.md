---
title: "NetBox Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module NetBox — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Netbox_Common.md @ 3055034 sha256:f89934097fb0 -->

# NetBox Common — Configuration applicative partagée {#netbox-common--shared-application-configuration}

`Netbox_Common` est la **couche applicative partagée** de NetBox. Elle n'est pas
déployée seule ; elle fournit la configuration propre à NetBox sur laquelle
s'appuient à la fois [Netbox_GKE](Netbox_GKE.md) et
[Netbox_CloudRun](Netbox_CloudRun.md), afin que les deux variantes de plateforme se
comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement NetBox, consultez les
guides des plateformes ([Netbox_GKE](Netbox_GKE.md), [Netbox_CloudRun](Netbox_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Netbox_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY` (secret Django de 64 caractères ; NetBox exige ≥50) et `SUPERUSER_PASSWORD` (mot de passe administrateur initial de 24 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `netboxcommunity/netbox` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Worker d'arrière-plan | Colocalise `manage.py rqworker --with-scheduler` comme processus en arrière-plan à côté du serveur web dans le même conteneur | Comportement de l'application dans les guides des plateformes |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare le bucket **Cloud Storage** `media`, monté sur le véritable `MEDIA_ROOT` de NetBox | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement NetBox de référence : transmission du moteur de base de données, résolution de l'hôte Redis, fuseau horaire, identité de l'administrateur, CSRF/CORS | Comportement de l'application dans les guides des plateformes |
| Contrôles d'état | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/login/` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **`SECRET_KEY`** — une chaîne aléatoire de 64 caractères. NetBox (Django) l'utilise
  pour la signature des sessions, la protection CSRF et les cookies signés, et exige
  qu'elle comporte au moins 50 caractères. La renouveler après le premier démarrage
  invalide toutes les sessions actives et les cookies signés.
- **`SUPERUSER_PASSWORD`** — une chaîne aléatoire de 24 caractères utilisée pour
  définir le mot de passe du compte administrateur initial créé automatiquement
  (`admin_user`/`admin_email`, par défaut `admin`/`admin@example.com`) au premier
  démarrage. La création du superutilisateur est idempotente — ignorée (sans erreur)
  si un utilisateur portant ce nom existe déjà — ; régénérer ce secret ne modifie
  donc pas rétroactivement le mot de passe d'un compte déjà créé ; changez-le plutôt
  via l'interface de NetBox.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~-key OR name~admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret est indiqué dans les sorties du déploiement de la
plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour
le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

NetBox nécessite **PostgreSQL 14 ou ultérieur** (ce module fixe la version **15**) ;
le moteur est imposé et MySQL ou SQLite ne sont pas pris en charge en production. Au
premier déploiement, un job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine`
et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (sur Cloud Run) et le mappe pour
   l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec cet utilisateur
   comme propriétaire,
5. Accorde tous les privilèges sur la base de données et le schéma public,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Le `configuration.py` de NetBox lit nativement `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/
`DB_PASSWORD` (variables d'environnement distinctes de psycopg2) — aucun renommage
n'est nécessaire, contrairement aux applications qui composent une chaîne DSN unique.
Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `netboxcommunity/netbox:<version>` (via
`Netbox_Common/scripts/Dockerfile`, `USER root` — conforme à l'image amont, qui ne
définit aucun `USER` non root) avec un point d'entrée shell léger
(`entrypoint.sh`) qui s'exécute avant le démarrage de l'application :

- **Choix du mode SSL de la base de données** — `DB_SSLMODE` est défini à `disable`
  pour un répertoire de socket Unix Cloud Run (chemin commençant par `/`) ou une
  boucle locale du Cloud SQL Auth Proxy sur GKE (`127.0.0.1`/`localhost`), et à
  `require` pour une connexion TCP brute sur IP privée.
- **Résolution de l'espace réservé Redis** — si `REDIS_HOST` contient encore une
  référence `$(NFS_SERVER_IP)` non résolue (une particularité de l'ordre de
  déclaration de Cloud Run, où les substitutions `$(VAR)` peuvent être transmises
  littéralement), le point d'entrée la résout directement à partir de la variable
  d'environnement `NFS_SERVER_IP`.
- **Fixation des bases Redis** — `REDIS_DATABASE` (file de tâches, par défaut `0`) et
  `REDIS_CACHE_DATABASE` (cache, par défaut `1`) sont toujours définies comme des
  bases logiques distinctes.
- **Séquence de premier démarrage propre à NetBox** —
  `/opt/netbox/docker-entrypoint.sh true` s'exécute de manière synchrone : attente de
  la disponibilité de la base, `migrate --no-input`, nettoyage des contenttypes
  obsolètes, nettoyage des sessions, réindexation paresseuse de l'index de recherche
  et amorçage du superutilisateur à partir des variables d'environnement
  `SUPERUSER_*`. Le `true` final lui fait exécuter sa configuration complète puis
  renvoyer 0 à ce script (la convention propre au projet netbox-docker pour exécuter
  la configuration une fois par rôle de conteneur avant de lancer le processus
  effectif de ce rôle), au lieu de remplacer ce processus.
- **Worker RQ d'arrière-plan** — `manage.py rqworker --with-scheduler` démarre comme
  processus en arrière-plan (`&`) avec une interception des signaux, puis le serveur
  web est lancé en dernier via `exec` en tant que PID 1. Il est colocalisé ici
  (plutôt que dans un service Cloud Run supplémentaire distinct) parce que les deux
  processus doivent partager cette image construite sur mesure et l'environnement
  base de données/Redis/secrets injecté par la plateforme — le même modèle que
  celui utilisé ailleurs dans ce catalogue pour les processus worker colocalisés
  (par exemple le worker Celery de Saleor, l'agent de Woodpecker).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Netbox_Common` établit l'environnement NetBox de référence afin que l'application
démarre correctement la première fois :

- **Redis est obligatoire.** `REDIS_HOST` est résolu à partir de `redis_host`, de
  l'IP du serveur NFS ou de l'espace réservé d'exécution `$(NFS_SERVER_IP)`, dans cet
  ordre. `REDIS_SSL = "false"` par défaut.
- **`ALLOWED_HOSTS = "*"` et `CORS_ORIGIN_ALLOW_ALL = "true"`** — ouverts par défaut
  pour un premier déploiement sans intervention ; restreignez-les via
  `environment_variables` dans le module applicatif pour une instance de production
  renforcée.
- **`CSRF_TRUSTED_ORIGINS`** est défini à partir de la variable `service_url` de
  l'appelant — `Netbox_CloudRun` et `Netbox_GKE` la calculent tous deux à partir de
  l'URL réelle prévue du service (le hash propre à l'application + le numéro de
  projet sur Cloud Run ; l'URL interne du service du cluster sur GKE), et non à partir
  du préfixe de ressources propre au seul tenant, qui construirait l'URL d'un service
  inexistant et rejetterait chaque POST authentifié (y compris la connexion) avec un
  échec CSRF.
- **`TIME_ZONE`** — défini à partir de `time_zone` (par défaut `UTC`).
- **Compte administrateur initial** — `SUPERUSER_NAME`/`SUPERUSER_EMAIL` à partir de
  `admin_user`/`admin_email` (par défaut `admin`/`admin@example.com`) ;
  `SUPERUSER_PASSWORD` est injecté sous forme de référence à un secret Secret Manager.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/login/` — la page de connexion publique et non
authentifiée de NetBox, qui ne répond qu'une fois le serveur entièrement initialisé
et connecté à PostgreSQL. `/api/status/` n'est délibérément **pas** utilisé, car il
nécessite une authentification et ferait échouer chaque sonde de santé de la
plateforme.

- Sonde de démarrage : HTTP `/login/`, délai initial de 60 secondes, seuil d'échec de
  60 (pour laisser le temps aux migrations du premier démarrage).
- Sonde de vivacité : HTTP `/login/`, délai initial de 60 secondes, seuil d'échec de 3.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** `media` dédié est déclaré ici et monté via GCS Fuse sur
le véritable `MEDIA_ROOT` de NetBox, `/etc/netbox/media` (confirmé en conditions
réelles via `manage.py shell` ; **pas** `/opt/netbox/netbox/media`, qui semble plus
évident mais n'est pas l'emplacement où NetBox écrit les téléversements). C'est
délibérément l'unique stockage persistant pour les images d'équipements/de baies et
les pièces jointes — si le chemin de montage est erroné, les téléversements sont
écrits sur le système de fichiers éphémère du conteneur : ils sont relisibles
immédiatement (même système de fichiers local), sans erreur visible, mais
n'atteignent jamais GCS et sont perdus à chaque redémarrage.

Options de montage : `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`,
`uid=0`, `gid=0`, `file-mode=0664`, `dir-mode=0775`. La fixation `uid=0`/`gid=0`
correspond au conteneur de NetBox exécuté en root (l'image officielle ne définit
aucun `USER`). Sur **Cloud Run**, c'est quasiment sans effet — l'intégration GCS Fuse
propre à la plateforme applique déjà `uid:1000/gid:1000` par défaut, et root peut
écrire dans les fichiers de n'importe quel propriétaire. Sur **GKE**, le pilote CSI
GCS Fuse n'a pas de valeur par défaut équivalente ; c'est donc cette fixation
explicite qui rend le montage accessible en écriture.

```bash
gcloud storage buckets list --project "$PROJECT"
```

Le nom du bucket est calculé sous la forme `gcs-${application_name}${tenant_resource_prefix}-media`,
en utilisant le préfixe propre au **seul tenant** (correspondant au hash propre du
module `deployment_id`) afin de s'aligner sur ce que le socle crée réellement.

---

Pour la configuration propre à NetBox destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Netbox_GKE](Netbox_GKE.md)** et
**[Netbox_CloudRun](Netbox_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [NetBox sur Google Cloud Run](Netbox_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [NetBox sur GKE Autopilot](Netbox_GKE.md) — cette configuration déployée sur GKE.
