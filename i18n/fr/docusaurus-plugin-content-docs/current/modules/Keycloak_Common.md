---
title: "Keycloak Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Keycloak — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Keycloak_Common.md @ 3055034 sha256:059e65ec9d80 -->

# Keycloak Common — Configuration applicative partagée {#keycloak-common--shared-application-configuration}

`Keycloak_Common` est la **couche applicative partagée** de Keycloak. Elle n'est pas déployée seule ; elle fournit la configuration propre à Keycloak sur laquelle s'appuient à la fois [Keycloak_GKE](Keycloak_GKE.md) et [Keycloak_CloudRun](Keycloak_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Keycloak, consultez les guides des plateformes ([Keycloak_GKE](Keycloak_GKE.md), [Keycloak_CloudRun](Keycloak_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Keycloak_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle `quay.io/keycloak/keycloak` et construit une variante personnalisée **optimisée pour la production** (`kc.sh build` → `start --optimized`) via un Dockerfile multi-étapes | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Mappe les variables d'environnement `DB_*` injectées par le socle sur les variables `KC_DB_*` de Keycloak, assemble l'URL JDBC `KC_DB_URL` et détecte automatiquement l'URL publique pour `KC_HOSTNAME` | Comportement de l'application dans les guides des plateformes |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche `db-init` du premier déploiement qui crée le rôle et la base de données et accorde les privilèges sur le schéma (idempotente, adaptée à PostgreSQL 15+) | Sortie `initialization_jobs` |
| Secrets | Crée le secret du **mot de passe de l'administrateur d'amorçage** dans Secret Manager (`KC_BOOTSTRAP_ADMIN_PASSWORD`) | Sortie `secret_ids` |
| Environnement de base | Injecte `KC_DB=postgres`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED`, `KC_BOOTSTRAP_ADMIN_USERNAME=admin` | §Environnement dans les guides des plateformes |
| Stockage objet | **Aucun** — Keycloak stocke tout son état dans PostgreSQL (`storage_buckets = []`) | Sortie `storage_buckets` |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage TCP (délai de 30 s, 30 échecs) et de disponibilité TCP (délai de 60 s) sur le port 8080 — le `/health` de Keycloak se trouve sur le port de gestion 9000 non exposé | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Le seul secret de niveau applicatif de Keycloak est le **mot de passe de l'administrateur d'amorçage** — un mot de passe aléatoire de 20 caractères stocké sous `secret-<prefix>-keycloak-admin-password` et injecté dans le conteneur sous la forme `KC_BOOTSTRAP_ADMIN_PASSWORD` (nom d'utilisateur `admin` via `KC_BOOTSTRAP_ADMIN_USERNAME`). Le **mot de passe de la base de données** est généré par le socle et injecté sous la forme `DB_PASSWORD` ; le point d'entrée le mappe sur `KC_DB_PASSWORD` à l'exécution.

```bash
# List the Keycloak secrets
gcloud secrets list --project "$PROJECT" --filter="name~keycloak"

# Retrieve the bootstrap admin password for first login
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~keycloak-admin-password' --format='value(name)' --limit=1)" \
  --project "$PROJECT"
```

L'administrateur d'amorçage est **temporaire par conception** — connectez-vous sur `<service-url>/admin`, créez un administrateur permanent, puis supprimez l'utilisateur d'amorçage ou changez son mot de passe.

---

## 3. Image de conteneur et point d'entrée personnalisé {#3-container-image-and-custom-entrypoint}

`Keycloak_Common` construit une image personnalisée avec Cloud Build (un `cloudbuild.yaml` + un `Dockerfile` dans `scripts/`). Le Dockerfile multi-étapes :

1. **Étape de build** — exécute `/opt/keycloak/bin/kc.sh build` avec `KC_DB=postgres`, `KC_HEALTH_ENABLED=true` et `KC_METRICS_ENABLED=true`, intégrant le fournisseur de base de données et les fonctionnalités dans un build optimisé pour la production.
2. **Étape d'exécution** — copie le build optimisé, superpose `/keycloak-entrypoint.sh` (en revenant à l'utilisateur UBI non privilégié `1000`) et démarre avec `kc.sh start --optimized`, de sorte que la lente étape de build ne s'exécute jamais au démarrage.

Le point d'entrée effectue ces actions à chaque démarrage du conteneur :

1. **Assemblage de l'URL JDBC.** Construit `KC_DB_URL = jdbc:postgresql://<host>:<port>/<db>` à partir des variables `DB_HOST`/`DB_PORT`/`DB_NAME` injectées par la plateforme. Si `DB_HOST` est un répertoire de socket Unix Cloud SQL (commence par `/`), il **bascule vers `DB_IP`** — le pilote JDBC PostgreSQL ne peut pas utiliser les sockets Unix, ce qui explique aussi pourquoi la variante Cloud Run définit par défaut `enable_cloudsql_volume = false`.
2. **Mappage des identifiants.** Mappe `DB_USER` → `KC_DB_USERNAME` et `DB_PASSWORD` → `KC_DB_PASSWORD`, uniquement s'ils ne sont pas déjà définis, afin que les opérateurs puissent remplacer n'importe quelle variable `KC_DB_*` via `environment_variables`.
3. **Détection automatique du nom d'hôte.** Interroge l'API de métadonnées/Admin de Cloud Run pour obtenir l'URL du service et l'exporte sous la forme `KC_HOSTNAME` (avec repli sur `SERVICE_URL` sur GKE), avec `KC_HOSTNAME_STRICT=false` derrière le front-end qui termine TLS.
4. **Lancement.** Affiche un résumé de la configuration et exécute (`exec`) `kc.sh start --optimized`.

```bash
# Check the entrypoint's configuration summary in the logs
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
  --limit 50 | grep -E "KC_DB_URL|KC_HOSTNAME|Keycloak"
```

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Keycloak nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` dans `Keycloak_Common`. À chaque apply, une tâche ponctuelle `db-init` (`postgres:15-alpine`, jusqu'à 3 nouvelles tentatives) effectue de manière idempotente les opérations suivantes :

1. Crée le rôle applicatif (ou met à jour son mot de passe s'il existe) et l'accorde à `postgres` afin que le superutilisateur puisse gérer ses objets.
2. Crée la base de données Keycloak appartenant à ce rôle (ou corrige le propriétaire si elle existe).
3. Accorde tous les privilèges sur la base de données **et sur `SCHEMA public`** — requis pour PostgreSQL 15+, où `public` n'est plus accessible en écriture à tous.
4. Envoie un signal d'arrêt `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le Job se termine proprement sur GKE.

Keycloak crée et migre lui-même le schéma au premier démarrage. Inspectez directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme (préfixés par le tenant au moment du déploiement).

---

## 5. Valeurs par défaut de l'environnement de base {#5-core-environment-defaults}

`Keycloak_Common` établit l'environnement de référence afin que Keycloak démarre correctement en mode production derrière un front-end qui termine TLS :

- **`KC_DB = postgres`** — le fournisseur de base de données, également intégré au build optimisé.
- **`KC_PROXY_HEADERS = xforwarded`** et **`KC_HTTP_ENABLED = true`** — Cloud Run / l'équilibreur de charge GKE terminent TLS et transmettent les en-têtes `X-Forwarded-*` ; Keycloak communique en HTTP simple sur 8080 derrière eux.
- **`KC_HEALTH_ENABLED = true`** et **`KC_METRICS_ENABLED = true`** — exposent `/health` et `/metrics` sur le port de gestion 9000.
- **`KC_BOOTSTRAP_ADMIN_USERNAME = admin`** — associé au mot de passe Secret Manager ci-dessus.
- `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD` et `KC_HOSTNAME` sont résolues **à l'exécution** par le point d'entrée, jamais codées en dur — le socle préfixe par le tenant les vrais noms du rôle et de la base de données, si bien que les coder en dur entraînerait une authentification avec un rôle inexistant.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Keycloak 25+ sert `/health`, `/health/ready`, `/health/live` et `/metrics` sur le **port de gestion distinct 9000** — et non sur le port HTTP 8080 que sondent les plateformes. Une sonde HTTP sur `8080/health` renverrait toujours 404 ; les valeurs par défaut sont donc des contrôles TCP qui confirment que l'écouteur HTTP accepte les connexions :

- **Sonde de démarrage** — TCP sur 8080, délai initial de 30 s, période de 10 s, seuil d'échec de 30 (jusqu'à environ 330 s pour le démarrage de la JVM et les migrations de schéma du premier démarrage).
- **Sonde de disponibilité** — TCP sur 8080, délai initial de 60 s, période de 15 s, seuil d'échec de 3.
- **Vivacité** — la variante Cloud Run la remplace par HTTP `/` (délai de 60 s), qui répond sur 8080 une fois Keycloak démarré.

Ne réduisez pas le budget de démarrage : au premier démarrage, Keycloak doit se connecter à PostgreSQL et créer l'intégralité de son schéma avant l'ouverture de l'écouteur.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. Keycloak conserve les realms, clients, utilisateurs et sessions entièrement dans PostgreSQL — `Keycloak_Common` déclare `storage_buckets = []` et aucun volume GCS, si bien qu'une sauvegarde de la base de données capture l'état complet du déploiement.

---

Pour la configuration propre à Keycloak destinée aux utilisateurs (variables par groupe, sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Keycloak_GKE](Keycloak_GKE.md)** et **[Keycloak_CloudRun](Keycloak_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Keycloak sur Google Cloud Run](Keycloak_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Keycloak sur GKE Autopilot](Keycloak_GKE.md) — cette configuration déployée sur GKE.
