---
title: "Cal_Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module CalDiy — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CalDiy_Common.md @ 3055034 sha256:dd575350701f -->

# CalDiy_Common — Configuration applicative partagée {#caldiy_common--shared-application-configuration}

`CalDiy_Common` est la **couche applicative partagée** de Cal.diy. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Cal.diy sur laquelle
s'appuient [CalDiy_GKE](CalDiy_GKE.md) et [CalDiy_CloudRun](CalDiy_CloudRun.md), de sorte
que les deux variantes de plateforme se comportent de manière identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Cal.diy, consultez les
guides des plateformes ([CalDiy_GKE](CalDiy_GKE.md), [CalDiy_CloudRun](CalDiy_CloudRun.md))
et les guides de fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par CalDiy_Common | Où cela apparaît |
|---|---|---|
| Secrets applicatifs | Génère `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` et les stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle `calcom/cal.com` comme image de base et fournit un Dockerfile pour construire l'image wrapper | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job `db-init` (configuration de PostgreSQL), le job `db-migrate` (migrations Prisma) et le job `seed-app-store` (alimentation de l'app store), qui s'exécutent dans l'ordre au premier déploiement | Sortie `initialization_jobs` |
| Assemblage de `DATABASE_URL` | Construit `DATABASE_URL` et `DATABASE_DIRECT_URL` à partir des variables d'environnement `DB_*` au démarrage du conteneur, ce qui rend la connectivité indépendante de la version de l'image | Point d'entrée du conteneur à l'exécution |
| Valeurs par défaut des sondes de santé | Fournit une fenêtre de démarrage généreuse (`initial_delay=60s`, `failure_threshold=12`, `period=10s` sur GKE ; `initial_delay=180s`, `failure_threshold=18` via le chemin `start.sh` sur Cloud Run) pour laisser le temps aux migrations et à l'alimentation initiale du premier démarrage | §Observabilité dans les guides des plateformes |

---

## 2. Secrets applicatifs dans Secret Manager {#2-application-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair. Récupérez-les après le déploiement :

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~nextauth OR name~encryption-key"

# Read the current value (e.g., for manual NextAuth configuration):
gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
gcloud secrets versions access latest --secret=<encryption-key-name> --project "$PROJECT"
```

| Suffixe du secret | Variable d'environnement | Objectif |
|---|---|---|
| `*-nextauth-secret` | `NEXTAUTH_SECRET` | Signature et chiffrement des sessions NextAuth.js |
| `*-encryption-key` | `CALENDSO_ENCRYPTION_KEY` | Chiffrement au repos des données Cal.diy |

Une pause de 30 secondes est insérée après la création des secrets pour éviter les
conditions de concurrence lorsque le conteneur lit ces secrets pour la première fois
au démarrage.

Le mot de passe de la base de données est généré et géré séparément par la fondation ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur et initialisation de la base de données {#3-database-engine-and-bootstrap}

Cal.diy nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en
charge. Au premier déploiement, trois jobs ponctuels s'exécutent dans l'ordre :

1. **`db-init`** — utilise `postgres:15-alpine` et `CalDiy_Common/scripts/db-init.sh`
   pour créer de façon idempotente la base de données PostgreSQL et l'utilisateur
   applicatif, et accorder les privilèges.
2. **`db-migrate`** — exécute `prisma migrate deploy` sur le schéma Cal.diy à l'aide de
   l'image de l'application. Garantit que toutes les migrations Prisma sont appliquées
   avant le démarrage du conteneur principal.
3. **`seed-app-store`** — alimente la table `App` avec les intégrations disponibles à
   l'aide de `seed-app-store.ts`. Dépend de l'achèvement préalable de `db-migrate`.

Les trois jobs sont idempotents et peuvent être réexécutés sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et assemblage de DATABASE_URL {#4-container-image-and-database_url-assembly}

`CalDiy_Common` définit toujours `image_source = "custom"` et fournit un `Dockerfile`
qui construit une image wrapper au-dessus de l'image de base officielle `calcom/cal.com`.
L'image wrapper comprend un point d'entrée personnalisé qui :

1. Encode en URL les identifiants de la base de données issus des variables
   d'environnement `DB_*` injectées par la plateforme.
2. Assemble `DATABASE_URL` et `DATABASE_DIRECT_URL` (en prenant automatiquement en
   charge les modes de connexion par socket Unix et par TCP).
3. Exporte les deux variables, puis exécute `start.sh` pour lancer le serveur Next.js.

Cette conception rend le déploiement robuste quelle que soit la version de l'image
présente dans le registre — `DATABASE_URL` est toujours assemblée à partir des
identifiants d'exécution courants plutôt qu'intégrée à l'image.

Ajustements propres à chaque plateforme :

- **Cloud Run** exécute en outre `replace-placeholder.sh` dans `start.sh`, qui réécrit
  `NEXT_PUBLIC_WEBAPP_URL` dans tous les blocs statiques Next.js (~2.5 minutes au
  premier démarrage). C'est la principale raison de la fenêtre généreuse de la sonde
  de démarrage sur Cloud Run.
- **GKE** voit `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` résolues vers l'IP réelle du
  LoadBalancer ou le domaine personnalisé au moment de l'application, via la sentinelle
  `$(GKE_SERVICE_URL)` ; la séquence de démarrage est d'autant plus rapide.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent `/api/auth/session`, qui ne renvoie HTTP 200 qu'une fois
NextAuth.js entièrement initialisé. Ce point de terminaison est fiable avec les deux
variantes d'image, de base et wrapper.

- **GKE** utilise une sonde HTTP avec un délai initial de 60 secondes et un
  `failure_threshold` de 12 à intervalles de 10 secondes (2 minutes de tolérance après
  le délai initial) pour laisser `db-migrate` et `seed-app-store` se terminer avant que
  le pod ne soit déclaré prêt.
- **Cloud Run** définit un `initial_delay_seconds = 180` plus long pour couvrir
  `replace-placeholder.sh` (~2.5 min) en plus des étapes de migration et d'alimentation
  initiale. La fenêtre de démarrage totale est d'environ 6 minutes.

Une sonde de disponibilité (`/api/auth/session`, `initial_delay=30s`) est également
codée en dur et n'est pas configurable par l'utilisateur.

---

## 6. Stockage d'objets {#6-object-storage}

Cette couche ne déclare aucun bucket propre — sa sortie `storage_buckets` est vide. Un
bucket Cloud Storage `data` par défaut provient de la valeur par défaut de
`storage_buckets` des modules de plateforme et est provisionné par la fondation, qui
accorde aussi l'accès au compte de service de la charge de travail. Contrairement aux
applications qui gèrent des envois de médias, Cal.diy ne nécessite pas de NFS
partagé — tout l'état des réservations réside dans PostgreSQL. Des buckets
supplémentaires peuvent être déclarés dans la variable `storage_buckets` du module de
plateforme. Listez-les avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Cal.diy exposée aux utilisateurs (variables par groupe,
sorties et manière d'explorer chaque service depuis la Console et la CLI), consultez
les guides des plateformes : **[CalDiy_GKE](CalDiy_GKE.md)** et
**[CalDiy_CloudRun](CalDiy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cal.diy sur GKE Autopilot](CalDiy_GKE.md) — cette configuration déployée sur GKE.
