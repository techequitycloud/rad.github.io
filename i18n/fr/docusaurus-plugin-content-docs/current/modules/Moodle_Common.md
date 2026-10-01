---
title: "Moodle Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Moodle — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Moodle_Common.md @ 3055034 sha256:ed50c8e7087a -->

# Moodle Common — Configuration applicative partagée {#moodle-common--shared-application-configuration}

`Moodle_Common` est la **couche applicative partagée** de Moodle. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Moodle sur laquelle s'appuient
[Moodle_GKE](Moodle_GKE.md) et [Moodle_CloudRun](Moodle_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune
entrée propre dans l'interface de déploiement —, mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Moodle, consultez les
guides des plateformes ([Moodle_GKE](Moodle_GKE.md), [Moodle_CloudRun](Moodle_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Moodle_Common | Où cela apparaît |
|---|---|---|
| Identifiant cron | Génère le mot de passe cron de Moodle (32 caractères) et le stocke dans **Secret Manager** | Intégré à l'URL de la tâche Cloud Scheduler provisionnée automatiquement |
| Identifiant SMTP | Génère un mot de passe SMTP initial (24 caractères) et le stocke dans **Secret Manager** | Récupéré et remplacé via Secret Manager après le déploiement |
| Image de conteneur | Construit une image PHP 8.3/Apache entièrement personnalisée à partir d'Ubuntu 24.04 | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Extension PostgreSQL | Active `pg_trgm` pour la recherche en texte intégral de Moodle | Appliquée par la tâche `db-init` au premier déploiement |
| Amorçage de la base de données | Définit la tâche `db-init` qui crée la base de données, l'utilisateur et l'extension | `initialization_jobs` dans les guides des plateformes |
| Initialisation NFS | Définit la tâche `nfs-init` qui crée les sous-répertoires de `moodledata` avec la bonne propriété | Output `nfs_setup_job` des guides des plateformes |
| Paramètres de base | Définit le port 8080, la construction de l'image personnalisée et l'environnement Moodle de base | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit `/health.php` comme point de terminaison de sonde par défaut, au démarrage comme pour la vivacité | Section Observabilité des guides des plateformes |

---

## 2. Identifiants dans Secret Manager {#2-credentials-in-secret-manager}

Deux identifiants sont générés automatiquement et stockés sous forme de secrets Secret
Manager — ils ne sont jamais saisis en clair. Récupérez-les après le déploiement :

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~moodle"
# Read a specific secret:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

| Secret | Rôle | Action requise |
|---|---|---|
| `<prefix>-cron-password` | Authentifie la tâche cron Cloud Scheduler provisionnée automatiquement qui cible `/admin/cron.php` | Aucune — intégré automatiquement à l'URL de la tâche du planificateur |
| `<prefix>-smtp-password` | Identifiant SMTP initial injecté sous la forme `MOODLE_SMTP_PASSWORD` | Remplacez la valeur générée par votre véritable identifiant SMTP après le déploiement |

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Moodle requiert **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en
charge. Lors du premier déploiement, une tâche ponctuelle `db-init` se connecte à
Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée l'utilisateur applicatif Moodle avec les privilèges `CREATEDB`,
2. crée la base de données Moodle avec l'encodage UTF-8 et la locale `en_US.UTF-8`,
3. accorde à l'utilisateur tous les privilèges sur la base de données et le schéma public,
4. active l'extension `pg_trgm` en tant que superutilisateur (requise pour la recherche en texte intégral de Moodle).

La tâche peut être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Paramètres de base de l'application {#4-core-application-settings}

`Moodle_Common` établit l'environnement Moodle de base afin que l'application démarre
correctement dès le premier lancement :

- **Port de conteneur 8080** — Apache est configuré pour écouter sur `$PORT` (8080 par
  défaut), ce qui correspond à la sonde de santé et à la configuration d'entrée de la
  plateforme.
- **Construction personnalisée à partir d'Ubuntu 24.04** — PHP 8.3 avec toutes les
  extensions requises par Moodle (`gd`, `pgsql`, `curl`, `intl`, `mbstring`, `zip`,
  `soap`, `ldap`, `redis`) est compilé à partir de zéro. Il n'existe pas d'image Docker
  Moodle en amont ; la construction est gérée par Cloud Build à l'aide du `Dockerfile`
  situé dans `Moodle_Common/scripts/`.
- **Paramètres SMTP** — des variables d'environnement SMTP par défaut
  (`MOODLE_SMTP_HOST`, `MOODLE_SMTP_PORT`, `MOODLE_SMTP_USER`, etc.) sont injectées
  automatiquement. Remplacez-les via `environment_variables` dans le module de la
  plateforme et remplacez le secret `MOODLE_SMTP_PASSWORD` généré par un véritable
  identifiant.
- **Prise en charge des sessions Redis** — lorsque `MOODLE_REDIS_ENABLED = "true"`,
  `config.php` configure Moodle pour utiliser Redis comme stockage des sessions
  (`\core\session\redis`).
- **Dérivation de `wwwroot`** — `config.php` résout `wwwroot` à partir de `APP_URL`,
  avec en repli `CLOUDRUN_SERVICE_URL` (Cloud Run) ou `GKE_SERVICE_URL` (GKE). Sur Cloud
  Run, `APP_URL` est défini à partir de l'URL de service prévue avant le déploiement.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent `/health.php`, un point de terminaison minimal intégré à
l'image de conteneur qui renvoie HTTP 200 avec le corps `"OK"` dès que PHP est
opérationnel. C'est un indicateur plus précis de la disponibilité de Moodle que la
sonde d'une page complète, car :

- `/health.php` renvoie 200 immédiatement après le démarrage de PHP, que l'amorçage
  complet de Moodle soit terminé ou non — ce qui fournit des signaux de vivacité
  rapides.
- La sonde de démarrage utilise une fenêtre de 10 minutes (`failure_threshold = 20`,
  `period_seconds = 30`) pour laisser le temps à la création du schéma et à
  l'enregistrement des plugins au premier démarrage sur une base de données vierge.

**GKE et Cloud Run utilisent tous deux des sondes HTTP** sur `/health.php`.
Contrairement à certains déploiements PHP où Apache émet une redirection HTTP→HTTPS qui
casse les sondes Cloud Run de type HTTP, la configuration Apache de Moodle écoute sur le
port 8080 sans redirection ; les sondes HTTP fonctionnent donc de manière fiable sur les
deux plateformes.

---

## 6. Initialisation NFS et stockage d'objets {#6-nfs-initialisation-and-object-storage}

**NFS est obligatoire** — le répertoire Moodle `moodledata` doit être un système de
fichiers partagé, accessible en écriture depuis toutes les instances ou tous les pods.
Avant le démarrage de l'application, la tâche `nfs-init` crée quatre sous-répertoires
requis sur le partage NFS :

| Répertoire | Rôle |
|---|---|
| `filedir` | Fichiers téléversés et contenu des cours |
| `temp` | Fichiers temporaires pendant le traitement |
| `cache` | Données du cache applicatif |
| `localcache` | Cache local propre à chaque instance |

Tous les répertoires appartiennent à l'UID/GID 33 (`www-data`) avec les permissions
`2770` (setgid, afin que les nouveaux fichiers héritent du groupe). Sans cette
configuration, Moodle ne parvient pas à écrire au premier démarrage.

Un bucket de données Cloud Storage supplémentaire est toujours provisionné via le
module de la plateforme. Il est disponible pour les sauvegardes, les montages GCS Fuse
de plugins ou de thèmes, ou d'autres besoins de stockage. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Moodle et destinée aux utilisateurs (variables par
groupe, outputs et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes :
**[Moodle_GKE](Moodle_GKE.md)** et **[Moodle_CloudRun](Moodle_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Moodle sur Google Cloud Run](Moodle_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Moodle sur GKE Autopilot](Moodle_GKE.md) — cette configuration déployée sur GKE.
