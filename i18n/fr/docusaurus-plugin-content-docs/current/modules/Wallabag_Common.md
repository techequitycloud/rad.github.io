---
title: "Wallabag Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Wallabag — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Wallabag_Common.md @ 944fee5 sha256:4b3a1a7fedb8 -->

# Wallabag Common — Configuration applicative partagée {#wallabag-common--shared-application-configuration}

`Wallabag_Common` est la **couche applicative partagée** de Wallabag. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Wallabag sur laquelle
s'appuient [Wallabag_GKE](Wallabag_GKE.md) et [Wallabag_CloudRun](Wallabag_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle ne possède aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Wallabag, consultez les
guides des plateformes ([Wallabag_GKE](Wallabag_GKE.md), [Wallabag_CloudRun](Wallabag_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Wallabag_Common | Où cela apparaît |
|---|---|---|
| Secret applicatif | Génère un `APP_SECRET` Symfony (chaîne aléatoire de 32 caractères) et le stocke dans **Secret Manager**, en remplacement de la valeur par défaut intégrée de Wallabag, connue publiquement | Injecté comme variable d'environnement secrète du conteneur ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger de l'image officielle `wallabag/wallabag` (nginx + php-fpm, s6-overlay) avec un point d'entrée encapsulant ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) comme moteur | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit une chaîne de deux jobs : `db-init` (crée la base de données, l'utilisateur et les droits) → `wallabag-install` (exécute le programme d'installation propre à Wallabag) | Sortie `initialization_jobs` |
| Paramètres principaux | Définit l'environnement de base de Wallabag : pilote/jeu de caractères/préfixe de table de la base de données, auto-inscription désactivée | Comportement de l'application dans les guides des plateformes |
| Sondes de santé | Déclare les variables `startup_probe`/`liveness_probe` — en pratique, ce sont les valeurs par défaut de la variante appelante qui l'emportent (voir §6) | §Observabilité dans les guides des plateformes |

---

## 2. Le secret applicatif Symfony dans Secret Manager {#2-the-symfony-app-secret-in-secret-manager}

Un seul secret est généré automatiquement et stocké dans Secret Manager — il
n'est jamais défini en clair :

- **`APP_SECRET`** — une chaîne aléatoire de 32 caractères (sans caractères spéciaux), stockée
  sous le nom `secret-<prefix>-<app>-app-secret`. Le `parameters.yml` livré avec Wallabag
  intègre un secret Symfony par défaut **connu publiquement**
  (`ovmpmAWXRCabNlMgzlzFXDYmCFfzGv`), utilisé pour les jetons CSRF et d'autres
  signatures sensibles en matière de sécurité — ce module en génère un véritable et
  le remplace.

Le secret est matérialisé dans Secret Manager sous la clé simple `APP_SECRET`
(et non sous le véritable nom cible `SYMFONY__ENV__SECRET`), car le CRD SecretSync de GKE
rejette les valeurs `targetKey` contenant des séparateurs `_` consécutifs. Le point d'entrée
encapsulant associe `APP_SECRET` à `SYMFONY__ENV__SECRET` au démarrage du conteneur.
Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`).

Récupérez le secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
gcloud secrets versions access latest --secret=<app-secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Wallabag s'exécute sur **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) ; le moteur est fixé
par cette couche. Deux jobs d'initialisation s'exécutent l'un après l'autre :

1. **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
   `timeout_seconds = 600`) — localise la connexion Cloud SQL (un socket Unix
   sous `/cloudsql` lorsque le volume/sidecar de l'Auth Proxy est monté, sinon TCP
   via l'IP privée de l'instance), attend que MySQL soit joignable, crée/aligne
   l'utilisateur applicatif et la base de données, accorde les droits, vérifie que
   l'utilisateur applicatif peut se connecter (ce qui préchauffe aussi le cache côté serveur de
   `caching_sha2_password`), puis signale au sidecar Cloud SQL Auth Proxy de s'arrêter
   proprement.
2. **`wallabag-install`** (`depends_on_jobs = ["db-init"]`, `max_retries = 3`,
   `timeout_seconds = 900`) — réutilise la même image applicative personnalisée (`image = null`),
   de sorte que le point d'entrée encapsulant définit toujours `SYMFONY__ENV__DATABASE_*` et
   `SYMFONY__ENV__SECRET`, sa commande étant remplacée via `args = ["bin/console",
   "wallabag:install", "--env=prod", "-n"]`. Cette commande unique crée le
   schéma MySQL **et** effectue la configuration initiale de Wallabag (y compris le
   compte administrateur par défaut) — il n'y a pas de job de migration distinct, contrairement
   à d'autres applications de ce catalogue où l'installation du schéma et la configuration applicative
   sont deux étapes distinctes.

Les deux jobs peuvent être relancés sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un build léger : `FROM wallabag/wallabag:<WALLABAG_VERSION>`
(l'image officielle nginx + php-fpm, exécutée sous s6-overlay, `WORKDIR
/var/www/wallabag`) plus un point d'entrée encapsulant qui s'exécute avant le
point d'entrée propre à l'image de base.

`scripts/Dockerfile` :

```dockerfile
ARG WALLABAG_VERSION=2.6.14
FROM wallabag/wallabag:${WALLABAG_VERSION}

COPY entrypoint.sh /entrypoint-wrapper.sh
RUN mv /entrypoint.sh /original-entrypoint.sh \
    && mv /entrypoint-wrapper.sh /entrypoint.sh \
    && chmod +x /entrypoint.sh /original-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["wallabag"]
```

`scripts/entrypoint.sh` s'exécute en premier à chaque démarrage du conteneur :

- **Associe `DB_*` à `SYMFONY__ENV__DATABASE_*`** — la plateforme injecte les variables
  standard, propres au tenant, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD` ; Wallabag lit à la place les variables distinctes `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/
  `_NAME`/`_USER`/`_PASSWORD`. Le script exporte directement ces alias — cette correspondance est codée en dur
  dans le point d'entrée, et non pilotée par les entrées `db_*_env_var_name` des
  modules applicatifs, qui ne sont pas utilisées pour
  Wallabag (elles valent toutes `""` par défaut).
- **Définit explicitement `SYMFONY__ENV__DATABASE_DRIVER=pdo_mysql`.** Voir le §5 ci-dessous —
  c'est le correctif d'un bug réel d'échec silencieux, déjà rencontré.
- **Associe `APP_SECRET` à `SYMFONY__ENV__SECRET`.**
- **Passe la main à l'image de base sans modification** — `exec /original-entrypoint.sh
  "$@"` préserve intacte la logique de répartition des commandes de l'image de base : `wallabag` (démarrage du serveur),
  transmission à la CLI, ou commandes d'import/migration.

Le tag de base est contrôlé par un ARG de build **propre à l'application**, `WALLABAG_VERSION`
(et non par le `APP_VERSION` générique que le socle injecte dans `build_args` et
qui l'écraserait sinon avec `"latest"`) ; `application_version = "latest"` correspond
à un tag épinglé, connu pour fonctionner (`2.6.14`), au moment du build. Les deux variantes de plateforme transmettent
`container_image_source = "custom"` afin que l'étape Cloud Build s'exécute réellement (un
remplacement par `"prebuilt"` ignorerait le point d'entrée encapsulant ainsi que la totalité des alias de base de données et
de secret).

---

## 5. Le correctif `SYMFONY__ENV__DATABASE_DRIVER` (pourquoi il compte) {#5-the-symfony__env__database_driver-fix-why-it-matters}

Le `parameters.yml` livré avec Wallabag définit `database_driver` à `pdo_sqlite` par défaut.
Définir uniquement `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` —
sans `SYMFONY__ENV__DATABASE_DRIVER` explicite — laisse encore la résolution des paramètres de
Symfony se rabattre sur la valeur par défaut SQLite intégrée. Cela a été
confirmé par des tests Docker en local avant tout déploiement dans le cloud : le
conteneur affichait `"Configuring the SQLite database..."` et s'installait sur un
fichier SQLite jetable à l'intérieur du conteneur, en ignorant silencieusement et complètement la
connexion MySQL pourtant correctement configurée.

Il s'agit d'une catégorie de bug réellement dangereuse, car elle ne produit **aucune** erreur — l'installation
« réussit », l'application semble fonctionner de bout en bout, mais toutes les données résident dans un
fichier local au conteneur, effacé à chaque redémarrage ou redéploiement, et Cloud SQL
n'est jamais sollicité. `scripts/entrypoint.sh` le corrige avec une seule ligne explicite :

```sh
export SYMFONY__ENV__DATABASE_DRIVER="pdo_mysql"
```

aux côtés des autres exports `SYMFONY__ENV__DATABASE_*`, avant de déléguer au
point d'entrée de l'image de base. **Si ce module est un jour cloné comme modèle pour
une autre application basée sur Symfony, vérifiez que la variable d'environnement du pilote de base de données est définie
explicitement** — une variable de pilote manquante peut se rabattre silencieusement sur une valeur SQLite
intégrée par défaut, sans aucune erreur, et l'échec est invisible de l'extérieur
(les sondes de santé réussissent, l'interface fonctionne) — seuls les journaux de démarrage du conteneur ou le
journal d'audit de la base de données le révèlent.

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

`Wallabag_Common` établit l'environnement de base afin que l'application
s'installe et démarre correctement dès le premier lancement :

- **`SYMFONY__ENV__DATABASE_CHARSET = "utf8mb4"`**, **`SYMFONY__ENV__DATABASE_TABLE_PREFIX
  = "wallabag_"`** — valeurs de configuration MySQL statiques.
- **`SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`**, **`SYMFONY__ENV__FOSUSER_CONFIRMATION
  = "false"`** — l'inscription en libre-service est désactivée ; le
  compte administrateur amorcé (créé par `wallabag-install`) est le
  seul compte tant qu'un opérateur n'a pas explicitement activé l'inscription ou créé d'autres
  comptes.
- **`SYMFONY__ENV__DOMAIN_NAME`** — défini à partir de l'URL prévue/réelle du service
  lorsque la variante appelante la fournit ; sert à construire les liens absolus.

Valeurs par défaut du conteneur définies ici : `container_port = 80`, `database_type =
MYSQL_8_0`, `cloudsql_volume_mount_path = /cloudsql`, ainsi que les limites de ressources
et le nombre d'instances transmis par la variante.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Cette couche déclare des *variables* `startup_probe`/`liveness_probe` (chacune
utilisant en interne par défaut HTTP `/api/info`, un point de terminaison de l'API Wallabag
non authentifié), mais `Wallabag_CloudRun` et `Wallabag_GKE` transmettent toujours leurs propres
valeurs `startup_probe`/`liveness_probe` lors de l'appel de ce module — la valeur
effectivement appliquée sur les deux plateformes est donc celle par défaut de la **variante**, et non
la valeur interne de cette couche :

- **Sonde de démarrage** — **TCP** sur le port du conteneur (80) : il suffit donc que
  nginx soit à l'écoute, indépendamment de l'avancement du programme d'installation.
- **Sonde de vivacité** — **HTTP `GET /`**. Wallabag redirige une requête non authentifiée
  vers `/login` (HTTP 302), ce que la sémantique des sondes de Cloud Run comme de Kubernetes
  considère comme une réponse valide (tout code 2xx–3xx).

---

## 8. Stockage d'objets {#8-object-storage}

Cette couche ne déclare **pas** son propre bucket de stockage (la sortie `storage_buckets`
vaut `[]`) et ne renseigne pas `gcs_volumes` par défaut. Wallabag conserve l'ensemble de
son contenu — articles enregistrés, étiquettes, utilisateurs, annotations — dans MySQL ; il ne dispose d'aucun
répertoire de données sur le système de fichiers nécessitant de la persistance. Le bucket GCS générique `data`
mentionné dans les guides des plateformes provient de la valeur par défaut `storage_buckets` propre au module applicatif,
au niveau du socle, et non de cette couche ; il n'est pas
monté dans le conteneur à moins que `gcs_volumes` ne soit renseigné explicitement.

---

Pour la configuration propre à Wallabag destinée aux utilisateurs (variables par groupe,
sorties et manière d'explorer chaque service depuis la Console et la CLI), consultez les
guides des plateformes : **[Wallabag_GKE](Wallabag_GKE.md)** et
**[Wallabag_CloudRun](Wallabag_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Wallabag sur GKE Autopilot](Wallabag_GKE.md) — cette configuration déployée sur GKE.
