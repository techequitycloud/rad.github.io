---
title: "Roundcube Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Roundcube — paramètres de la couche application consommés par le déploiement Google Cloud Run."
---

<!-- translated-from: docs/modules/Roundcube_Common.md @ 2829548 sha256:4fac83d91d7d -->

# Roundcube Common — Configuration d'application partagée {#roundcube-common--shared-application-configuration}

`Roundcube_Common` est la **couche d'application partagée** pour Roundcube. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Roundcube sur
laquelle [Roundcube_CloudRun](Roundcube_CloudRun.md) s'appuie. Les utilisateurs finaux ne configurent
jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Roundcube est un **client** webmail IMAP basé sur un navigateur, et non un serveur de messagerie. Cette
couche ne déploie aucun service IMAP ou SMTP ; elle pointe Roundcube vers un service qui
existe déjà.

Pour l'infrastructure qui provisionne et exécute Roundcube, consultez le
guide de la plateforme ([Roundcube_CloudRun](Roundcube_CloudRun.md)) et les guides de base
([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Roundcube_Common | Où cela apparaît |
|---|---|---|
| Clé de session | Génère la `des_key` de Roundcube (chaîne aléatoire de 24 caractères) et la stocke dans **Secret Manager** | Injectée comme `ROUNDCUBEMAIL_DES_KEY` ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger de l'image officielle `roundcube/roundcubemail` `-apache` avec un point d'entrée wrapper ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Un job `db-init` (crée la base de données, l'utilisateur et les autorisations) ; l'image crée le schéma elle-même | Sortie `initialization_jobs` |
| Paramètres du serveur de messagerie | Définit `ROUNDCUBEMAIL_DEFAULT_HOST`/`_DEFAULT_PORT`, `ROUNDCUBEMAIL_SMTP_SERVER`/`_SMTP_PORT` et `ROUNDCUBEMAIL_SKIN` | Comportement de l'application dans le guide de la plateforme |
| Tests de disponibilité | Valeurs par défaut des sondes de démarrage et de vivacité HTTP `GET /` | §Observabilité dans le guide de la plateforme |

---

## 2. La `des_key` dans Secret Manager {#2-the-des_key-in-secret-manager}

Exactement un secret d'application est généré automatiquement et stocké dans Secret
Manager — il n'est jamais défini en texte clair :

- **`ROUNDCUBEMAIL_DES_KEY`** — une chaîne aléatoire de 24 caractères (sans caractères
  spéciaux, correspondant à la longueur générée par l'image du fournisseur), stockée sous
  `secret-<prefix>-roundcube-des-key`. Roundcube l'utilise pour chiffrer les données de session
  et le mot de passe IMAP qu'il détient au nom de chaque utilisateur connecté.

**Pourquoi il doit s'agir d'un secret géré.** Lorsque `config/config.inc.php` est absent, le
point d'entrée du fournisseur génère une clé par conteneur :

```sh
GENERATED_DES_KEY=`head /dev/urandom | base64 | head -c 24`
```

L'image ne déclare aucun volume, donc ce fichier ne persiste jamais sur Cloud Run, et
chaque instance créerait une clé **différente**. L'échec est silencieux : rien n'est
journalisé, les utilisateurs sont simplement déconnectés aléatoirement lorsque les requêtes atterrissent sur d'autres
instances, et à nouveau après chaque démarrage à froid. L'image lit
`ROUNDCUBEMAIL_DES_KEY` via `getenv()` à l'exécution, donc une variable d'environnement stable,
soutenue par Secret Manager, résout le problème. Le point d'entrée wrapper affiche un avertissement si la
variable est manquante.

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son
nom de secret est rapporté dans les sorties de déploiement de la plateforme
(`database_password_secret`).

Récupérez le secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~des-key"
gcloud secrets versions access latest --secret=<des-key-secret-name> --project "$PROJECT"
```

Voir [App_Common](App_Common.md) pour le modèle de secret partagé.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Roundcube fonctionne sur **Cloud SQL pour MySQL 8.0** (`MYSQL_8_0`). La base de données contient
les propres données de Roundcube — préférences, contacts et données de session — jamais le courrier.

Il y a **un seul** job d'initialisation, pas deux :

1. **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
   `timeout_seconds = 600`) — localise la connexion Cloud SQL (un socket Unix
   sous `/cloudsql` lorsque le volume du proxy d'authentification est monté, sinon TCP via l'IP privée de l'instance
   `DB_IP`), attend que MySQL soit accessible, crée/aligne
   l'utilisateur et la base de données de l'application, accorde les privilèges et vérifie que
   l'utilisateur de l'application peut se connecter (ce qui réchauffe également le cache côté serveur
   `caching_sha2_password`). Il s'exécute toujours car la valeur par défaut `caching_sha2_password` de Cloud SQL MySQL 8
   nécessite la création du rôle et de la base de données avec la gestion
   `--get-server-public-key`. Il signale ensuite à un sidecar Cloud SQL Auth Proxy, le cas échéant, de s'arrêter.

Le **schéma** n'est pas un job : le point d'entrée du fournisseur exécute `bin/installto.sh -y` à
chaque démarrage de conteneur, ce qui crée le schéma au premier démarrage et le met à jour
après un changement de version, de manière idempotente.

Fournir une liste `initialization_jobs` remplace entièrement le job `db-init` par défaut.
Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un build léger `FROM roundcube/roundcubemail:<ROUNDCUBE_VERSION>`
— la variante `-apache`, car la variante `-fpm` n'a pas de serveur web propre.

`scripts/Dockerfile` :

```dockerfile
ARG ROUNDCUBE_VERSION=1.6.19-apache
FROM roundcube/roundcubemail:${ROUNDCUBE_VERSION}

COPY entrypoint.sh /cloud-entrypoint.sh
RUN chmod +x /cloud-entrypoint.sh

ENTRYPOINT ["/cloud-entrypoint.sh"]
CMD ["apache2-foreground"]
```

`scripts/entrypoint.sh` s'exécute en premier à chaque démarrage de conteneur :

- **Compose un DSN encodé en URL.** Le point d'entrée du fournisseur construit
  `${TYPE}://${USER}:${PASSWORD}@${HOST}:${PORT}/${NAME}` **sans encodage d'URL**, et les mots de passe générés par Cloud SQL contiennent
  régulièrement `@ : / ? # % & +` — chacun étant un délimiteur d'URL. Le wrapper encode le mot de passe
  avec `rawurlencode` de PHP (l'image n'a pas de Python) et exporte
  `ROUNDCUBEMAIL_DSNW=mysql://DB_USER:<encoded>@DB_IP:DB_PORT/DB_NAME`. Le fournisseur
  utilise `:=`, donc un DSN déjà défini l'emporte. Cela ne peut pas être fait dans Terraform :
  le mot de passe est un secret d'exécution, et Cloud Run n'interpole pas les références
  `$(VAR)`.
- **Utilise `DB_IP`, pas `DB_HOST`.** `DB_IP` est un hôte simple (l'IP privée de Cloud SQL sur Cloud Run) ;
  la forme de répertoire de socket de `DB_HOST` (`/cloudsql/project:region:instance`) contient des deux-points et casserait l'URL.
  C'est pourquoi la couche définit `enable_cloudsql_volume = false`.
- **Définit `ROUNDCUBEMAIL_DSNR` sur le même DSN** (il n'y a pas de réplica en lecture) et
  exporte également `ROUNDCUBEMAIL_DB_TYPE`/`_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD`,
  afin que les deux chemins de code du fournisseur restent cohérents.
- **Applique la limite de mémoire PHP.** PHP ne lit aucune variable d'environnement pour
  `memory_limit`, et l'image livre `conf.d/roundcube-defaults.ini` avec
  `memory_limit=64M`. Le point d'entrée écrit `PHP_MEMORY_LIMIT` dans
  `/usr/local/etc/php/conf.d/zz-rad-overrides.ini` (`zz-` afin qu'il se charge après
  le propre fichier de l'image) et journalise `[startup] PHP memory_limit set to …`.
- **Transfère inchangé** — `exec /docker-entrypoint.sh "$@"`.

Le tag de base provient d'un ARG de build **spécifique à l'application** `ROUNDCUBE_VERSION` (pas du
générique `APP_VERSION` que la Fondation injecte), car les tags Roundcube portent un
suffixe de variante (`1.6.19-apache`) qu'une simple version ne résoudrait pas. Épinglez un
tag exact : une reconstruction sous une chaîne de tag inchangée ne produit pas de diff Terraform et
donc pas de nouvelle révision, de sorte qu'un tag glissant conserve silencieusement l'ancienne image.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

Cette couche définit l'environnement de base ; toute clé que la variante appelante transmet dans
`environment_variables` est fusionnée par-dessus et l'emporte :

| Variable | Source | Valeur par défaut |
|---|---|---|
| `ROUNDCUBEMAIL_DEFAULT_HOST` | `imap_host` | `""` |
| `ROUNDCUBEMAIL_DEFAULT_PORT` | `imap_port` | `993` |
| `ROUNDCUBEMAIL_SMTP_SERVER` | `smtp_host` | `""` |
| `ROUNDCUBEMAIL_SMTP_PORT` | `smtp_port` | `587` |
| `ROUNDCUBEMAIL_SKIN` | `skin` | `elastic` |
| `ROUNDCUBEMAIL_TEMP_DIR` | fixe | `/tmp/roundcube-temp` — zone de travail locale au conteneur pour les pièces jointes en transit, jamais le courrier au repos |
| `PHP_MEMORY_LIMIT` | `php_memory_limit` | `512M` |

- **Schéma d'hôte IMAP.** `ssl://host` pour TLS implicite (port 993), `tls://host` pour
  STARTTLS (port 143). Un nom d'hôte nu est en texte clair et ne doit être utilisé que pour
  un serveur à l'intérieur du VPC.
- **Port SMTP.** Google Cloud bloque le port 25 sortant pour toutes les egress, donc le serveur SMTP
  doit être un port de soumission (587 ou 465) sur un relais qui accepte
  le courrier authentifié.
- **`Roundcube_CloudRun` ne transmet pas `imap_host`, `imap_port`, `smtp_host`,
  `smtp_port` ou `skin`**, donc sur cette variante, ils conservent les valeurs par défaut ci-dessus et
  le serveur de messagerie est configuré via `environment_variables` à la place.
- **Pas de comptes.** Roundcube n'a pas de comptes locaux : les utilisateurs s'authentifient auprès du
  serveur IMAP. `admin_username` et `admin_email` sont enregistrés uniquement pour l'affichage ;
  rien n'est créé à partir d'eux.
- **`enable_gcs_storage_volume`** est déclaré mais non référencé par cette couche —
  il n'a aucun effet.

Valeurs par défaut du conteneur définies ici : `container_port = 80`, `database_type = MYSQL_8_0`,
`enable_cloudsql_volume = false`, `cloudsql_volume_mount_path = /cloudsql`, plus
les limites de ressources et les nombres d'instances transmis par la variante.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les deux sondes ciblent la racine du document, où Roundcube sert son formulaire de connexion :

- **Sonde de démarrage** — HTTP `GET /`, délai initial de 30 s, délai d'expiration de 10 s, période de 15 s,
  20 échecs autorisés. Le point d'entrée du fournisseur exécute `bin/installto.sh` et attend
  la base de données avant le démarrage d'Apache, donc le seuil est généreux.
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 60 s, délai d'expiration de 10 s, période de 30 s,
  3 échecs.

`Roundcube_CloudRun` transmet ses propres valeurs `startup_probe`/`liveness_probe`, qui
portent les mêmes paramètres.

---

## 7. Stockage d'objets {#7-object-storage}

Cette couche ne déclare **pas** son propre bucket de stockage (la sortie `storage_buckets`
est `[]`) et ne peuple pas `gcs_volumes` par défaut. Roundcube ne conserve aucune donnée
sur disque qui doit survivre à un redémarrage — le courrier réside sur le serveur IMAP et
les propres données de Roundcube résident dans MySQL. Le bucket GCS générique `data` vu dans le
guide de la plateforme provient de la valeur par défaut `storage_buckets` au niveau de la Fondation, et non
de cette couche, et n'est pas monté dans le conteneur.

---

Pour la configuration spécifique à Roundcube et destinée à l'utilisateur (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez le
guide de la plateforme : **[Roundcube_CloudRun](Roundcube_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Roundcube sur Google Cloud Run](Roundcube_CloudRun.md) — cette configuration déployée sur Cloud Run.
