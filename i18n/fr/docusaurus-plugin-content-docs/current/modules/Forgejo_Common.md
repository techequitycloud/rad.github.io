---
title: "Forgejo Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Forgejo — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Forgejo_Common.md @ 3055034 sha256:4e89f03a977c -->

# Forgejo Common — Configuration applicative partagée {#forgejo-common--shared-application-configuration}

`Forgejo_Common` est la **couche applicative partagée** de Forgejo. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Forgejo sur laquelle
s'appuient à la fois [Forgejo_GKE](Forgejo_GKE.md) et [Forgejo_CloudRun](Forgejo_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette
couche — elle ne possède aucun champ de déploiement propre dans l'interface —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Forgejo, consultez
les guides de plateforme ([Forgejo_GKE](Forgejo_GKE.md), [Forgejo_CloudRun](Forgejo_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Forgejo_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY` (64 caractères) et `INTERNAL_TOKEN` (64 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `codeberg.org/forgejo/forgejo` avec un point d'entrée de plateforme personnalisé ; build via Cloud Build | Sortie `container_image` / `container_build_config` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde les privilèges sur le schéma | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare **aucun** bucket GCS propre à l'application (la sortie `storage_buckets` vaut toujours `[]`) — Forgejo persiste tout sur NFS/Postgres | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Forgejo/Gitea de référence : type de base de données, domaine/URL/port du serveur, verrou d'installation, inscription libre, chemin des données NFS | Comportement de l'application dans les guides de plateforme |
| Vérifications de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/healthz` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement (`secrets.tf`, via `random_password`)
et stockés dans Secret Manager — ils ne sont jamais définis en clair et ne
doivent jamais être modifiés après le premier déploiement :

- **`SECRET_KEY`** — une chaîne aléatoire de 64 caractères (`random_password`,
  `special = false`). Forgejo l'utilise pour chiffrer les données sensibles
  stockées, comme les secrets 2FA et les jetons OAuth (`GITEA__security__SECRET_KEY`).
  La renouveler après le premier démarrage rend illisibles les données
  chiffrées auparavant.
- **`INTERNAL_TOKEN`** — une chaîne aléatoire de 64 caractères. Authentifie les
  appels d'API internes de Forgejo entre ses processus `web`/`ssh`
  (`GITEA__security__INTERNAL_TOKEN`). Le renouveler casse l'échange d'API
  interne de Forgejo jusqu'à ce que chaque processus prenne en compte la
  nouvelle valeur.

Les noms des secrets suivent `secret-<resource-prefix>-forgejo-secret-key` et
`secret-<resource-prefix>-forgejo-internal-token`. Un `time_sleep` de 30
secondes (`wait_for_secrets`) laisse à Secret Manager le temps d'atteindre la
cohérence lecture-après-écriture avant que les sorties `secret_ids`/`secret_values`
ne soient consommées en aval.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~internal-token"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret figure dans les sorties du déploiement de
plateforme (`database_password_secret`) et il est exposé sous l'alias
`GITEA__database__PASSWD` (Cloud Run) via `db_password_env_var_name` dans le
`main.tf` de chaque variante — sur GKE, cette variable reste vide et le mot de
passe parvient à Forgejo par le fichier monté par CSI
`GITEA__database__PASSWD__FILE` (voir la [section 4](#4-container-image-and-entrypoint)
et [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Forgejo exige **PostgreSQL 15** ; le moteur est fixé via `database_type =
"POSTGRES_15"` et le script `db-init.sh` est entièrement écrit pour
`psql` — MySQL ou `NONE` ne sont pas pris en charge, même si la liste
déroulante `database_type` de la plateforme les propose. Lors du premier
déploiement, une tâche ponctuelle (`db-init`, `postgres:15-alpine`,
`execute_on_apply = true`, `max_retries = 3`) effectue de manière idempotente
les opérations suivantes :

1. Installe `curl` s'il est absent (nécessaire sur l'image Alpine sur GKE ; déjà
   présent dans l'image de tâche Debian d'App_CloudRun),
2. Force `DB_HOST=127.0.0.1` lorsque `DB_SSL=false` et que `DB_HOST` n'est pas
   déjà un chemin de socket, afin de garantir que le trafic passe par le
   sidecar Cloud SQL Auth Proxy plutôt que par une simple adresse IP privée,
3. Attend que PostgreSQL accepte les connexions (`SELECT 1` sur la base de
   données du superutilisateur `postgres`, avec le secret `ROOT_PASSWORD`
   injecté),
4. Crée le rôle applicatif (`CREATE ROLE ... LOGIN PASSWORD`) s'il n'existe pas,
   ou redéfinit son mot de passe s'il existe, et lui accorde `CREATEDB` ainsi
   que l'appartenance à `postgres`,
5. Crée la base de données applicative appartenant à ce rôle si elle n'existe
   pas, ou en réattribue la propriété si elle existe déjà,
6. Accorde tous les privilèges sur la base de données et sur le schéma `public`
   (PG15+ exige une autorisation explicite sur le schéma, même pour les objets
   du propriétaire),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement
   (`POST /quitquitquit` sur `localhost:9091`, interrogé pendant 60 secondes au
   maximum).

Ce script n'installe aucune extension Postgres — Forgejo crée et migre son
propre schéma au premier démarrage du conteneur (voir la
[section 4](#4-container-image-and-entrypoint)), si bien que rien d'autre qu'une
base de données vide et attribuée n'est nécessaire. La tâche peut être
relancée sans risque.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans
les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`scripts/Dockerfile`) encapsule
`codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}` — un ARG de build propre à
l'application, et non le `APP_VERSION` générique que le socle injecte dans
`build_args` (qui l'emporterait sinon lors de la fusion et se résoudrait en
`forgejo:latest`) ; le module Common fait correspondre
`application_version = "latest"` au tag épinglé `11`. L'image s'exécute en tant
que `root` (comme le point d'entrée Forgejo d'origine, qui abandonne lui-même
ses privilèges au profit de l'utilisateur `git` sous `s6`) et ajoute
`/platform-entrypoint.sh` (`scripts/entrypoint.sh`) comme `ENTRYPOINT` du
conteneur, en redéclarant le `CMD ["/usr/bin/s6-svscan", "/etc/s6"]` d'origine
que la surcharge de `ENTRYPOINT` réinitialiserait sinon.

Les responsabilités du point d'entrée de plateforme, exécutées avant de passer
la main au point d'entrée propre à Forgejo :

- **Compose `GITEA__database__*` à partir des variables d'environnement `DB_*`
  distinctes du socle au moment de l'exécution**, plutôt qu'au moment du plan
  Terraform. Les références `$(VAR)` de style Kubernetes ne sont pas utilisées,
  car Cloud Run ne les interpole pas (il transmettrait la chaîne littérale
  `"$(DB_HOST)"`, provoquant un échec de résolution DNS) — composer à
  l'exécution permet à un même point d'entrée de fonctionner sans modification
  sur les deux plateformes.
- **Sélectionne le mode SSL de Postgres pour chaque saut de connexion**, en
  fonction de la forme de `DB_HOST` :
  - `/` en tête (répertoire de socket Unix du Cloud SQL Auth Proxy) → `HOST` =
    le répertoire de socket, `SSL_MODE=disable`.
  - `127.0.0.1` ou `localhost` (boucle locale du sidecar Cloud SQL Auth Proxy,
    GKE) → `HOST` = `host:port`, `SSL_MODE=disable`.
  - Toute autre valeur (TCP direct sur IP privée, valeur par défaut de Cloud
    Run) → `HOST` = `host:port`, `SSL_MODE=require` (Cloud SQL refuse le TCP
    non chiffré sur IP privée).
- **Fait correspondre `DB_NAME` / `DB_USER`** directement à `GITEA__database__NAME` /
  `GITEA__database__USER` lorsqu'elles sont définies.
- **Journalise le câblage résolu** (`Forgejo DB wired: host=... sslmode=... name=...
  user=...`) pour faciliter le dépannage.
- **Résout à nouveau `s6-svscan` via `PATH`** si la commande transmise n'est pas
  directement exécutable, car son chemin varie selon les images de base
  (`/usr/bin` ou `/bin`), puis exécute par `exec` le `/usr/bin/entrypoint "$@"`
  d'origine en tant que PID 1 — qui applique l'ensemble de l'environnement
  `GITEA__*` à `app.ini` et lance le serveur Forgejo et `sshd` sous `s6`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Forgejo_Common` établit l'environnement Forgejo/Gitea de référence afin que
l'application démarre correctement dès le premier lancement :

- **Type de base de données** — `GITEA__database__DB_TYPE = "postgres"` (fixe).
- **Serveur** — `GITEA__server__DOMAIN = var.public_domain` (par défaut
  `"localhost"`), `GITEA__server__ROOT_URL = var.public_url` (dérivée sous la
  forme `http://<public_domain>/` lorsque `public_url` est laissée vide),
  `GITEA__server__HTTP_PORT = var.container_port` (par défaut `3000`),
  `GITEA__server__PROTOCOL = "http"`.
- **Sécurité** — `GITEA__security__INSTALL_LOCK = "true"`, qui court-circuite
  l'assistant d'installation web de Forgejo puisque la base de données et la
  configuration sont déjà fournies par des variables d'environnement.
- **Service** — `GITEA__service__DISABLE_REGISTRATION = "false"` — l'inscription
  publique libre est ouverte par défaut.
- **Chemin des données** — `GITEA__server__APP_DATA_PATH = var.nfs_mount_path` —
  dirige le stockage des dépôts, de Git LFS et des pièces jointes de Forgejo
  vers le volume NFS monté (la valeur par défaut interne de ce module est
  `/data` ; les deux variantes de plateforme la remplacent par `/mnt/nfs`).

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run (`use_file_secrets = false`, la valeur par défaut)** — `SECRET_KEY`
  et `INTERNAL_TOKEN` sont exposés directement sous les noms `GITEA__security__`
  dans `secret_ids`, de sorte que le socle les injecte comme variables
  d'environnement `GITEA__` sans indirection (il n'existe sur Cloud Run aucune
  restriction de CRD SecretSync à contourner).
- **GKE (`use_file_secrets = true`)** — la validation `targetKey` de la CRD
  SecretSync de GKE interdit les traits de soulignement consécutifs, si bien que
  les noms `GITEA__` ne peuvent pas servir de clés de secrets synchronisés.
  `Forgejo_Common` matérialise donc les secrets sous les clés **simples**
  `SECRET_KEY` / `INTERNAL_TOKEN` (ainsi que le mot de passe de la base de
  données), et définit trois variables d'environnement supplémentaires qui
  utilisent la convention propre à Forgejo `GITEA__section__KEY__FILE` pour
  pointer vers les fichiers montés par CSI :
  `GITEA__database__PASSWD__FILE`, `GITEA__security__SECRET_KEY__FILE`,
  `GITEA__security__INTERNAL_TOKEN__FILE` (toutes sous `var.secrets_mount_path`,
  par défaut `/mnt/secrets-store`). Les *noms* de ces variables d'environnement
  contiennent `__`, mais ce sont de simples variables d'environnement et non des
  clés de secrets synchronisés : la restriction de la CRD ne s'y applique donc
  pas.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut (déclarées ici, dans `variables.tf`) ciblent `/api/healthz` —
le point de terminaison de santé non authentifié de Forgejo, qui ne répond
correctement qu'une fois que le serveur a terminé les migrations de schéma du
premier démarrage :

- **`startup_probe`** — HTTP `/api/healthz`, `initial_delay_seconds=30`,
  `timeout_seconds=5`, `period_seconds=10`, `failure_threshold=30`.
- **`liveness_probe`** — HTTP `/api/healthz`, `initial_delay_seconds=15`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.

Les deux variantes de plateforme remplacent ces valeurs par défaut de Common
dans leur propre `variables.tf` :

- **Cloud Run** élargit la fenêtre de démarrage à `period_seconds=20`,
  `failure_threshold=10` (environ 200 s de tolérance après le délai initial).
- **GKE** lance la sonde de démarrage immédiatement (`initial_delay_seconds=0`,
  `timeout_seconds=10`, `period_seconds=30`, `failure_threshold=10`) et
  retarde davantage la sonde de vivacité (`initial_delay_seconds=60`).

Consultez les guides de plateforme correspondants pour les valeurs exactes de
chaque variante.

---

## 7. Stockage d'objets {#7-object-storage}

`Forgejo_Common` renvoie toujours une sortie `storage_buckets` **vide** —
Forgejo n'utilise Cloud Storage pour rien ; toutes les données durables de
l'application résident dans le répertoire de données monté en NFS (dépôts,
objets Git LFS, pièces jointes) et dans Cloud SQL (métadonnées). Les deux
variantes de plateforme provisionnent néanmoins un bucket générique inutilisé,
suffixé `data`, via la valeur par défaut `storage_buckets`/`create_cloud_storage`
du socle — ce bucket existe indépendamment de ce module et peut être désactivé
avec `create_cloud_storage =
false` si vous n'en avez pas besoin. Listez les buckets avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~data"
```

---

Pour la configuration propre à Forgejo destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Forgejo_GKE](Forgejo_GKE.md)** et
**[Forgejo_CloudRun](Forgejo_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Forgejo sur Google Cloud Run](Forgejo_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Forgejo sur GKE Autopilot](Forgejo_GKE.md) — cette configuration déployée sur GKE.
