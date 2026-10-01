---
title: "OpenEMR Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module OpenEMR — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenEMR_Common.md @ 3055034 sha256:b0cb3102a7fc -->

# OpenEMR Common — Configuration applicative partagée {#openemr-common--shared-application-configuration}

`OpenEMR_Common` est la **couche applicative partagée** d'OpenEMR. Elle n'est pas déployée
seule ; elle fournit la configuration propre à OpenEMR sur laquelle reposent à la fois
[OpenEMR_GKE](OpenEMR_GKE.md) et [OpenEMR_CloudRun](OpenEMR_CloudRun.md), afin que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement OpenEMR, consultez les guides
de plateforme ([OpenEMR_GKE](OpenEMR_GKE.md), [OpenEMR_CloudRun](OpenEMR_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par OpenEMR_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur d'OpenEMR (`OE_PASS`) et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une image Alpine 3.20 personnalisée avec Apache, PHP 8.3 FPM et le code source d'OpenEMR | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` qui crée la base de données MySQL et l'utilisateur, puis accorde les privilèges | Sortie `initialization_jobs` |
| Initialisation NFS | Définit le job `nfs-init` qui prépare l'arborescence du répertoire `sites/` et restaure éventuellement une sauvegarde | Sortie `initialization_jobs` |
| Installation du schéma | Définit le job `openemr-install` qui exécute `auto_configure.php` en mode autorité pour installer le schéma de la base de données et écrire `$config=1` sur le NFS | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare aucun bucket GCS par défaut — le NFS couvre le stockage des documents des patients | La sortie `storage_buckets` vaut toujours `[]` |
| Paramètres de base | Définit l'environnement de base d'OpenEMR (port MySQL, utilisateur administrateur, stockage des sessions dans Redis, désactivation du mode swarm, aucun accès root à la base de données) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage (TCP) et de vivacité (page de connexion HTTP) | §Observabilité dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe de l'administrateur d'OpenEMR est généré automatiquement sous la forme
d'une chaîne alphanumérique de 20 caractères et stocké en tant que secret Secret Manager —
il n'est jamais défini en clair. Récupérez-le après le déploiement :

```bash
# The secret ID is reported in the admin_password_secret_id deployment output.
# List secrets filtered by the resource prefix and retrieve the value:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest \
  --secret=<admin-password-secret-id> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans la sortie de déploiement `database_password_secret`
(injecté sous la forme `MYSQL_PASS`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

OpenEMR nécessite **MySQL 8.0** ; le moteur est imposé et PostgreSQL n'est pas pris en
charge. Lors du premier déploiement, trois jobs ponctuels s'exécutent :

1. **`nfs-init`** — monte le partage NFS et crée l'arborescence du répertoire `sites/`.
   Si `BACKUP_FILEID` est défini (en renseignant `backup_uri` dans le module de
   plateforme), il télécharge et extrait la sauvegarde depuis GCS ou Google Drive, puis
   met à jour `sqlconf.php` avec les identifiants actuels de la base de données.

2. **`db-init`** — se connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente
   la base de données et l'utilisateur d'OpenEMR, puis accorde à cet utilisateur tous les
   privilèges.

3. **`openemr-install`** — s'exécute après les deux premiers sur les deux plateformes. Il
   lance le conteneur OpenEMR en mode `K8S=admin`, qui exécute `auto_configure.php` pour
   installer le schéma de la base de données et créer le compte administrateur, puis écrit
   `$config=1` dans `sqlconf.php` sur le NFS et se termine. Le conteneur du service
   principal attend `$config=1` avant de démarrer Apache, de sorte qu'il ignore
   l'installateur à chaque démarrage ultérieur.

Tous les jobs sont idempotents et peuvent être réexécutés sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`OpenEMR_Common` établit l'environnement de base d'OpenEMR afin que l'application démarre
correctement dès le premier lancement :

- **Port MySQL** — `MYSQL_PORT=3306` est toujours défini.
- **Utilisateur administrateur** — `OE_USER=admin` définit le nom du compte administrateur
  par défaut utilisé par `auto_configure.php`. Le mot de passe provient du secret
  Secret Manager `OE_PASS`.
- **Configuration automatique** — `MANUAL_SETUP=no` active le chemin d'installation piloté
  par `auto_configure.php`. Ne le remplacez pas.
- **Mode instance unique** — `SWARM_MODE=no` désactive le mécanisme de coordination par
  verrous de fichiers entre plusieurs instances. Dans Kubernetes, la variable
  d'environnement `K8S=yes` fournit à la place le chemin de démarrage approprié.
- **Stockage des sessions dans Redis** — `ENABLE_REDIS`, `REDIS_SERVER` et `REDIS_PORT`
  sont définis à partir des variables de plateforme `enable_redis`, `redis_host` et
  `redis_port`. Lorsque `redis_host` est vide, `REDIS_SERVER=$(NFS_SERVER_IP)` est utilisé
  comme valeur provisoire que `openemr.sh` remplace par l'adresse IP réelle du serveur NFS
  au démarrage du conteneur.
- **Aucun accès root à la base de données** — `MYSQL_ROOT_PASS=BLANK` indique à OpenEMR
  de ne pas tenter d'authentification root sur la base de données. Cloud SQL Auth Proxy
  gère tous les accès à MySQL.

Ajustements propres à chaque plateforme :

- **GKE** injecte en plus `K8S=yes` dans le pod principal, ce qui indique à `openemr.sh`
  d'utiliser le chemin de démarrage adapté à Kubernetes (en évitant les opérations
  `chown` récursives et lentes qui provoqueraient des dépassements de délai au démarrage).
- **Cloud Run** ne définit pas `K8S`, si bien que `openemr.sh` suit son chemin de
  démarrage hors Kubernetes.

Sur les deux plateformes, le conteneur principal démarre un serveur web PHP intégré
temporaire qui répond HTTP 200 sur le chemin de la sonde pendant la configuration, puis
l'arrête avant qu'Apache ne se lie au même port.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut sont adaptées à l'installation d'OpenEMR au premier démarrage, qui
dure plusieurs minutes :

- **Sonde de démarrage — TCP.** Une vérification d'ouverture du port TCP 80 avec un seuil
  de 12 échecs à intervalles de 10 secondes laisse jusqu'à 120 secondes au conteneur pour
  démarrer. TCP est utilisé car l'application peut être en phase d'installation alors
  qu'Apache n'accepte pas encore les connexions HTTP.

  Lors d'un premier déploiement avec une base de données volumineuse, envisagez de porter
  `failure_threshold` à 30 ou plus pour laisser le temps à l'installation complète du
  schéma.

- **Sonde de vivacité — HTTP `GET /interface/login/login.php`.** La page de connexion
  d'OpenEMR ne renvoie HTTP 200 que lorsque Apache, PHP-FPM et la connexion à la base de
  données MySQL sont tous pleinement opérationnels. Un seuil de 10 échecs à intervalles
  de 30 secondes laisse jusqu'à 5 minutes de rétablissement avant le redémarrage du
  conteneur.

Les deux comportements de sonde sont identiques sur GKE et Cloud Run, car
OpenEMR/Apache n'émet pas de redirections HTTP→HTTPS qui casseraient les sondes HTTP
(contrairement aux applications PHP placées derrière des équilibreurs de charge qui
terminent le TLS).

---

## 6. Image de conteneur {#6-container-image}

`OpenEMR_Common` construit une image personnalisée à partir de son `Dockerfile` plutôt que
d'utiliser une image préconstruite. L'image repose sur **Alpine 3.20** et comprend :

- Apache 2 avec PHP 8.3 FPM et toutes les extensions requises par OpenEMR (`pdo_mysql`,
  `mysqli`, `redis`, `gd`, `soap`, `ldap`, `opcache`, `apcu`, entre autres)
- Le code source d'OpenEMR cloné depuis la branche `rel-704`, avec les dépendances
  Composer installées et les ressources frontend construites avec npm
- Le script d'orchestration du démarrage `openemr.sh`, qui gère la correspondance des
  variables, les mises à niveau tenant compte des versions, le serveur temporaire de
  sonde de santé, l'installation du schéma et le démarrage d'Apache/PHP-FPM
- Les scripts de mise à niveau (`fsupgrade-1.sh` à `fsupgrade-7.sh`) couvrant les chemins
  de mise à niveau d'OpenEMR 5.0.1 jusqu'à la version actuelle
- Des utilitaires de récupération : `/root/unlock_admin.sh` (réactive un compte
  administrateur verrouillé) et `/root/devtoolsLibrary.source` (utilitaires de
  sauvegarde, de restauration et multi-sites)

L'image est construite par Cloud Build et poussée vers Artifact Registry à chaque
déploiement. Explorez l'image construite :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/<project>/<repository> \
  --project "$PROJECT"
```

---

## 7. Répertoire NFS `sites/` et documents des patients {#7-nfs-sites-directory-and-patient-documents}

Le partage NFS monté sur `/var/www/localhost/htdocs/openemr/sites` est le composant de
stockage persistant le plus critique. Il contient :

- `sites/default/sqlconf.php` — signale la fin de l'installation (`$config=1`). Le pod
  principal vérifie ce fichier au démarrage et attend qu'il apparaisse avant de démarrer
  Apache.
- `sites/default/documents/` — fichiers et pièces jointes téléversés pour les patients
- `sites/default/edi/`, `sites/default/era/` — données de facturation électronique
- `sites/default/onsite_portal_documents/` — documents du portail patient
- Les caches de modèles Twig et Smarty

Comme ce répertoire est partagé entre tous les réplicas via le NFS, les documents des
patients téléversés sur un pod sont immédiatement visibles par tous les autres. Listez les
instances NFS :

```bash
gcloud filestore instances list --project "$PROJECT"
```

---

Pour la configuration d'OpenEMR propre à l'utilisateur (variables par groupe, sorties et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides de
plateforme : **[OpenEMR_GKE](OpenEMR_GKE.md)** et **[OpenEMR_CloudRun](OpenEMR_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OpenEMR sur Google Cloud Run](OpenEMR_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OpenEMR sur GKE Autopilot](OpenEMR_GKE.md) — cette configuration déployée sur GKE.
