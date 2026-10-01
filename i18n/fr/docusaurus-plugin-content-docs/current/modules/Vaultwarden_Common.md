---
title: "Vaultwarden Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Vaultwarden — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Vaultwarden_Common.md @ 3055034 sha256:973a4f445321 -->

# Vaultwarden Common — Configuration applicative partagée {#vaultwarden-common--shared-application-configuration}

`Vaultwarden_Common` est la **couche applicative partagée** de Vaultwarden. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Vaultwarden sur laquelle
s'appuient à la fois [Vaultwarden_GKE](Vaultwarden_GKE.md) et
[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Vaultwarden, consultez
les guides des plateformes ([Vaultwarden_GKE](Vaultwarden_GKE.md),
[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Vaultwarden_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle `vaultwarden/server` et le Dockerfile qui l'encapsule ; effectue le build d'une image personnalisée via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Détecte si le moteur sélectionné est PostgreSQL ou MySQL et choisit en conséquence l'image de tâche `db-init` appropriée | Sortie `initialization_jobs` |
| Amorçage de la base de données | Définit la tâche du premier déploiement qui crée la base de données, l'utilisateur et les droits — idempotente, prend en charge PostgreSQL 15 et MySQL 8.0 | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `vaultwarden-attachments` | Sortie `storage_buckets` |
| Paramètres principaux | Transmet au socle le port du conteneur, les limites de ressources, le nombre d'instances et les variables d'environnement | Comportement de l'application dans les guides des plateformes |
| Vérifications de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/alive` | Observabilité dans les guides des plateformes |
| Aucun secret applicatif | Ne crée aucun secret Secret Manager — Vaultwarden gère lui-même son jeton d'administration et ses clés RSA dans le volume `/data` | Mentionné dans la section Sécurité des guides des plateformes |

---

## 2. Détection du moteur de base de données et amorçage {#2-database-engine-detection-and-bootstrap}

La **tâche d'amorçage `db-init`** de `Vaultwarden_Common` prend en charge
PostgreSQL 15 (par défaut) et MySQL 8.0 — le moteur est détecté à partir de la
variable `database_type` transmise par le module de plateforme :

| `database_type` | Image de la tâche d'initialisation | `db-init.sh` `DB_ENGINE` |
|---|---|---|
| `POSTGRES_15` (ou toute valeur non MySQL) | `postgres:15-alpine` | `postgres` |
| `MYSQL_8_0` (ou toute valeur commençant par `MYSQL`) | `mysql:8.0-debian` | `mysql` |

**Cette détection ne couvre que la tâche d'amorçage.** Le script `entrypoint.sh`
d'exécution, qui assemble la `DATABASE_URL` de Vaultwarden à partir des valeurs
injectées `DB_HOST`/`DB_USER`/
`DB_PASSWORD`/`DB_NAME`, n'a pas de branche `DB_ENGINE`/MySQL — il construit
inconditionnellement une URL `postgresql://`, quelle que soit la valeur de
`database_type`. Définir `database_type =
"MYSQL_8_0"` amorce correctement une base de données et un utilisateur MySQL, mais le
conteneur Vaultwarden en cours d'exécution tente ensuite une connexion au schéma
Postgres sur cet hôte MySQL et ne parvient pas à se connecter. `POSTGRES_15` est
aujourd'hui le seul moteur qui fonctionne de bout en bout.

Lors du premier déploiement, la tâche `db-init` s'exécute automatiquement et de
manière idempotente :

1. Crée la base de données Vaultwarden (si elle n'existe pas).
2. Crée l'utilisateur de l'application avec le mot de passe généré.
3. Accorde à l'utilisateur tous les privilèges sur cette base de données.

Une fois terminée, la tâche envoie une requête POST à `localhost:9091/quitquitquit`
pour arrêter proprement le sidecar Cloud SQL Auth Proxy. Inspectez directement la
base de données avec :

```bash
# For PostgreSQL:
gcloud sql connect <instance-name> --user=vaultwarden --project "$PROJECT"

# For MySQL:
gcloud sql connect <instance-name> --user=vaultwarden --database-version=MYSQL \
  --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 3. Image de conteneur {#3-container-image}

`Vaultwarden_Common` effectue le build d'une image d'encapsulation personnalisée à
partir du `Dockerfile` de son répertoire `scripts/`, en utilisant
`vaultwarden/server:<version>` comme image de base. Le build s'exécute via Cloud Build
et l'image obtenue est stockée dans Artifact Registry.

La variable `application_version` (par défaut `1.32.7`) est transmise comme argument
de build Docker (`APP_VERSION`), de sorte que la mise à niveau de Vaultwarden se
résume à la modification d'une seule variable.

Inspectez l'image déployée :

```bash
gcloud artifacts docker images list <registry-region>-docker.pkg.dev/<project>/<repo> \
  --project "$PROJECT"
```

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Vaultwarden_Common` assemble la configuration du conteneur afin que l'application
démarre correctement dès le premier lancement. L'encapsuleur propre à la plateforme
fusionne ensuite un petit ensemble de variables d'environnement supplémentaires avant
de transmettre la configuration complète au socle :

| Variable injectée par l'encapsuleur | Valeur | Rôle |
|---|---|---|
| `ROCKET_PORT` | `container_port` (par défaut `80`) | Port d'écoute HTTP Rocket de Vaultwarden |
| `SIGNUPS_ALLOWED` | `signups_allowed` (par défaut `false`) | Contrôle des inscriptions |
| `WEB_VAULT_ENABLED` | `web_vault_enabled` (par défaut `true`) | Activation de l'interface web |
| `DATA_FOLDER` | `/data` | Répertoire de données de Vaultwarden |
| `DOMAIN` | variable `domain` (uniquement si non vide) | URL publique pour WebAuthn, TOTP et les liens des e-mails |

Variables d'environnement par défaut incluses dans la transmission de
`Vaultwarden_Common` :

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `LOG_LEVEL` | `warn` | Niveau de détail des journaux |
| `SHOW_PASSWORD_HINT` | `false` | Désactive les indices de mot de passe en production |
| `SMTP_HOST` | `""` | Serveur SMTP (vide = e-mail désactivé) |
| `SMTP_PORT` | `587` | Port SMTP |
| `SMTP_FROM` | `vaultwarden@example.com` | Adresse de l'expéditeur |
| `SMTP_SSL` | `true` | Active STARTTLS |

**Aucun jeton d'administration n'est généré automatiquement.** Le panneau `/admin`,
à l'adresse `/admin`, est désactivé par défaut. Fournissez `ADMIN_TOKEN` via
`environment_variables` dans le module de plateforme pour l'activer. Utilisez une
valeur aléatoire robuste (par exemple `openssl rand -base64 48`).

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes de démarrage et d'activité ciblent toutes deux `/alive` — le point de
terminaison de santé léger dédié de Vaultwarden, qui renvoie `OK` lorsque le serveur
fonctionne. Vaultwarden, binaire Rust compilé, démarre en quelques secondes ; les
sondes utilisent donc un délai initial court de 30 s.

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | `/alive` | 30 s | 5 s | 10 s | 6 |
| Activité | `/alive` | 30 s | 5 s | 30 s | 3 |

Les variantes GKE et Cloud Run utilisent toutes deux des sondes HTTP sur `/alive`.
Contrairement à certaines applications PHP ou Java, Vaultwarden ne redirige pas le
trafic HTTP des vérifications de santé ; aucun contournement par sonde TCP n'est donc
nécessaire.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** suffixé `vaultwarden-attachments` est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. Ce bucket est destiné aux pièces jointes de Vaultwarden lorsqu'un
stockage reposant sur GCS est utilisé. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Aucun secret Secret Manager de niveau applicatif n'est créé ici. Le mot de passe de
la base de données est généré et géré par le socle ; le nom de son secret figure dans
les sorties du déploiement de la plateforme (`database_password_secret`). Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

Pour la configuration propre à Vaultwarden destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes :
**[Vaultwarden_GKE](Vaultwarden_GKE.md)** et
**[Vaultwarden_CloudRun](Vaultwarden_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Vaultwarden sur GKE Autopilot](Vaultwarden_GKE.md) — cette configuration déployée sur GKE.
