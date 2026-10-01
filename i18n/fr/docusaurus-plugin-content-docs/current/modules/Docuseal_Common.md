---
title: "Docuseal Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Docuseal — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Docuseal_Common.md @ 3055034 sha256:7b62d771bd19 -->

# Docuseal Common — Configuration applicative partagée {#docuseal-common--shared-application-configuration}

`Docuseal_Common` est la **couche applicative partagée** de DocuSeal. Elle n'est pas
déployée seule ; elle fournit la configuration propre à DocuSeal sur laquelle
s'appuient à la fois [Docuseal_GKE](Docuseal_GKE.md) et
[Docuseal_CloudRun](Docuseal_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où c'est important. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

DocuSeal est une plateforme open source de signature de documents (une alternative
auto-hébergée à DocuSign) construite sur **Ruby on Rails** et servie par **Puma**.
L'image amont `docuseal/docuseal` sert l'ensemble de l'application sur le
**port 3000** et exécute ses migrations ActiveRecord au démarrage ; un seul conteneur
suffit donc — il n'y a pas de service distinct de worker, de file d'attente ou de
migration.

Pour l'infrastructure qui provisionne et exécute effectivement DocuSeal, consultez
les guides des plateformes ([Docuseal_GKE](Docuseal_GKE.md),
[Docuseal_CloudRun](Docuseal_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Docuseal_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère un `SECRET_KEY_BASE` Rails stable (64 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une **enveloppe personnalisée légère** `FROM docuseal/docuseal:<version>` avec un point d'entrée cloud ; mise en miroir dans Artifact Registry via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Initialisation de la base | Définit le job du premier déploiement (`db-init`) qui crée le rôle, la base de données et les autorisations | Sortie `initialization_jobs` |
| Documents persistants | Déclare `WORKDIR = /data/docuseal` pour les documents et pièces jointes téléversés, adossé à NFS (Cloud Run) ou à un PVC bloc (GKE) | Section Persistance des guides des plateformes |
| Stockage objet | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres essentiels | Définit l'environnement DocuSeal de base : port 3000, journalisation sur stdout, répertoire de travail persistant | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage / vivacité / disponibilité ciblant `/up` | Section Observabilité des guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`SECRET_KEY_BASE`** — une chaîne aléatoire de 64 caractères générée une seule
  fois et stockée sous `secret-<resource_prefix>-<app>-secret-key-base`. Rails
  l'utilise pour signer et vérifier tous les cookies de session et les autres valeurs
  signées / chiffrées. S'il n'est pas défini, DocuSeal génère une clé éphémère à
  chaque démarrage, ce qui invalide toutes les sessions actives à chaque redémarrage ;
  épingler une valeur durable dans Secret Manager maintient la validité des sessions
  et cookies signés d'un redémarrage et d'une révision à l'autre. Le faire tourner
  après le premier démarrage déconnecte tous les utilisateurs et invalide tous les
  jetons signés en circulation.

Récupérez le secret après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

DocuSeal nécessite **PostgreSQL 15** (`database_type = "POSTGRES_15"`) ; le moteur est
fixé, et MySQL ou d'autres moteurs ne sont pas pris en charge. DocuSeal lit une
unique `DATABASE_URL`, que le point d'entrée cloud compose à l'exécution à partir des
variables `DB_*` injectées par le socle (voir §4).

Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Attend que PostgreSQL soit joignable,
2. Crée (ou reconfigure) le rôle d'application `docuseal` avec `LOGIN CREATEDB`
   et le mot de passe généré,
3. Crée la base de données `docuseal` si elle n'existe pas encore (propriété de
   `postgres`, car la connexion `postgres` de Cloud SQL ne peut pas faire `SET ROLE`
   vers les rôles d'application),
4. Accorde au rôle d'application tous les privilèges sur la base et — comme
   PostgreSQL 15 n'accorde plus `CREATE` sur `public` par défaut — `GRANT ALL ON
   SCHEMA public`, puis réattribue la propriété de `public` au rôle de l'application
   afin que ses migrations puissent créer des tables,
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter afin que le pod du Job GKE se
   termine.

Il n'y a **pas de job de migration distinct** — DocuSeal exécute automatiquement ses
propres migrations ActiveRecord au démarrage sous le rôle de l'application. Le job
`db-init` peut être relancé sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une **enveloppe légère** `FROM docuseal/docuseal:<version>`
(construite via Cloud Build et mise en miroir dans Artifact Registry). Elle ajoute un point
d'entrée cloud en `sh` POSIX qui s'exécute avant le démarrage de Puma, puis `exec`
tel quel la propre commande Puma de l'image
(`/app/bin/bundle exec puma -C /app/config/puma.rb`) :

- **Compose `DATABASE_URL`** à partir des variables `DB_*` injectées par le socle. Le
  parseur d'URI de Ruby **ne sait pas** analyser le DSN de socket Unix de Cloud SQL
  (les deux-points du chemin du socket cassent l'analyse de l'URL) ; le module est
  donc déployé avec `enable_cloudsql_volume = false` et le point d'entrée se
  différencie selon `DB_HOST` :
  - `127.0.0.1` / `localhost` (boucle locale du sidecar Auth Proxy sur GKE) → TCP
    simple, sans SSL (le proxy assure le TLS vers Cloud SQL),
  - sinon une IP privée (Cloud Run) → TCP avec `?sslmode=require` (Cloud SQL
    refuse le TCP non chiffré sur IP privée).
  Les composants des identifiants sont encodés pour URL avec Ruby avant d'être placés
  dans l'URL.
- **Build via un ARG de build propre à l'application.** Le Dockerfile utilise
  `ARG DOCUSEAL_VERSION` (et non le générique `APP_VERSION`, que le socle injecte et
  qui serait sinon écrasé par `latest`). `docuseal/docuseal:latest` est un tag publié
  valide ; `latest` correspond donc à lui-même et toute version explicite est
  transmise telle quelle.
- **Prépare le répertoire de travail persistant** — `WORKDIR = /data/docuseal` pour
  les documents et pièces jointes téléversés, créé au démarrage et adossé à NFS
  (Cloud Run) ou à un PVC (GKE).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Docuseal_Common` établit l'environnement DocuSeal de base afin que l'application
démarre correctement dès le premier lancement :

- **Port** — `container_port = 3000`. DocuSeal sert via Puma sur 3000. `PORT` n'est
  **pas** défini ici : Cloud Run réserve et injecte automatiquement `PORT` (et refuse
  une valeur fournie par l'utilisateur), et sur GKE Puma se replie sur la valeur par
  défaut de sa configuration, 3000 — qui correspond à `container_port` ; laisser
  `PORT` non défini fonctionne donc sur les deux plateformes.
- **Journalisation** — `RAILS_LOG_TO_STDOUT = "true"` afin que Cloud Logging capture
  le journal Rails.
- **Répertoire de travail** — `WORKDIR = "/data/docuseal"`, le volume persistant où
  sont écrits les documents et pièces jointes téléversés.
- **Pas de Redis** — DocuSeal utilise une file d'attente / un cache adossés à
  PostgreSQL (`VALKEY_URL` vide) ; aucun point de terminaison Redis n'est donc injecté
  et `enable_redis` vaut `false` par défaut.
- **Environnement secret** — `SECRET_KEY_BASE` est injecté depuis Secret Manager
  (voir §2).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut de démarrage, de vivacité et de disponibilité ciblent toutes
**`/up`** — le point de terminaison de santé intégré de Rails, qui renvoie un `200`
non authentifié dès que le processus Rails est prêt. Une fenêtre de démarrage
généreuse (délai initial de 60 secondes, 30 échecs sur une période de 15 secondes)
laisse le temps aux migrations ActiveRecord exécutées au premier démarrage.

Comme les sondes s'exécutent sans authentification (frontal Cloud Run / kubelet GKE),
elles doivent viser `/up` plutôt qu'une page authentifiée de DocuSeal, faute de quoi
la révision / le pod ne deviendrait jamais Ready.

---

## 7. Persistance et stockage objet {#7-persistence-and-object-storage}

DocuSeal stocke les documents et pièces jointes téléversés sur le **système de
fichiers local**, sous `/data/docuseal` ; il lui faut donc un volume persistant
plutôt qu'un stockage objet :

- **Cloud Run** adosse `/data/docuseal` au volume **NFS** partagé
  (`enable_nfs = true`, `nfs_mount_path = /data/docuseal`).
- **GKE** l'adosse à **NFS** par défaut, ou à un **PVC bloc** par pod lorsque
  `stateful_pvc_enabled = true` (ce qui sélectionne automatiquement un StatefulSet),
  monté sur `/data/docuseal`.

`Docuseal_Common` déclare en outre un bucket **Cloud Storage** (suffixe de nom
`storage`, classe STANDARD, `public_access_prevention = enforced`) que le socle
provisionne et auquel il donne accès à la charge de travail ; le stockage de
documents de DocuSeal utilise par défaut le volume persistant ci-dessus plutôt que ce
bucket. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à DocuSeal destinée aux utilisateurs (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Docuseal_GKE](Docuseal_GKE.md)** et
**[Docuseal_CloudRun](Docuseal_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Docuseal sur GKE Autopilot](Docuseal_GKE.md) — cette configuration déployée sur GKE.
