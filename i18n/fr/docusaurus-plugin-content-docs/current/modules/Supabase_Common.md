---
title: "Supabase Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Supabase — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Supabase_Common.md @ 3055034 sha256:9d3c6ff8e031 -->

# Supabase Common — Configuration applicative partagée {#supabase-common--shared-application-configuration}

`Supabase_Common` est la **couche applicative partagée** de Supabase. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Supabase sur laquelle
s'appuie [Supabase_GKE](Supabase_GKE.md), en garantissant que la passerelle, le
schéma de la base de données et les secrets sont reliés de manière cohérente. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle ne possède
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Supabase, consultez le
guide de la plateforme ([Supabase_GKE](Supabase_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Supabase_Common | Où cela apparaît |
|---|---|---|
| Identifiants JWT | Génère et stocke dans **Secret Manager** le secret de signature JWT, l'anon key, la service role key, la publishable key, la secret key et le secret_key_base | À récupérer via Secret Manager ; les valeurs provisoires doivent être remplacées après le déploiement |
| Image de conteneur | Fige l'image de la **passerelle d'API Kong** et la configuration Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **PostgreSQL 15** comme seul moteur pris en charge (`Supabase_GKE` l'exécute dans l'espace de noms, pas sur Cloud SQL) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` du premier déploiement qui définit les mots de passe des rôles de service Supabase et crée les schémas et droits Supabase | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` (`name_suffix = "storage"`) | Sortie `storage_buckets` |
| Configuration de Kong | Définit l'environnement Kong de référence (mode DB-less, chemin de la configuration déclarative, ports de routage, paramètres des tampons du proxy) | Comportement de l'application dans le guide de la plateforme |
| Contrôles de santé | Déclare les valeurs par défaut des variables `startup_probe`/`liveness_probe` (HTTP `/health`) — qui ne correspondent pas à ce qui est réellement déployé ; `Supabase_GKE` remplace les deux par des sondes TCP | §5 ci-dessous et §Observabilité dans le guide de la plateforme |

---

## 2. Identifiants JWT dans Secret Manager {#2-jwt-credentials-in-secret-manager}

L'authentification Supabase repose sur des JWT signés par un secret partagé. Cette
couche stocke six secrets dans Secret Manager :

| Suffixe du secret | Contenu | Généré automatiquement ? |
|---|---|---|
| `-jwt-secret` | Secret de signature JWT de 32 caractères | Oui — aléatoire si `jwt_secret` est vide |
| `-anon-key` | JWT anonyme public | Non — valeur provisoire ; **doit être remplacée** |
| `-service-role-key` | JWT du rôle de service | Non — valeur provisoire ; **doit être remplacée** |
| `-publishable-key` | Clé d'API opaque publishable (anon) | Non — valeur provisoire si vide |
| `-secret-key` | Clé d'API opaque côté serveur | Non — valeur provisoire si vide |
| `-key-base` | `secret_key_base` de 64 caractères pour Realtime/Supavisor | Oui — aléatoire si `secret_key_base` est vide |

L'anon key et la service role key sont des valeurs provisoires au premier
déploiement. Remplacez-les par des JWT valides signés avec le `jwt_secret` :

```bash
# 1. Retrieve the auto-generated JWT signing secret:
gcloud secrets versions access latest --secret="<prefix>-jwt-secret" --project "$PROJECT"

# 2. Generate JWTs at https://jwt.io or https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
#    Anon payload:         { "role": "anon",         "iss": "supabase" }
#    Service role payload: { "role": "service_role", "iss": "supabase" }

# 3. Upload the anon JWT:
echo -n "<anon-jwt>" | gcloud secrets versions add "<prefix>-anon-key" \
  --data-file=- --project "$PROJECT"

# 4. Upload the service role JWT:
echo -n "<service-role-jwt>" | gcloud secrets versions add "<prefix>-service-role-key" \
  --data-file=- --project "$PROJECT"

# 5. Restart the Kong pod to pick up the updated secrets:
kubectl rollout restart deploy/<kong-workload> -n "<namespace>"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Supabase requiert **PostgreSQL 15** ; le moteur est imposé et aucune autre base de
données n'est prise en charge. La configuration Common déclare
`database_type = "POSTGRES_15"`, mais `Supabase_GKE` la remplace par `"NONE"` sur le
socle et exécute à la place l'image `supabase/postgres` comme service dans l'espace de
noms — il n'y a donc ni instance Cloud SQL ni Auth Proxy dans un Supabase déployé.

Lors du premier déploiement, un job ponctuel `db-init` se connecte à ce Postgres
de l'espace de noms en tant que `supabase_admin` et, de manière idempotente :

1. définit des mots de passe LOGIN sur les rôles de service que l'image
   `supabase/postgres` crée mais laisse sans mot de passe (`authenticator`,
   `supabase_auth_admin`, `supabase_storage_admin`),
2. crée les schémas `auth`, `storage`, `_realtime` et `realtime`, ainsi que les droits
   et privilèges par défaut du schéma `public` pour `anon`, `authenticated` et
   `service_role`,
3. définit au niveau de la base de données les GUC `app.settings.jwt_secret` /
   `jwt_exp` utilisés par RLS.

Le job utilise l'image `mirror.gcr.io/library/postgres:15-alpine` (pour `psql`) et
exécute `scripts/db-init.sh`. Il peut être relancé sans risque. Inspectez
directement la base de données :

```bash
kubectl exec -n "<namespace>" deploy/<postgres-workload> -- psql -U supabase_admin -d postgres
```

L'espace de noms et les noms des services figurent dans les sorties du déploiement de
la plateforme.

---

## 4. Configuration de la passerelle d'API Kong {#4-kong-api-gateway-configuration}

`Supabase_Common` configure Kong pour fonctionner en **mode déclaratif (DB-less)**.
Tout le routage est défini dans un fichier `kong.yml` intégré à l'image du conteneur
Kong par le `Dockerfile` de `scripts/`. Aucune base de données Kong n'est provisionnée
ni requise.

Principales variables d'environnement Kong définies par cette couche :

| Variable | Valeur | Rôle |
|---|---|---|
| `KONG_DATABASE` | `off` | Mode déclaratif DB-less |
| `KONG_DECLARATIVE_CONFIG` | `/home/kong/kong.yml` | Chemin de la configuration de routage |
| `KONG_PLUGINS` | `request-transformer,cors,key-auth,acl` | Plugins actifs |
| `KONG_PROXY_LISTEN` | `0.0.0.0:8000` | Port public du proxy HTTP |
| `KONG_ADMIN_LISTEN` | `0.0.0.0:8001` | Port de l'API d'administration |
| `SUPABASE_PORT` | `8000` | Port d'écoute de Kong (référencé par les services Supabase) |

Kong achemine les requêtes vers les microservices selon le préfixe de chemin défini
dans `kong.yml` :

| Préfixe de chemin | Service cible | Port |
|---|---|---|
| `/auth/v1/*` | GoTrue (authentification) | 9999 |
| `/rest/v1/*` | PostgREST (API REST) | 3000 |
| `/realtime/v1/*` | Realtime (WebSocket) | 4000 |
| `/storage/v1/*` | API Storage | 5000 |

Les variables de configuration des URL (`site_url`, `api_external_url`,
`supabase_public_url`, `jwt_expiry`, `pgrst_db_schemas`) sont injectées dans
l'environnement du conteneur Kong afin que GoTrue et PostgREST reçoivent les bonnes
adresses externes. Remplacez-les par de vraies URL publiques avant une utilisation en
production — les valeurs par défaut localhost empêchent les flux OAuth de fonctionner
en dehors du cluster.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les variables `startup_probe`/`liveness_probe` déclarées ici ont pour valeur par
défaut HTTP `/health` :

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échecs |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/health` | 30 s | 10 s | 18 |
| Vivacité | HTTP | `/health` | 60 s | 30 s | 3 |

**Ces valeurs par défaut ne sont jamais réellement déployées.** `kong.yml` est une
configuration déclarative DB-less qui ne définit des routes que pour `/rest/v1`,
`/auth/v1`, `/realtime/v1`, `/storage/v1`, `/pg` et `/` (Studio) — il n'existe pas de
route `/health`, si bien qu'une sonde HTTP sur ce chemin renverrait une 404.
`Supabase_GKE/main.tf` remplace inconditionnellement les deux sondes par des sondes
**TCP** sur le port du conteneur Kong dans sa fusion `supabase_module`, quelle que soit
la valeur transmise pour ces variables. Considérez cette section comme une
documentation de la forme de la variable uniquement, et non du comportement des sondes
que vous observerez sur une instance déployée — consultez
`docs/modules/Supabase_GKE.md` pour ce qui est réellement appliqué.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** avec le suffixe `-storage` est déclaré ici et provisionné
par le socle, qui accorde également l'accès au compte de service de la charge de
travail. Les téléversements de fichiers Supabase transitent par le microservice API
Storage jusqu'à ce bucket. La prévention de l'accès public est définie sur
`inherited` afin que des objets individuels puissent être servis publiquement via des
ACL au niveau du bucket si nécessaire. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration de Supabase destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez le
guide de la plateforme : **[Supabase_GKE](Supabase_GKE.md)**. Pour la couche
d'infrastructure qui exécute la charge de travail, consultez **[App_GKE](App_GKE.md)**
et **[App_Common](App_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Supabase sur GKE Autopilot](Supabase_GKE.md) — cette configuration déployée sur GKE.
