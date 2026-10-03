---
title: "Keycloak Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Keycloak — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Keycloak_Common.md @ 15fd4c7 sha256:d01d2b7a026d -->

# Keycloak Common — Configuration d'application partagée {#keycloak-common--shared-application-configuration}

`Keycloak_Common` est la **couche d'application partagée** pour Keycloak. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Keycloak sur laquelle s'appuient [Keycloak_GKE](Keycloak_GKE.md) et [Keycloak_CloudRun](Keycloak_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Keycloak, consultez les guides de plateforme ([Keycloak_GKE](Keycloak_GKE.md), [Keycloak_CloudRun](Keycloak_CloudRun.md)) et les guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Keycloak_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle `quay.io/keycloak/keycloak` et construit une variante personnalisée **optimisée pour la production** (`kc.sh build` → `start --optimized`) via un Dockerfile multi-étapes | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Mappe les variables d'environnement `DB_*` injectées par le socle aux variables `KC_DB_*` de Keycloak, assemble l'URL JDBC `KC_DB_URL` et détecte automatiquement l'URL publique pour `KC_HOSTNAME` | Comportement de l'application dans les guides de plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` de premier déploiement qui crée le rôle et la base de données et accorde les privilèges de schéma (idempotent, compatible PostgreSQL 15+) | Sortie `initialization_jobs` |
| Secrets | Crée le secret du **mot de passe administrateur d'amorçage** dans Secret Manager (`KC_BOOTSTRAP_ADMIN_PASSWORD`) | Sortie `secret_ids` |
| Environnement de base | Injecte `KC_DB=postgres`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED`, `KC_BOOTSTRAP_ADMIN_USERNAME=admin` | §Environnement dans les guides de plateforme |
| Stockage d'objets | **Aucun** — Keycloak stocke tout l'état dans PostgreSQL (`storage_buckets = []`) | Sortie `storage_buckets` |
| Sondes de santé | Fournit des valeurs par défaut de sonde de démarrage TCP (délai de 30 s, 30 échecs) et de disponibilité TCP (délai de 60 s) sur le port 8080 — l'endpoint `/health` de Keycloak se trouve sur le port de gestion non exposé 9000 | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Le seul secret de niveau application de Keycloak est le **mot de passe administrateur d'amorçage** — un mot de passe aléatoire de 20 caractères stocké sous le nom `secret-<prefix>-keycloak-admin-password` et injecté dans le conteneur sous le nom `KC_BOOTSTRAP_ADMIN_PASSWORD` (nom d'utilisateur `admin` via `KC_BOOTSTRAP_ADMIN_USERNAME`). Le **mot de passe de la base de données** est généré par le socle et injecté sous le nom `DB_PASSWORD` ; le point d'entrée le mappe à `KC_DB_PASSWORD` à l'exécution.

```bash
# List the Keycloak secrets
gcloud secrets list --project "$PROJECT" --filter="name~keycloak"

# Retrieve the bootstrap admin password for first login
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~keycloak-admin-password' --format='value(name)' --limit=1)" \
  --project "$PROJECT"
```

L'administrateur d'amorçage est **temporaire par conception** — connectez-vous à `<service-url>/admin`, créez un administrateur permanent, puis supprimez ou faites pivoter l'utilisateur d'amorçage.

---

## 3. Image de conteneur et point d'entrée personnalisé {#3-container-image-and-custom-entrypoint}

`Keycloak_Common` construit une image personnalisée avec Cloud Build (un `cloudbuild.yaml` + `Dockerfile` dans `scripts/`). Le Dockerfile multi-étapes :

1. **Étape de construction** — exécute `/opt/keycloak/bin/kc.sh build` avec `KC_DB=postgres`, `KC_HEALTH_ENABLED=true` et `KC_METRICS_ENABLED=true`, intégrant le fournisseur de base de données et les fonctionnalités dans une build optimisée pour la production.
2. **Étape d'exécution** — copie la build optimisée, superpose `/keycloak-entrypoint.sh` (repassant à l'utilisateur UBI non privilégié `1000`) et démarre avec `kc.sh start --optimized` afin que l'étape de construction lente ne s'exécute jamais au démarrage.

Le point d'entrée effectue ces actions à chaque démarrage de conteneur :

1. **Assemblage de l'URL JDBC.** Construit `KC_DB_URL = jdbc:postgresql://<host>:<port>/<db>` à partir de `DB_HOST`/`DB_PORT`/`DB_NAME` injectés par la plateforme. Si `DB_HOST` est un répertoire de socket Unix Cloud SQL (commence par `/`), il **revient à `DB_IP`** — le pilote JDBC PostgreSQL ne peut pas utiliser les sockets Unix, c'est aussi pourquoi la variante Cloud Run définit `enable_cloudsql_volume = false` par défaut.
2. **Mappage des identifiants.** Mappe `DB_USER` → `KC_DB_USERNAME` et `DB_PASSWORD` → `KC_DB_PASSWORD`, uniquement si non déjà définis, afin que les opérateurs puissent remplacer toute variable `KC_DB_*` via `environment_variables`.
3. **Détection automatique du nom d'hôte.** À moins que `KC_HOSTNAME` ne soit défini explicitement, exporte l'URL de service injectée par le socle sous le nom `KC_HOSTNAME` (`CLOUDRUN_SERVICE_URL` sur Cloud Run, sinon `GKE_SERVICE_URL` sur GKE) — la même adresse que le module publie sous le nom `service_url`, de sorte que l'émetteur OIDC corresponde, avec `KC_HOSTNAME_STRICT=false` derrière le frontal de terminaison TLS.
4. **Lancement.** Affiche un résumé de la configuration et `exec`s `kc.sh start --optimized`.

```bash
# Check the entrypoint's configuration summary in the logs
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
  --limit 50 | grep -E "KC_DB_URL|KC_HOSTNAME|Keycloak"
```

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Keycloak nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` à l'intérieur de `Keycloak_Common`. À chaque apply, un job `db-init` à exécution unique (`postgres:15-alpine`, jusqu'à 3 tentatives) de manière idempotente :

1. Crée le rôle d'application (ou met à jour son mot de passe s'il existe) et l'accorde à `postgres` afin que le superutilisateur puisse gérer ses objets.
2. Crée la base de données Keycloak appartenant à ce rôle (ou corrige la propriété si elle existe).
3. Accorde tous les privilèges sur la base de données **et sur `SCHEMA public`** — requis pour PostgreSQL 15+, où `public` n'est plus accessible en écriture par tous.
4. Envoie un signal d'arrêt `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le Job se termine proprement sur GKE.

Keycloak lui-même crée et migre le schéma au premier démarrage. Inspectez la base de données directement :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme (préfixés par le locataire au moment du déploiement).

---

## 5. Valeurs par défaut de l'environnement de base {#5-core-environment-defaults}

`Keycloak_Common` établit l'environnement de base afin que Keycloak démarre correctement en mode production derrière un frontal de terminaison TLS :

- **`KC_DB = postgres`** — le fournisseur de base de données, également intégré à la build optimisée.
- **`KC_PROXY_HEADERS = xforwarded`** et **`KC_HTTP_ENABLED = true`** — Cloud Run / l'équilibreur de charge GKE terminent TLS et transmettent les en-têtes `X-Forwarded-*` ; Keycloak parle en HTTP simple sur le port 8080 derrière eux.
- **`KC_HEALTH_ENABLED = true`** et **`KC_METRICS_ENABLED = true`** — exposent `/health` et `/metrics` sur le port de gestion 9000.
- **`KC_BOOTSTRAP_ADMIN_USERNAME = admin`** — associé au mot de passe Secret Manager ci-dessus.
- `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD` et `KC_HOSTNAME` sont résolus **à l'exécution** par le point d'entrée, jamais codés en dur — le socle préfixe les noms de rôle et de base de données réels par le locataire, donc les coder en dur authentifierait un rôle inexistant.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Keycloak 25+ sert `/health`, `/health/ready`, `/health/live` et `/metrics` sur le **port de gestion séparé 9000** — et non sur le port HTTP 8080 que les plateformes sondent. Une sonde HTTP vers `8080/health` renverrait toujours 404, donc les valeurs par défaut sont des vérifications TCP qui confirment que l'écouteur HTTP accepte les connexions :

- **Sonde de démarrage** — TCP sur 8080, délai initial 30 s, période 10 s, seuil d'échec 30 (jusqu'à ~330 s pour le démarrage de la JVM + les migrations de schéma au premier démarrage).
- **Sonde de disponibilité (readiness)** — TCP sur 8080, délai initial 60 s, période 15 s, seuil d'échec 3.
- **Vivacité** — la variante Cloud Run remplace par HTTP `/` (délai de 60 s), qui répond sur 8080 une fois que Keycloak est opérationnel.

Ne réduisez pas le budget de démarrage : au premier démarrage, Keycloak doit se connecter à PostgreSQL et créer tout son schéma avant que l'écouteur ne s'ouvre.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. Keycloak conserve les royaumes, les clients, les utilisateurs et les sessions entièrement dans PostgreSQL — `Keycloak_Common` déclare `storage_buckets = []` et aucun volume GCS, de sorte qu'une sauvegarde de base de données capture l'état complet du déploiement.

---

Pour la configuration spécifique à Keycloak et destinée aux utilisateurs (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[Keycloak_GKE](Keycloak_GKE.md)** et **[Keycloak_CloudRun](Keycloak_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Keycloak sur Google Cloud Run](Keycloak_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Keycloak sur GKE Autopilot](Keycloak_GKE.md) — cette configuration déployée sur GKE.
