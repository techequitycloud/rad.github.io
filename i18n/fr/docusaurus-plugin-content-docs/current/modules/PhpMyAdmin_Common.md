---
title: "PhpMyAdmin Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module PhpMyAdmin — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PhpMyAdmin_Common.md @ 3055034 sha256:bab76f569986 -->

# PhpMyAdmin Common — Configuration applicative partagée {#phpmyadmin-common--shared-application-configuration}

`PhpMyAdmin_Common` est la **couche applicative partagée** de phpMyAdmin. Elle n'est
pas déployée seule ; elle fournit la configuration propre à phpMyAdmin sur laquelle
s'appuient [PhpMyAdmin_GKE](PhpMyAdmin_GKE.md) et
[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux
ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

phpMyAdmin est atypique parmi les applications de ce dépôt : c'est un client web
PHP + Apache **entièrement sans état** pour administrer des bases de données
MySQL/MariaDB. Il n'a **ni base de données propre, ni secrets, ni Redis, ni stockage
objet, ni volume persistant**. Le serveur MySQL cible est choisi entièrement par des
variables d'environnement lues par l'image standard au démarrage du conteneur. En
conséquence, cette couche Common est volontairement minimale — elle sert
principalement à épingler le tag de l'image et à décrire le conteneur.

Pour l'infrastructure qui provisionne et exécute réellement phpMyAdmin, consultez les
guides des plateformes ([PhpMyAdmin_GKE](PhpMyAdmin_GKE.md),
[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par PhpMyAdmin_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Un **build personnalisé** minimal `FROM phpmyadmin/phpmyadmin`, dupliqué dans Artifact Registry, avec le tag de base épinglé via un ARG de build propre à l'application | Output `container_image` du déploiement de la plateforme |
| Épinglage de la version de l'image | Fait correspondre `application_version = "latest"` à un tag éprouvé (`5.2.2`) afin que le build ne référence jamais un tag inexistant | `container_build_config.build_args.PHPMYADMIN_VERSION` |
| Moteur de base de données | Fixe **`database_type = "NONE"`** — phpMyAdmin n'a pas de base de données propre | §Base de données dans les guides des plateformes |
| Secrets cryptographiques | **Aucun** — `secret_ids` et `secret_values` sont des maps vides | n/a |
| Stockage objet | **Aucun** — `storage_buckets` est une liste vide | n/a |
| Initialisation de la base de données | **Aucune** — `initialization_jobs` est une liste vide | n/a |
| Port du conteneur | Fixe le port **80** (Apache `apache2-foreground`) | §Réseau dans les guides des plateformes |
| Paramètres principaux | Expose les variables d'environnement de cible MySQL `PMA_HOST` / `PMA_PORT` / `PMA_ARBITRARY` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit des sondes par défaut de démarrage/vivacité/disponibilité ciblant `/` | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

phpMyAdmin est livré sous forme de **build personnalisé minimal** plutôt que d'image
précompilée brute. Le `Dockerfile` est un wrapper de deux lignes :

```dockerfile
ARG PHPMYADMIN_VERSION=5.2.2
FROM phpmyadmin/phpmyadmin:${PHPMYADMIN_VERSION}
EXPOSE 80
```

Ce build existe **uniquement** pour dupliquer l'image amont `phpmyadmin/phpmyadmin`
dans Artifact Registry et épingler le tag de base — il n'y a **ni fichier de
configuration à l'exécution, ni point d'entrée personnalisé**. L'image standard est
entièrement pilotée par l'environnement et hérite sans modification de son propre
`ENTRYPOINT` (`/docker-entrypoint.sh`) et de son `CMD` (`apache2-foreground`, à l'écoute
sur le port 80).

L'ARG de build s'appelle délibérément **`PHPMYADMIN_VERSION`**, et non `APP_VERSION`,
le nom générique. Le socle injecte `APP_VERSION = application_version` dans les
`build_args` de chaque build personnalisé et *l'emporte lors de la fusion* — un
Dockerfile qui dériverait son tag de base de `APP_VERSION` serait donc forcé sur
`latest` (que `phpmyadmin/phpmyadmin:latest` publie bien, mais la convention de la
campagne est d'épingler). `PhpMyAdmin_Common` définit `PHPMYADMIN_VERSION` à partir de
la correspondance `var.application_version == "latest" ? "5.2.2" : var.application_version`,
de sorte qu'une demande `latest` se résout en le tag éprouvé épinglé, tandis qu'une
version explicite (par ex. `5.2.2`) est transmise telle quelle.

Inspecter l'image déployée :

```bash
# CloudRun:
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
# List the mirrored image in Artifact Registry:
gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>/phpmyadmin
```

---

## 3. Ni secrets, ni base de données, ni stockage {#3-no-secrets-no-database-no-storage}

Contrairement à la plupart des applications de ce dépôt, phpMyAdmin ne déclare
**aucune** des ressources avec état habituelles :

- **`secret_ids` / `secret_values` sont vides.** phpMyAdmin ne détient aucun secret
  applicatif propre. Les utilisateurs s'authentifient avec les **identifiants propres
  du serveur MySQL/MariaDB cible** sur la page de connexion de phpMyAdmin
  (authentification par cookie) ; phpMyAdmin ne stocke jamais ces identifiants. Comme
  aucun secret n'est généré, il n'y a rien à faire tourner et rien qui puisse se
  corrompre lors d'un redéploiement.
- **`database_type = "NONE"`.** Aucune instance Cloud SQL n'est provisionnée pour
  phpMyAdmin lui-même. (phpMyAdmin *se connecte à* un serveur MySQL, mais ce serveur
  est externe à ce module — il n'est pas créé ici.) La variante GKE l'impose par un
  garde-fou de validation au moment du plan.
- **`initialization_jobs = []`.** Il n'y a aucun schéma à créer ; aucun job `db-init`
  ne s'exécute donc. Le premier déploiement ne comporte pas d'étape de migration.
- **`storage_buckets = []` et pas de NFS.** phpMyAdmin est sans état — l'état de session
  réside dans un cookie de courte durée, et rien n'est écrit sur disque qui doive
  survivre à un redémarrage.

Il n'existe donc aucune ressource `gcloud secrets` ou `gcloud sql` appartenant à ce
module à récupérer — une empreinte délibérément réduite.

---

## 4. Choix de la cible MySQL (la seule vraie configuration) {#4-mysql-target-selection-the-only-real-configuration}

phpMyAdmin détermine le serveur de base de données à administrer uniquement à partir
de trois variables d'environnement, lues par l'image standard au démarrage du
conteneur (sans rebuild ni fichier de configuration) :

- **`PMA_ARBITRARY`** — avec `"1"` (la valeur par défaut), la page de connexion affiche
  un **champ de saisie du serveur** afin que les utilisateurs puissent saisir
  *n'importe quel* hôte MySQL/MariaDB joignable. Avec `"0"`, les connexions sont
  restreintes au `PMA_HOST` fixe.
- **`PMA_HOST`** — nom d'hôte ou IP d'un serveur cible fixe. Vide par défaut (mode
  arbitraire). Indiquez l'IP privée Cloud SQL de la plateforme ou tout hôte MySQL
  joignable pour épingler un seul serveur.
- **`PMA_PORT`** — port TCP du serveur cible ; par défaut le port MySQL standard
  `3306`.

Elles apparaissent sous la forme des variables `pma_arbitrary` / `pma_host` /
`pma_port` sur les deux variantes de plateforme et constituent l'essentiel de ce que
configure un opérateur. Consultez les guides des plateformes pour leur correspondance
avec l'interface de déploiement.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut de démarrage, de vivacité et de disponibilité ciblent toutes
**`/`** en HTTP — Apache y sert la page de connexion de phpMyAdmin et renvoie `200` dès
que l'environnement PHP est prêt ; aucun point de terminaison de santé propre à
l'application n'est donc nécessaire. Comme il n'y a pas de migration de base de
données au démarrage, phpMyAdmin est rapidement prêt (quelques secondes) ; la large
fenêtre de démarrage n'est qu'une marge de sécurité.

---

Pour la configuration propre à phpMyAdmin destinée aux utilisateurs (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[PhpMyAdmin_GKE](PhpMyAdmin_GKE.md)** et
**[PhpMyAdmin_CloudRun](PhpMyAdmin_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PhpMyAdmin sur Google Cloud Run](PhpMyAdmin_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [PhpMyAdmin sur GKE Autopilot](PhpMyAdmin_GKE.md) — cette configuration déployée sur GKE.
