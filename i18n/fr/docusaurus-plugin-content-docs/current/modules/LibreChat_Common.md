---
title: "LibreChat Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module LibreChat — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LibreChat_Common.md @ 3055034 sha256:5312775cd5fb -->

# LibreChat Common — Configuration applicative partagée {#librechat-common--shared-application-configuration}

`LibreChat_Common` est la **couche applicative partagée** de LibreChat. Elle n'est pas déployée
seule ; elle fournit la configuration propre à LibreChat sur laquelle s'appuient à la fois
[LibreChat_GKE](LibreChat_GKE.md) et [LibreChat_CloudRun](LibreChat_CloudRun.md), afin que
les deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LibreChat, consultez les guides de plateforme
([LibreChat_GKE](LibreChat_GKE.md), [LibreChat_CloudRun](LibreChat_CloudRun.md)) et les
guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LibreChat_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET` et `MONGO_URI` et les stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Fige l'image officielle de LibreChat (`ghcr.io/danny-avila/librechat`) et la met en miroir dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Connectivité de la base de données | Gère l'URI MongoDB — trois modes : URI explicite (utilisée par défaut, via le sidecar/service auxiliaire `mongo:7` propre à chaque appelant), configuration Firestore manuelle, ou provisionnement automatique de Firestore ENTERPRISE (à activer explicitement) | Secret `MONGO_URI` ; §Base de données ci-dessous |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `uploads`) pour les fichiers téléversés par les utilisateurs | Sortie `storage_buckets` |
| Liaison du port | Définit `container_port = 3080` — le port du serveur Express de LibreChat | Configuration du service/de la révision |
| Paramètres principaux | Définit l'environnement de base de LibreChat (`HOST`, `NODE_ENV`, `APP_TITLE`, `TRUST_PROXY`, `ALLOW_REGISTRATION`, `DOMAIN_CLIENT`, `DOMAIN_SERVER`) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage et de vivacité, ciblant le chemin racine de LibreChat (`/`) avec un délai de démarrage généreux | Observabilité dans les guides de plateforme |

---

## 2. Secrets générés automatiquement dans Secret Manager {#2-auto-generated-secrets-in-secret-manager}

Cinq secrets principaux de LibreChat sont générés automatiquement au premier déploiement et stockés dans
Secret Manager. Deux autres (`scram-password`, `firestore-host`) ne sont ajoutés que lorsque le chemin de
provisionnement automatique de Firestore compatible MongoDB est actif (§3) — ce qui, si l'on considère uniquement
le comportement propre de `LibreChat_Common` avec ses variables nues, se produit dès que `mongodb_uri` et
`firestore_mongodb_host` sont tous deux laissés vides. Ce n'est **pas ce que fait un déploiement de plateforme
par défaut**, toutefois : aucun des appelants réels (`LibreChat_CloudRun`, `LibreChat_GKE`) n'invoque jamais ce
module avec les deux laissés vides sous ses propres valeurs par défaut — Cloud Run transmet toujours l'URI de son sidecar
`mongo:7` dans le pod, et GKE calcule toujours l'URI d'un service auxiliaire `mongo:7` dans l'espace de noms
lorsque son propre `mongodb_uri` est vide (voir §3, mode 1). Le provisionnement automatique de Firestore ne s'exécute que lorsqu'un
opérateur vide explicitement le `mongodb_uri` effectif pour l'activer. Tous les secrets sont
injectés dans la charge de travail à l'exécution ; le texte en clair n'est jamais écrit dans les fichiers d'état ni dans les journaux.

| Suffixe du secret | Variable d'environnement | Contenu |
|---|---|---|
| `creds-key` | `CREDS_KEY` | Chaîne hexadécimale aléatoire de 32 octets — clé de chiffrement AES-GCM des identifiants de fournisseurs d'IA enregistrés |
| `creds-iv` | `CREDS_IV` | Chaîne hexadécimale aléatoire de 16 octets — vecteur d'initialisation AES-GCM associé à `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Chaîne aléatoire de 64 caractères — signe les jetons d'accès des utilisateurs |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Chaîne aléatoire de 64 caractères — signe les jetons d'actualisation de longue durée |
| `mongo-uri` | `MONGO_URI` | Chaîne de connexion MongoDB (explicite ou construite pour Firestore) |
| `scram-password` | `SCRAM_PASSWORD` | Mot de passe SCRAM-SHA-256 généré automatiquement pour le principal UserCreds de Firestore (mode Firestore uniquement) |
| `firestore-host` | `FIRESTORE_HOST` | Hôte de connexion Firestore compatible MongoDB, stocké comme secret car il est inconnu au moment du plan lors de la première création (mode Firestore uniquement) |

