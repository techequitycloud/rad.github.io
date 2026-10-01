---
title: "ClassicPress Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module ClassicPress — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/ClassicPress_Common.md @ 3055034 sha256:1575adb5b333 -->

# ClassicPress Common — Configuration applicative partagée {#classicpress-common--shared-application-configuration}

`ClassicPress_Common` est la **couche applicative partagée** de ClassicPress. Elle n'est
pas déployée seule ; elle fournit la configuration propre à ClassicPress sur laquelle
s'appuient à la fois [ClassicPress_GKE](ClassicPress_GKE.md) et
[ClassicPress_CloudRun](ClassicPress_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux
ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement ClassicPress, consultez les
guides des plateformes ([ClassicPress_GKE](ClassicPress_GKE.md),
[ClassicPress_CloudRun](ClassicPress_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par ClassicPress_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `CLASSICPRESS_SALT_SEED` (graine aléatoire de 64 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; le point d'entrée en dérive les 8 clés et sels d'authentification de type WordPress |
| Image de conteneur | Enveloppe l'image officielle `classicpress/classicpress` avec un script d'entrée personnalisé minimal ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge (`database_type = "MYSQL_8_0"` codé en dur dans `config`) | Section Base de données des guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et l'utilisateur et accorde les privilèges | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `classicpress-uploads` | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement ClassicPress de base : port de la base de données, préfixe des tables, jeu de caractères, variables d'environnement Redis conditionnelles | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage et de vivacité (TCP port 80 / HTTP `/`) | Section Observabilité des guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`CLASSICPRESS_SALT_SEED`** — une chaîne aléatoire de 64 caractères (sans caractères
  spéciaux) générée par `random_password.classicpress_salt_seed`. ClassicPress (un fork
  de WordPress 4.9.x) a besoin de 8 phrases secrètes `AUTH_KEY`/`SALT`
  (`AUTH_KEY`, `SECURE_AUTH_KEY`, `LOGGED_IN_KEY`, `NONCE_KEY` et leurs valeurs
  `_SALT` correspondantes). Plutôt que de stocker 8 secrets distincts,
  `ClassicPress_Common` stocke cette seule graine et le point d'entrée en dérive les 8
  valeurs de manière déterministe (`sha256(seed-<key-name>)`) à chaque démarrage du
  conteneur. Comme `/var/www/html` (et donc `wp-config.php`) n'est pas garanti de
  persister lors de la recréation des conteneurs ou des pods sur toutes les plateformes,
  la dérivation à partir d'une graine stable, adossée à un secret, maintient la
  cohérence des sessions et des cookies signés entre les redémarrages et au sein d'une
  flotte multi-instances, sans dépendre de la génération de sels aléatoires propre à
  l'image. **La rotation de cette graine après le premier démarrage invalide
  immédiatement tous les cookies signés et toutes les sessions connectées** pour
  l'ensemble des utilisateurs.

L'ID du secret dans Secret Manager utilise un seul trait de soulignement, et non un
double (`CLASSICPRESS_SALT_SEED`, exposé comme clé de sortie du même nom) — le CRD
SecretSync de GKE rejette les valeurs `targetKey` contenant `__` ; ce nom est donc sûr
sur les deux plateformes.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

Récupérer le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~salt-seed"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Un sous-module de nettoyage des secrets orphelins (`cleanup_orphaned_secrets`)
s'exécute avant la création des secrets afin de supprimer tout
`secret-<prefix>-<app>-salt-seed` obsolète laissé par un déploiement partiel précédent,
avant la création du nouveau.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

ClassicPress nécessite **MySQL 8.0** ; le `config` de `ClassicPress_Common` code en dur
directement `database_type = "MYSQL_8_0"` — le moteur est fixe, quelle que soit la
valeur de la variable `database_type` propre au module applicatif. Lors du premier
déploiement, un job ponctuel (`db-init`, script `scripts/db-init.sh`, image
`mysql:8.0-debian`) s'exécute et, de manière idempotente :

1. Attend le socket Unix de Cloud SQL Auth Proxy sous `/cloudsql` (jusqu'à 30
   secondes) si `enable_cloudsql_volume = true` ; sinon, se replie sur le TCP via
   `DB_IP` (préféré) ou un `DB_HOST` qui n'est pas un socket ;
2. Vérifie la présence de `DB_PASSWORD` et de `ROOT_PASSWORD` (injectés par le socle)
   et s'arrête avec une erreur explicite si l'un d'eux manque ;
3. Attend la connectivité TCP sur le port 3306 lorsqu'aucun socket n'est utilisé ;
4. Détecte si le client `mysql` local prend en charge `--get-server-public-key`
   (nécessaire pour le plugin d'authentification par défaut `caching_sha2_password` de
   MySQL 8 sur une connexion TCP simple terminée par le proxy) et ajoute l'option
   lorsqu'elle est disponible ;
5. Crée l'utilisateur de l'application (ou met à jour son mot de passe) avec
   `CREATE USER IF NOT EXISTS` / `ALTER USER ... IDENTIFIED BY` ;
6. Crée la base de données de l'application avec `CREATE DATABASE IF NOT EXISTS` ;
7. Accorde `ALL PRIVILEGES` sur la base de données à l'utilisateur de l'application et
   recharge les privilèges ;
8. Vérifie que l'utilisateur de l'application peut effectivement se connecter et
   exécuter `SELECT 1` — cela détecte tôt les incohérences de mot de passe ou de droits
   et préchauffe le cache d'authentification côté serveur `caching_sha2_password` de
   MySQL pour les connexions PHP suivantes ;
9. Demande au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (`POST
   /quitquitquit`, avec repli sur `SIGKILL` après 30 secondes d'attente) afin que le job
   se termine avec le code `0` au lieu d'être relancé sous `restartPolicy: OnFailure`.

Il n'existe pas de job distinct de migration ou de schéma. Une fois que `db-init` a
provisionné la base de données vide et l'utilisateur, ClassicPress crée son propre schéma
et son compte administrateur via son propre programme d'installation web au premier
lancement (`/wp-admin/install.php`) — le même schéma que celui qu'utilise WordPress. Le
job peut être réexécuté sans risque
(`execute_on_apply = true`, `max_retries = 3`, `timeout_seconds = 600`).

Inspecter directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un build minimal `FROM classicpress/classicpress:${CLASSICPRESS_VERSION}`
(le tag de base vaut par défaut `php8.3-apache` ; les tags amont sont qualifiés par la
version de PHP et non par la version de l'application, et les modules applicatifs
résolvent `application_version =
"latest"` vers cette valeur par défaut figée via un argument de build propre à
l'application, `CLASSICPRESS_VERSION` — l'argument de build générique `APP_VERSION` du
socle écraserait sinon silencieusement un argument du même nom avec le tag littéral et
inexistant `"latest"`). Le Dockerfile greffe un point d'entrée shell (`entrypoint.sh`,
copié vers `/usr/local/bin/cp-entrypoint.sh`) en amont du script `docker-entrypoint.sh`
d'origine :

- **Traduit `DB_*`/`DB_IP` en `CLASSICPRESS_DB_*`** — le `wp-config-docker.php` de
  ClassicPress lit des variables distinctes `CLASSICPRESS_DB_HOST` /
  `CLASSICPRESS_DB_NAME` / `CLASSICPRESS_DB_USER` / `CLASSICPRESS_DB_PASSWORD`, et non
  la convention de type Laravel `DB_USERNAME` qu'utilisent d'autres applications PHP de
  ce dépôt. Le socle injecte les variables génériques `DB_HOST`, `DB_IP`, `DB_NAME`,
  `DB_USER` et `DB_PASSWORD` ; le point d'entrée construit `CLASSICPRESS_DB_HOST` à
  partir de `${DB_IP:-DB_HOST}` : un `/` initial est traité comme un *répertoire* de
  socket Cloud SQL (le point d'entrée y recherche un fichier de socket et produit la
  forme mysqli `localhost:<socket>`), une valeur vide est laissée telle quelle pour que
  la valeur par défaut de l'image produise une erreur explicite, et toute autre valeur
  est traitée comme un hôte TCP et suffixée par `:${DB_PORT:-3306}`. MySQL sur la plage
  d'IP privées de Cloud SQL ne nécessite pas de SSL (contrairement à Postgres) ; ce
  chemin de code unique fonctionne donc sans modification à la fois sur Cloud Run
  (`DB_IP` = l'IP privée de l'instance) et sur GKE (`DB_HOST` remplacé par
  `127.0.0.1`, le sidecar cloud-sql-proxy).
- **Dérive les 8 clés et sels d'authentification** — lorsque `CLASSICPRESS_SALT_SEED`
  est présent, calcule `CLASSICPRESS_AUTH_KEY`, `CLASSICPRESS_SECURE_AUTH_KEY`,
  `CLASSICPRESS_LOGGED_IN_KEY`, `CLASSICPRESS_NONCE_KEY` et leurs équivalents `_SALT`
  sous la forme `sha256(seed-<key-name>)`, de sorte que chaque redémarrage et chaque
  instance d'une flotte s'accordent sur les mêmes valeurs (voir la section 2).
- **Passe la main au point d'entrée amont** — `exec docker-entrypoint.sh "$@"`, qui
  génère `wp-config.php` à partir des variables d'environnement `CLASSICPRESS_*`, copie
  l'application ClassicPress dans `/var/www/html` si ce répertoire est vide, et démarre
  `apache2-foreground` en tant que PID 1 (le `CMD` du Dockerfile).

**Comment la persistance fonctionne réellement — le chemin de montage NFS EST le
répertoire de données du point d'entrée.** Le Dockerfile et le script `entrypoint.sh` de
`ClassicPress_Common` ne contiennent eux-mêmes aucune référence explicite à un chemin
Filestore/NFS — les deux seules actions directes du point d'entrée sont les alias `DB_*`
décrits ci-dessus et la dérivation des sels. La persistance découle plutôt de
l'emplacement vers lequel pointe le `nfs_mount_path` de chaque module applicatif : les
deux variantes le définissent par défaut sur `/var/www/html/wp-content`, précisément le
sous-répertoire dans lequel le script *amont* `docker-entrypoint.sh` lit et écrit les
médias téléversés, les extensions installées et les thèmes. La logique de copie au
premier démarrage de l'image amont ignore explicitement un répertoire `wp-content`
existant au lieu de l'écraser ; c'est donc le montage de NFS directement sur ce chemin
qui rend le montage efficace, sans que cette couche Common ait besoin de code propre pour
le mettre en place :

- Sur **Cloud Run**, il n'existe aucun équivalent de PVC ; la valeur par défaut
  `enable_nfs = true`, qui monte Filestore sur `/var/www/html/wp-content`, est donc le
  mécanisme de persistance *principal* : les médias téléversés et les extensions ou
  thèmes installés via wp-admin survivent aux démarrages à froid après une mise à
  l'échelle à zéro, aux redéploiements et aux remplacements d'instance. Seuls les
  fichiers de base de ClassicPress situés en dehors de `wp-content` sont recopiés dans
  `/var/www/html` à chaque démarrage à froid, ce qui est attendu puisqu'ils sont livrés
  avec l'image. Consultez les sections 3 et 6 de
  [ClassicPress_CloudRun](ClassicPress_CloudRun.md).
- Sur **GKE**, le module applicatif (et non cette couche Common) active en outre
  `stateful_pvc_enabled = true`, ce qui sélectionne automatiquement un `StatefulSet` et
  monte un PVC bloc par pod sur `stateful_pvc_mount_path = /var/www/html` — l'ensemble
  du répertoire que remplit le point d'entrée amont, ce qui donne à toute l'installation
  (fichiers de base compris) une persistance par pod. La valeur par défaut
  `enable_nfs = true` de GKE monte toujours Filestore sur `/var/www/html/wp-content`, un
  sous-répertoire de ce PVC ; sur un StatefulSet à réplica unique, le PVC couvre déjà à
  lui seul `wp-content`, mais c'est le montage NFS qui maintiendrait `wp-content` durable
  et partagé si `stateful_pvc_enabled` venait à être désactivé ou si la charge de travail
  passait à plusieurs réplicas — consultez la section 3 de
  [ClassicPress_GKE](ClassicPress_GKE.md).

En résumé : le Dockerfile et le point d'entrée de cette couche n'ont pas besoin de
connaître directement NFS — la persistance fonctionne parce que la valeur par défaut de
`nfs_mount_path` de chaque module applicatif coïncide avec le sous-répertoire exact
(`wp-content`) que la logique de copie de l'image amont traite de façon particulière.
C'est cet alignement, et non du code de `ClassicPress_Common`, qui rend le montage
efficace sur les deux plateformes.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`ClassicPress_Common` établit l'environnement ClassicPress de base afin que l'application
démarre correctement au premier lancement :

- **Port de la base de données** — `DB_PORT = "3306"`, lu par `entrypoint.sh` pour
  construire `CLASSICPRESS_DB_HOST` sous la forme `host:port`.
- **Préfixe des tables** — `CLASSICPRESS_TABLE_PREFIX = "cp_"` (la valeur par défaut de
  l'image).
- **Jeu de caractères** — `CLASSICPRESS_DB_CHARSET = "utf8mb4"`.
- **Redis (conditionnel)** — lorsque `var.enable_redis = true`, ajoute
  `REDIS_HOST` (soit la valeur explicite `var.redis_host`, soit une référence littérale
  `$(REDIS_HOST)` que la plateforme résout) et `REDIS_PORT =
  var.redis_port`. `enable_redis` est transmis tel quel depuis le module applicatif — il
  ne dépend jamais de la définition de `redis_host`, de sorte que l'injection Redis
  propre au socle (Redis de la VM NFS) s'applique toujours lorsque `redis_host` est
  laissé vide.
- **Plugins MySQL** — `enable_mysql_plugins = false`, `mysql_plugins = []` ; aucun
  plugin MySQL côté serveur n'est installé par défaut.

Ajustements propres à chaque plateforme effectués dans les modules applicatifs (et non
dans cette couche Common, mais construits sur sa sortie `config`) :

- **Cloud Run** impose `enable_cloudsql_volume = false` lors de la fusion dans son
  `main.tf` (TCP sur IP privée par défaut, en remplaçant ce que `ClassicPress_Common`
  pourrait transmettre par ailleurs) ; c'est donc la branche TCP de `entrypoint.sh`
  (`DB_IP:DB_PORT`) qui s'exécute normalement.
- **GKE** ajoute `DB_HOST = "127.0.0.1"` par-dessus le
  `config.environment_variables` de `ClassicPress_Common` et impose
  `enable_cloudsql_volume = true` — le sidecar cloud-sql-proxy écoute sur l'interface de
  bouclage ; la branche TCP de `entrypoint.sh` s'exécute donc plutôt sur
  `127.0.0.1:3306`.

`php_memory_limit`, `upload_max_filesize` et `post_max_size` sont déclarées comme
variables et transmises à l'appel du module, mais le `config.environment_variables` de
`ClassicPress_Common` ne définit aucune variable d'environnement `PHP_*` ou de limite de
téléversement correspondante que l'image amont pourrait lire — elles n'ont actuellement
aucun effet observé sur le conteneur déployé.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Le fichier `variables.tf` de `ClassicPress_Common` fournit les valeurs par défaut des
sondes que les deux modules applicatifs transmettent telles quelles (aucune variante ne
les remplace) :

- **Sonde de démarrage** — **TCP** sur le port du conteneur (80), `initial_delay_seconds =
  30`, `period_seconds = 15`, `timeout_seconds = 10`, et un
  `failure_threshold = 20` généreux (environ 5 minutes de nouvelles tentatives après le délai initial) — assez de
  temps pour que le script amont `docker-entrypoint.sh` remplisse un `/var/www/html`
  vide au premier démarrage d'une nouvelle instance ou d'un nouveau pod.
- **Sonde de vivacité** — **HTTP** `GET /`, `initial_delay_seconds = 300`,
  `period_seconds = 60`, `timeout_seconds = 60`, `failure_threshold = 3`. Une réponse
  `200` (site déjà installé) comme une redirection `302` vers le programme d'installation
  du premier lancement (site neuf, non installé) sont considérées comme saines.

Il n'y a aucune différence entre Cloud Run et GKE à ce niveau — les deux variantes de
plateforme utilisent des valeurs par défaut de sondes identiques issues de
`ClassicPress_Common`. (La documentation propre à la variante GKE mentionne les mêmes
valeurs par défaut TCP/HTTP ; aucun remplacement par plateforme n'existe dans l'un ou
l'autre `main.tf`.)

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié, avec le suffixe de nom `classicpress-uploads`, est
déclaré dans `outputs.tf` (`location = var.region`, `force_destroy = true`) et
provisionné par le socle, qui accorde également l'accès au compte de service de la charge
de travail. Il n'est **pas** branché par défaut comme montage `gcs_volumes` par l'un ou
l'autre module applicatif — ajoutez une entrée à `gcs_volumes` (par exemple montée sur
`/var/www/html/wp-content/uploads`) si vous souhaitez qu'il serve réellement de stockage
aux médias téléversés.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~classicpress-uploads"
```

---

Pour la configuration propre à ClassicPress destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[ClassicPress_GKE](ClassicPress_GKE.md)** et
**[ClassicPress_CloudRun](ClassicPress_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [ClassicPress sur Google Cloud Run](ClassicPress_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [ClassicPress sur GKE Autopilot](ClassicPress_GKE.md) — cette configuration déployée sur GKE.
