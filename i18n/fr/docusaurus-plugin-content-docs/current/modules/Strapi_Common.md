---
title: "Strapi Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Strapi — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Strapi_Common.md @ 3055034 sha256:6e0ab885f4d7 -->

# Strapi Common — Configuration applicative partagée {#strapi-common--shared-application-configuration}

`Strapi_Common` est la **couche applicative partagée** de Strapi. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Strapi sur laquelle
s'appuient [Strapi_GKE](Strapi_GKE.md) et [Strapi_CloudRun](Strapi_CloudRun.md), de
sorte que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Strapi, consultez les
guides des plateformes ([Strapi_GKE](Strapi_GKE.md), [Strapi_CloudRun](Strapi_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Strapi_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère et stocke cinq secrets Strapi dans **Secret Manager** | Injectés automatiquement comme variables d'environnement à l'exécution |
| Image de conteneur | Définit un build Node.js 20 en deux étapes (node:20-alpine) avec le panneau d'administration Strapi précompilé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme moteur requis | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche du premier déploiement qui crée la base de données, l'utilisateur et les droits (dont `CREATEDB`) | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** des téléversements (suffixe `strapi-uploads`) | Sortie `storage_buckets` |
| Paramètres de base | Définit `NODE_ENV = "production"`, le port de Strapi, la configuration du proxy et les variables d'environnement Redis facultatives | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage (`/_health`, délai de 30 secondes, seuil de 30 échecs) et de vivacité (`/_health`, délai de 15 secondes) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Strapi requiert cinq valeurs cryptographiques distinctes qui doivent rester stables
lors des redémarrages, des événements de mise à l'échelle et des mises à niveau de
version. Les cinq sont générées automatiquement lors du premier déploiement et
stockées dans Secret Manager — elles ne sont jamais définies en clair.

| Secret (variable d'environnement) | Rôle |
|---|---|
| `APP_KEYS` | Quatre clés de 32 caractères (jointes par des virgules) qui signent les cookies de session de Strapi |
| `ADMIN_JWT_SECRET` | Signe les jetons JWT du panneau d'administration |
| `JWT_SECRET` | Signe les jetons JWT de l'API destinée aux utilisateurs |
| `API_TOKEN_SALT` | Hache les jetons d'API générés |
| `TRANSFER_TOKEN_SALT` | Hache les jetons de transfert de données |

Récupérez un secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~strapi"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

**Ces secrets ne doivent jamais faire l'objet d'une rotation ni être régénérés après
le premier déploiement.** Modifier l'un d'entre eux invalide immédiatement toutes les
sessions utilisateur et tous les jetons d'API actifs — chaque utilisateur connecté est
déconnecté et chaque intégration d'API échoue avec des erreurs 401 jusqu'à ce que tous
les consommateurs régénèrent leurs jetons. Le mot de passe de la base de données est
généré et géré séparément par le socle ; le nom de son secret est indiqué dans les
sorties du déploiement de la plateforme (`database_password_secret`). Consultez
[App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Strapi requiert **PostgreSQL** ; le moteur est imposé et MySQL n'est pas pris en
charge. Lors du premier déploiement, une tâche ponctuelle `db-init` se connecte à
Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. Attend que PostgreSQL accepte les connexions (test de connexion complet, pas un
   simple ping).
2. Crée l'utilisateur de l'application avec le mot de passe généré (ou met à jour le
   mot de passe si l'utilisateur existe déjà).
3. Accorde le privilège `CREATEDB` — requis par le système de migration de Strapi basé
   sur Knex, qui crée et supprime des bases de données lors de certaines opérations.
4. Crée la base de données de l'application, dont l'utilisateur de l'application est
   propriétaire (ou la reprend si elle existe déjà).
5. Accorde tous les privilèges sur la base de données et sur son schéma public.
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement.

La tâche peut être relancée sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Strapi_Common` établit l'environnement Strapi de référence :

- **Environnement Node** — `NODE_ENV = "production"` afin que Strapi serve les
  ressources compilées et désactive les middlewares réservés au développement.
- **Port du conteneur** — le serveur HTTP de Strapi écoute par défaut sur le port
  1337. La variante Cloud Run le remplace par 8080 pour s'aligner sur le port standard
  de Cloud Run.
- **Confiance envers le proxy** — `proxy: true` est codé en dur dans
  `config/server.js` afin que Strapi lise correctement les en-têtes
  `X-Forwarded-Proto` et `X-Forwarded-For` derrière les équilibreurs de charge de
  Cloud Run et de GKE.
- **Fournisseur de téléversement GCS** — `config/plugins.js` détecte
  `GCS_BUCKET_NAME` et active automatiquement
  `@strapi-community/strapi-provider-upload-google-cloud-storage`.
  `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées par les modules de plateforme.
- **Envoi d'e-mails (facultatif)** — si `SMTP_HOST` est défini dans
  `environment_variables`, `config/plugins.js` active automatiquement le fournisseur
  d'e-mails `nodemailer`.
- **Redis (facultatif)** — lorsque `enable_redis = true`, `ENABLE_REDIS`,
  `REDIS_HOST`, `REDIS_PORT` et `REDIS_PASSWORD` sont injectées. Si `redis_host` est
  laissé vide et que NFS est activé, l'IP de l'hôte NFS est résolue au démarrage du
  conteneur via `strapi-entrypoint.sh`. Le plugin Redis s'active selon la présence de
  `REDIS_HOST` plutôt que selon `ENABLE_REDIS`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison `/_health` de Strapi, qui ne
renvoie HTTP 200 que lorsque l'application et la connexion à la base de données sont
entièrement initialisées.

- **Sonde de démarrage** — HTTP `/_health`, délai initial de 30 secondes, période de
  10 secondes, seuil de 30 échecs — ce qui accorde jusqu'à ~330 secondes de délai de
  grâce pendant l'initialisation de la base de données au premier démarrage et la
  compilation du panneau d'administration.
- **Sonde de vivacité** — HTTP `/_health`, délai initial de 15 secondes, période de
  30 secondes, seuil de 3 échecs — redémarre rapidement les conteneurs défaillants en
  régime établi.

Les variantes GKE et Cloud Run utilisent toutes deux des sondes HTTP directement sur
`/_health`, car Strapi ne pose pas de problème de redirection HTTP vers HTTPS
(contrairement aux applications PHP qui redirigent le HTTP simple).

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié avec le suffixe `strapi-uploads` est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées automatiquement
par les modules de plateforme, ce qui relie la médiathèque de Strapi à ce bucket sans
aucune configuration manuelle. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 7. Image de conteneur {#7-container-image}

`Strapi_Common` définit un build en deux étapes sur `node:20-alpine` :

- **Étape de build** — installe toutes les dépendances npm, compile le panneau
  d'administration de Strapi (`npm run build`) et produit les artefacts de build.
- **Étape d'exécution** — installe uniquement les dépendances de production, copie
  les fichiers sources et les artefacts de build, supprime les fichiers d'attributs
  étendus macOS, crée le répertoire `public/uploads` requis par Strapi à l'exécution
  et définit l'utilisateur `node` pour un fonctionnement selon le moindre privilège.
  Utilise `tini` comme PID 1 pour une gestion correcte des signaux.

La bibliothèque `vips-dev` est incluse pour satisfaire le paquet npm `sharp`, que
Strapi utilise pour le traitement des images dans la médiathèque. Le script
`strapi-entrypoint.sh` résout l'espace réservé `$(NFS_SERVER_IP)` dans `REDIS_HOST`
avant de démarrer Strapi.

---

Pour la configuration de Strapi destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Strapi_GKE](Strapi_GKE.md)** et
**[Strapi_CloudRun](Strapi_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Strapi sur Google Cloud Run](Strapi_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Strapi sur GKE Autopilot](Strapi_GKE.md) — cette configuration déployée sur GKE.
