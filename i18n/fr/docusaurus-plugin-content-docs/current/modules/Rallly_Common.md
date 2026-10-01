---
title: "Rallly Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Rallly — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Rallly_Common.md @ 3055034 sha256:5a0b8531758f -->

# Rallly Common — Configuration applicative partagée {#rallly-common--shared-application-configuration}

`Rallly_Common` est la **couche applicative partagée** de Rallly. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Rallly sur laquelle
s'appuient à la fois [Rallly_GKE](Rallly_GKE.md) et [Rallly_CloudRun](Rallly_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle ne possède aucune entrée propre dans l'interface de déploiement —, mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Rallly, consultez les
guides des plateformes ([Rallly_GKE](Rallly_GKE.md), [Rallly_CloudRun](Rallly_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Rallly_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_PASSWORD` (32 caractères) et `NEXTAUTH_SECRET` (32 caractères), ainsi qu'un `SMTP_PWD` facultatif, et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes via la sortie `secret_ids` |
| Image de conteneur | Enveloppe l'image officielle `lukevella/rallly` d'un fin point d'entrée cloud ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée la base de données, le rôle et les droits | Sortie `initialization_jobs` |
| Valeurs d'environnement principales | Définit `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` (URL de base publique) et les paramètres de messagerie `NOREPLY_EMAIL` / `SUPPORT_EMAIL` / `SMTP_*` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/status` | §Observabilité dans les guides des plateformes |

Rallly stocke **tout** son état dans PostgreSQL — il ne déclare **aucun stockage
d'objets** (pas de bucket de données GCS) et **aucune** dépendance **NFS/Redis**. Ces
intégrations sont désactivées par défaut dans les deux variantes.

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement lors du premier déploiement et stockés dans
Secret Manager ; un troisième n'est créé que lorsque SMTP est configuré. Ils ne sont
jamais définis en clair et sont injectés comme variables d'environnement secrètes via
la sortie `secret_ids` :

- **`SECRET_PASSWORD`** — une chaîne aléatoire de 32 caractères (Rallly exige au moins
  32 caractères). Secret de chiffrement des données et de session de Rallly ; utilisé
  pour chiffrer les valeurs sensibles stockées. Sa rotation après le premier démarrage
  invalide les données chiffrées précédemment et les sessions actives — considérez-le
  comme immuable.
- **`NEXTAUTH_SECRET`** — une chaîne aléatoire de 32 caractères. Signe tous les jetons
  de session NextAuth.js et les liens de connexion par e-mail. Sa rotation invalide
  immédiatement toutes les sessions actives et tout lien de connexion ou de
  vérification en cours, obligeant les utilisateurs à demander un nouvel e-mail de
  connexion.
- **`SMTP_PWD`** — créé uniquement lorsque `smtp_host` est défini. Contient le mot de
  passe d'authentification SMTP. Si `smtp_password` est fourni, il est stocké tel
  quel ; sinon, une valeur générée automatiquement est stockée (utile uniquement si
  elle est associée à un relais correspondant).

Les noms des ressources de secrets suivent le modèle
`secret-<resource-prefix>-rallly-secret-password`,
`secret-<resource-prefix>-rallly-nextauth-secret` et
`secret-<resource-prefix>-rallly-smtp-password`.

Récupérez-les après le déploiement :

```bash
# List Rallly secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~rallly"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Rallly exige **PostgreSQL 15** (`database_type = POSTGRES_15`) ; le moteur est imposé
et MySQL ou d'autres moteurs ne sont pas pris en charge. Lors du premier déploiement,
une tâche ponctuelle (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière
idempotente :

1. Passe par le Cloud SQL Auth Proxy — lorsque `DB_SSL = false` et que `DB_HOST` n'est
   pas un chemin de socket, elle force `DB_HOST = 127.0.0.1` afin que `psql` atteigne
   le sidecar proxy,
2. Attend que PostgreSQL accepte les connexions,
3. Crée le rôle de l'application (ou met à jour son mot de passe) et lui accorde
   `CREATEDB`,
4. Crée la base de données de l'application (ou en réattribue la propriété) à ce rôle,
5. Accorde tous les privilèges sur la base de données et le schéma `public` (PG15+),
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (`POST /quitquitquit`).

La tâche est configurée avec `max_retries = 3` et `execute_on_apply = true`, et peut
être relancée sans risque. Notez que le **schéma applicatif** de Rallly est créé
séparément — le script `./docker-start.sh` du conteneur exécute
`prisma migrate deploy` à chaque démarrage (voir le §4) ; `db-init` se contente donc
de provisionner la base de données vide et le rôle.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données (`rallly`) et de l'utilisateur
(`rallly`) figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine enveloppe `FROM lukevella/rallly:${RALLLY_VERSION}`
(une image Debian basée sur `node:24-slim`). Un ARG de build propre à l'application,
`RALLLY_VERSION`, est utilisé délibérément — le socle injecte
`APP_VERSION = application_version` et écraserait sinon le tag en `latest`. L'image
s'exécute sous l'utilisateur non root `nextjs` et expose le port **3000**.

Le script `cloud-entrypoint.sh` de l'enveloppe s'exécute avant le démarrage propre de
Rallly et :

- **Compose `DATABASE_URL`** à partir des variables `DB_*` injectées par la plateforme,
  au format d'URL Prisma, en fonction de l'hôte résolu selon la règle socket ou TCP de
  Cloud SQL :
  - un **répertoire de socket Unix** (`/cloudsql/...`, Auth Proxy de Cloud Run) →
    `postgresql://…@localhost:5432/<db>?host=<socket>&sslmode=disable`,
  - **loopback** (`127.0.0.1`, sidecar proxy de GKE) →
    `postgresql://…@127.0.0.1:5432/<db>?sslmode=disable`,
  - une **véritable IP privée** → `postgresql://…@<ip>:5432/<db>?sslmode=require`.
  Le mot de passe est encodé pour URL à l'aide du binaire `node` déjà présent dans
  l'image.
- **Définit l'URL de base publique** — privilégie un `NEXT_PUBLIC_BASE_URL` explicite ;
  sinon, adopte le `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injecté par la
  plateforme, et définit toujours `NEXTAUTH_URL` en conséquence.
- **Lie le serveur** — `PORT = 3000`, `HOSTNAME = 0.0.0.0`.
- **Délègue au script `./docker-start.sh` de Rallly**, qui exécute
  `prisma migrate deploy` (appliquant le schéma de l'application et les éventuelles
  migrations), puis lance le serveur Next.js.

Comme les migrations s'exécutent dans le propre script de démarrage de l'application,
la mise à niveau de la version de l'application applique automatiquement les
modifications de schéma au démarrage suivant — aucune tâche de migration distincte
n'est requise.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Rallly_Common` établit l'environnement de base de Rallly afin que l'application
démarre correctement dès le premier lancement :

- **URL de base publique** — `NEXT_PUBLIC_BASE_URL` et `NEXTAUTH_URL` sont définies à
  partir de l'entrée `base_url`, avec par défaut l'URL déterministe du service
  lorsqu'elle est vide. Rallly construit tous les liens d'invitation et de connexion à
  partir de cette valeur et rejette la valeur par défaut de l'image (`localhost`) pour
  un usage réel ; la variante de plateforme transmet donc toujours une URL
  utilisable.
- **Identité e-mail** — `NOREPLY_EMAIL` et `SUPPORT_EMAIL` valent par défaut
  `noreply@rallly.local` (à remplacer avec `mail_from`).
- **SMTP** — lorsque `smtp_host` est défini, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` et
  `SMTP_SECURE` sont injectés comme variables d'environnement simples, et `SMTP_PWD`
  comme secret. Rallly utilise une **authentification sans mot de passe, par e-mail**
  (fournisseur e-mail de NextAuth) : les utilisateurs s'inscrivent et se connectent en
  recevant un lien ou un code de vérification ; une configuration SMTP fonctionnelle
  est donc de fait requise pour que quiconque puisse se connecter.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/api/status`** — le point
de terminaison d'état public et non authentifié de Rallly, qui répond une fois le
serveur Next.js démarré. La sonde de démarrage accorde une fenêtre généreuse (délai
initial de 30 secondes, 20 tentatives à intervalles de 15 secondes) pour tenir compte
de l'étape `prisma migrate deploy` qui s'exécute au premier démarrage avant que le
serveur commence à servir.

---

## 7. Modèle de stockage {#7-storage-model}

Rallly est **sans état sur disque** — sondages, participants, votes, commentaires et
comptes utilisateur résident tous dans PostgreSQL. `Rallly_Common` ne déclare donc
**aucun bucket de données GCS**, laisse **NFS désactivé** (`enable_nfs = false`) et
n'utilise **pas Redis** (`enable_redis = false` est fixé en dur dans les deux variantes
de plateforme). Il n'y a aucun stockage d'objets à inspecter pour cette application.

---

Pour la configuration de Rallly destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Rallly_GKE](Rallly_GKE.md)** et
**[Rallly_CloudRun](Rallly_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Rallly sur Google Cloud Run](Rallly_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Rallly sur GKE Autopilot](Rallly_GKE.md) — cette configuration déployée sur GKE.