Récupérez un secret après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~librechat"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

> **Considérez `CREDS_KEY` et `CREDS_IV` comme immuables dès que les utilisateurs commencent à enregistrer des identifiants
> de fournisseurs d'IA.** La rotation de l'une ou l'autre clé rend tous les identifiants stockés indéchiffrables — chaque utilisateur
> doit saisir à nouveau ses clés d'API.

> **La rotation de `JWT_SECRET` invalide immédiatement toutes les sessions actives.** Planifiez les rotations pendant
> une fenêtre de maintenance.

---

## 3. Modes de connectivité MongoDB {#3-mongodb-connectivity-modes}

LibreChat nécessite MongoDB. `LibreChat_Common` prend en charge trois chemins de connexion
mutuellement exclusifs :

1. **URI explicite (la valeur par défaut de la plateforme, via le câblage par défaut propre à l'appelant).** Fournissez
   `mongodb_uri` avec une chaîne de connexion MongoDB complète (`mongodb+srv://...` pour Atlas,
   `mongodb://...` pour une instance auto-hébergée). L'URI est stockée directement comme secret `MONGO_URI` et
   le chemin de provisionnement Firestore est entièrement ignoré. C'est aussi le mode qu'utilisent d'emblée les deux
   appelants de plateforme : `LibreChat_CloudRun` transmet toujours l'URI de son sidecar `mongo:7` dans le pod
   (`mongodb://127.0.0.1:27017/LibreChat`), et le `main.tf` de `LibreChat_GKE` calcule l'URI d'un
   service auxiliaire `mongo:7` dans l'espace de noms (`mongodb://<service>-mongo.<namespace>.svc.cluster.local:27017/LibreChat`)
   chaque fois que sa propre entrée `mongodb_uri` est vide — aucun des deux ne transmet jamais une chaîne réellement vide
   à ce module avec les paramètres par défaut.

2. **Configuration Firestore manuelle.** Définissez `firestore_mongodb_host` sur le point de terminaison Firestore
   compatible MongoDB et fournissez `firestore_mongodb_username` et
   `firestore_mongodb_password`. Le module construit automatiquement l'URI authentifiée par SCRAM
   et la stocke dans Secret Manager.

3. **Provisionnement automatique de Firestore ENTERPRISE (à activer explicitement — la valeur par défaut nue de `LibreChat_Common`,
   pas celle de la plateforme).** Laissez les trois variables vides dans l'appel *effectif* à
   ce module — ce qui exige qu'un opérateur remplace explicitement `mongodb_uri` par `""` sur
   `LibreChat_CloudRun`/`LibreChat_GKE`, puisque la valeur par défaut d'aucun de ces modules n'atteint
   ce module avec une URI vide (voir mode 1). Lorsque ce chemin s'exécute effectivement, le
   module :
   - Découvre toute base de données Firestore ENTERPRISE gérée en externe (portant le libellé Services_GCP).
   - Crée une nouvelle base de données Firestore ENTERPRISE si aucune n'est trouvée (idempotent — sans risque en cas de nouvelle tentative).
   - Active l'accès aux données compatible MongoDB via l'API Firestore Admin.
   - Provisionne un utilisateur SCRAM via l'API Firestore UserCreds et stocke l'URI SCRAM dans le
     secret `mongo-uri`.

   > **La base de données Firestore n'est jamais supprimée lors de la destruction.** Elle est conservée pour éviter toute perte
   > de données. Supprimez-la manuellement via la console ou `gcloud firestore databases delete` si vous
   > n'en avez plus besoin.

Inspectez la base de données Firestore et la connexion :

```bash
gcloud firestore databases list --project "$PROJECT"
gcloud firestore databases describe librechat --project "$PROJECT"
```

---

## 4. Image de conteneur {#4-container-image}

`LibreChat_Common` fige `ghcr.io/danny-avila/librechat` comme image de base et active par défaut la mise en miroir
de l'image dans Artifact Registry. La mise en miroir évite les limites de débit de GitHub Container
Registry et améliore la fiabilité des téléchargements d'images dans les environnements de production.

Définissez `application_version` sur un tag de version précis (p. ex. `v0.7.7`) en production pour éviter
des montées de version non planifiées susceptibles d'introduire des changements incompatibles du schéma MongoDB.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`LibreChat_Common` injecte les variables d'environnement suivantes afin que LibreChat démarre correctement
dès le premier lancement :

| Variable | Valeur | Rôle |
|---|---|---|
| `HOST` | `0.0.0.0` | Écoute sur toutes les interfaces dans le conteneur |
| `NODE_ENV` | `production` | Active les optimisations de production d'Express.js |
| `TRUST_PROXY` | `1` | Permet à Express de lire `X-Forwarded-For` et de définir des cookies Secure via l'entrée Cloud Run / GKE |
| `APP_TITLE` | `var.app_title` | Titre de l'en-tête de l'interface LibreChat et de l'onglet du navigateur |
| `DOMAIN_CLIENT` / `DOMAIN_SERVER` | URL du service | Requis pour les URI de redirection OAuth et les liens de vérification par e-mail |
| `ALLOW_REGISTRATION` | `var.allow_registration` | Contrôle l'auto-inscription |
| `ALLOW_SOCIAL_LOGIN` | `var.allow_social_login` | Contrôle la connexion sociale OAuth |
| `ALLOW_SOCIAL_REGISTRATION` | dérivée | Prend par défaut la valeur de `allow_social_login` si elle n'est pas définie explicitement |

Les `environment_variables` supplémentaires du module appelant sont fusionnées.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les deux sondes ciblent le chemin racine de LibreChat (`/`), qui renvoie HTTP 200 une fois l'application
entièrement initialisée et connectée à MongoDB.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage (GKE) | HTTP | `/` | 30 s | 15 s | 12 |
| Vivacité (GKE) | HTTP | `/` | 60 s | 30 s | 3 |
| Démarrage (Cloud Run) | HTTP | `/` | 30 s | 15 s | 10 |
| Vivacité (Cloud Run) | HTTP | `/` | 60 s | 30 s | 3 |

Les seuils d'échec généreux de la sonde de démarrage laissent le temps d'établir la connexion à MongoDB et
de charger les ressources au premier démarrage. Contrairement à certaines applications PHP, LibreChat n'émet pas de
redirections HTTP sur le chemin racine ; une simple sonde HTTP fonctionne donc sur les deux plateformes.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe `uploads`) est déclaré ici et provisionné par
le socle, qui accorde aussi l'accès au compte de service de la charge de travail. Le bucket stocke les fichiers
téléversés par les utilisateurs (images, documents) partagés dans les conversations. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~uploads"
```

---

Pour la configuration propre à LibreChat destinée aux utilisateurs (variables par groupe, sorties, et comment
explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[LibreChat_GKE](LibreChat_GKE.md)** et **[LibreChat_CloudRun](LibreChat_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LibreChat sur Google Cloud Run](LibreChat_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LibreChat sur GKE Autopilot](LibreChat_GKE.md) — cette configuration déployée sur GKE.
