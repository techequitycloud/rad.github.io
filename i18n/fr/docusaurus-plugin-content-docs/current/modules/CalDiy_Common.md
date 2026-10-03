---
title: "Cal_Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module CalDiy — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CalDiy_Common.md @ 15fd4c7 sha256:ff83cf08ac4c -->

# CalDiy_Common — Configuration d'application partagée {#caldiy_common--shared-application-configuration}

`CalDiy_Common` est la **couche d'application partagée** pour Cal.diy. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Cal.diy sur laquelle s'appuient [CalDiy_GKE](CalDiy_GKE.md) et [CalDiy_CloudRun](CalDiy_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Cal.diy, consultez les guides de plateforme ([CalDiy_GKE](CalDiy_GKE.md), [CalDiy_CloudRun](CalDiy_CloudRun.md)) et les guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par CalDiy_Common | Où cela apparaît |
|---|---|---|
| Secrets d'application | Génère `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` et les stocke dans **Secret Manager** | Récupéré via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle `calcom/cal.com` comme image de base et fournit un Dockerfile pour construire l'image wrapper | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` (configuration PostgreSQL), le job `db-migrate` (migrations Prisma) et le job `seed-app-store` (amorçage du magasin d'applications) qui s'exécutent en séquence lors du premier déploiement | Sortie `initialization_jobs` |
| Assemblage `DATABASE_URL` | Construit `DATABASE_URL` et `DATABASE_DIRECT_URL` à partir des variables d'environnement `DB_*` au démarrage du conteneur, rendant la connectivité indépendante de la version de l'image | Point d'entrée du conteneur d'exécution |
| Valeurs par défaut des sondes de santé | Fournit une fenêtre de démarrage généreuse (`initial_delay=60s`, `failure_threshold=12`, `period=10s` sur GKE ; `initial_delay=180s`, `failure_threshold=18` via le chemin `start.sh` sur Cloud Run) pour accommoder les migrations et l'amorçage du premier démarrage | §Observabilité dans les guides de plateforme |

---

## 2. Secrets d'application dans Secret Manager {#2-application-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont jamais définis en texte clair. Récupérez-les après le déploiement :

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~nextauth OR name~encryption-key"

# Read the current value (e.g., for manual NextAuth configuration):
gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
gcloud secrets versions access latest --secret=<encryption-key-name> --project "$PROJECT"
```

| Suffixe du secret | Variable d'environnement | But |
|---|---|---|
| `*-nextauth-secret` | `NEXTAUTH_SECRET` | Signature et chiffrement de session NextAuth.js |
| `*-encryption-key` | `CALENDSO_ENCRYPTION_KEY` | Chiffrement des données au repos de Cal.diy |
| `*-cron-api-key` | `CRON_API_KEY` | Authentifie les appels à `/api/cron/*` (rappels). Créé uniquement lorsque `cron_api_key` est défini. |

Une pause de 30 secondes est insérée après la création du secret pour éviter les conditions de concurrence lorsque le conteneur lit ces secrets au démarrage.

Le mot de passe de la base de données est généré et géré séparément par le socle ; son nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`).
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle d'identité de charge de travail.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Cal.diy nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en charge.
Lors du premier déploiement, trois jobs ponctuels s'exécutent en séquence :

1. **`db-init`** — utilise `postgres:15-alpine` et `CalDiy_Common/scripts/db-init.sh`
   pour créer de manière idempotente la base de données PostgreSQL, l'utilisateur de l'application et accorder les privilèges.
2. **`db-migrate`** — exécute `prisma migrate deploy` sur le schéma Cal.diy en utilisant
   l'image de l'application. S'assure que toutes les migrations Prisma sont appliquées avant le démarrage du conteneur principal.
3. **`seed-app-store`** — amorce la table `App` avec les intégrations disponibles en utilisant
   `seed-app-store.ts`. Dépend de la complétion de `db-migrate` en premier.

Les trois jobs sont idempotents et peuvent être réexécutés en toute sécurité. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et assemblage de DATABASE_URL {#4-container-image-and-database_url-assembly}

`CalDiy_Common` définit toujours `image_source = "custom"` et fournit un `Dockerfile` qui
construit une image wrapper au-dessus de l'image de base officielle `calcom/cal.com`. L'image wrapper
inclut un point d'entrée personnalisé qui :

1. Encode en URL les identifiants de la base de données à partir des variables d'environnement `DB_*` injectées
   par la plateforme.
2. Assemble `DATABASE_URL` et `DATABASE_DIRECT_URL` (prenant en charge automatiquement les modes de connexion par socket Unix et TCP).
3. Exporte les deux variables, puis exécute `start.sh` pour lancer le serveur Next.js.

Cette conception rend le déploiement robuste quelle que soit la version de l'image dans le
registre — le `DATABASE_URL` est toujours assemblé à partir des identifiants d'exécution actuels
plutôt que d'être intégré à l'image.

Ajustements spécifiques à la plateforme :

- **Cloud Run** exécute également `replace-placeholder.sh` à l'intérieur de `start.sh`, qui réécrit
  `NEXT_PUBLIC_WEBAPP_URL` dans tous les morceaux statiques de Next.js (~2,5 minutes au premier démarrage).
  C'est la principale raison de la fenêtre généreuse de la sonde de démarrage de Cloud Run.
- **GKE** a `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` résolus à l'adresse IP réelle du LoadBalancer
  ou au domaine personnalisé au moment de l'apply via la sentinelle `$(GKE_SERVICE_URL)` ;
  la séquence de démarrage est en conséquence plus rapide.

---

## 5. Comportement de la sonde de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent `/api/auth/session`, qui renvoie HTTP 200 uniquement une fois
NextAuth.js entièrement initialisé. Ce point de terminaison est fiable sur les variantes d'image de base et
wrapper.

- **GKE** utilise une sonde HTTP avec un délai initial de 60 secondes et un `failure_threshold`
  de 12 à intervalles de 10 secondes (2 minutes de tolérance après le délai initial) pour
  permettre à `db-migrate` et `seed-app-store` de se terminer avant que le pod ne soit déclaré
  prêt.
- **Cloud Run** définit un `initial_delay_seconds = 180` plus long pour couvrir `replace-placeholder.sh`
  (~2,5 min) en plus des étapes de migration et d'amorçage. La fenêtre de démarrage totale
  est d'environ 6 minutes.

Une sonde de disponibilité (readiness) (`/api/auth/session`, `initial_delay=30s`) est également codée en dur et non
configurable par l'utilisateur.

---

## 6. Stockage d'objets {#6-object-storage}

Cette couche ne déclare aucun bucket propre — sa sortie `storage_buckets` est vide. Un
bucket `data` Cloud Storage par défaut provient de la valeur par défaut `storage_buckets` des modules de la plateforme
et est provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Contrairement aux applications avec des téléchargements de médias, Cal.diy ne nécessite pas de NFS partagé — tout l'état de réservation réside dans PostgreSQL. Des buckets supplémentaires peuvent être déclarés dans la variable `storage_buckets` du module de la plateforme. Listez-les avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à Cal.diy et destinée à l'utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[CalDiy_GKE](CalDiy_GKE.md)** et **[CalDiy_CloudRun](CalDiy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cal.diy sur GKE Autopilot](CalDiy_GKE.md) — cette configuration déployée sur GKE.
