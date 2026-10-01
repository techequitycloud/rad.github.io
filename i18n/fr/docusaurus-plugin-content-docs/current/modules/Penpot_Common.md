---
title: "Module de configuration partagée Penpot Common"
description: "Référence de la configuration partagée du module Penpot — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Penpot_Common.md @ 3055034 sha256:6f786c078ddc -->

# Module de configuration partagée Penpot Common {#penpot-common-shared-configuration-module}

Le module `Penpot Common` définit la configuration de la plateforme de design Penpot pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration presque pur** — sa seule ressource GCP est le secret Secret Manager `PENPOT_SECRET_KEY` généré automatiquement ; tout le reste est une sortie `config` utilisée par les modules wrapper propres à chaque plateforme (`Penpot CloudRun` et `Penpot GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Penpot (architecture multi-services, configuration de la base de données PostgreSQL 15, assemblage des variables d'environnement, configuration des sondes de santé, stockage des ressources sur GCS et paramètres pub/sub WebSocket) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Penpot_CloudRun  ──┐
└── Penpot_GKE       ──┤── instantiate Penpot_Common
                       ↓
          Penpot_Common (this module)
          Creates: PENPOT_SECRET_KEY (Secret Manager)
          Produces: config, storage_buckets, secret_ids, secret_values, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- Utilise **PostgreSQL 15** — contrairement à Ghost (MySQL 8.0), Penpot s'appuie sur PostgreSQL pour tous les déploiements. Le type de base de données est fixe et ne peut pas être remplacé.
- Crée **un secret Secret Manager** — une `PENPOT_SECRET_KEY` générée automatiquement (clé de signature JWT partagée par le backend et l'exporter), exposée via les sorties `secret_ids` / `secret_values`. Aucune autre ressource GCP n'est créée.
- Définit le **service backend** (API HTTP Clojure + serveur WebSocket sur le port 6060). Le frontend (SPA React servie par nginx sur le port 8080) et l'exporter (Chromium headless pour l'export PDF/PNG/SVG) sont assemblés par les modules wrapper — voir §4.
- Les wrappers définissent `container_protocol` à **`"http1"`** par défaut — les WebSockets fonctionnent via le mécanisme Upgrade de HTTP/1.1 ; `h2c` casse le frontend nginx HTTP/1.1 de Penpot (502 "protocol error").
- Penpot exécute ses **propres migrations de schéma au démarrage** ; `Penpot Common` fournit un job `db-init` intégré qui crée la base de données et l'utilisateur PostgreSQL avant le premier démarrage.
- Assemble `PENPOT_FLAGS`, `PENPOT_STORAGE_BACKEND`, `PENPOT_STORAGE_GCS_BUCKET_NAME`, `PENPOT_REDIS_URI`, `JVM_OPTS` et les variables SMTP à partir des variables d'entrée du module, produisant un environnement cohérent que le wrapper cible Cloud Run ou GKE.

---

## 2. Sorties {#2-outputs}

### `config` {#config}

L'objet de configuration applicative transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"penpot"` |
| `application_version` | Tag de version (par défaut : `"latest"`) |
| `container_image` | `"penpotapp/backend"` — image officielle du backend Penpot provenant de Docker Hub |
| `image_source` | `"prebuilt"` — les images officielles de Penpot sont utilisées directement ; aucune étape de build personnalisée |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) — copie les trois images dans Artifact Registry |
| `container_port` | `6060` — port de l'API HTTP et des WebSockets du backend Penpot |
| `database_type` | `"POSTGRES_15"` — Penpot nécessite PostgreSQL 15 |
| `db_name` | Nom de la base de données (par défaut : `"penpot"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"penpot"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter le sidecar Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU : `2000m`, mémoire : `2Gi` (par défaut) — la JVM exige plus de mémoire que les applications classiques en langage interprété |
| `environment_variables` | Variables d'environnement Penpot assemblées — voir §7 |
| `additional_services` | `[]` — le frontend et l'exporter sont assemblés par les modules wrapper, pas ici (voir §4) |
| `startup_probe` | `var.startup_probe` (valeur par défaut du module : HTTP `/api/health`) — les deux wrappers la remplacent par TCP ; voir §5 |
| `liveness_probe` | `var.liveness_probe` (valeur par défaut du module : HTTP `/api/health`) — remplacée selon la plateforme (Cloud Run : désactivée ; GKE : TCP) ; voir §5 |

### `storage_buckets` {#storage_buckets}

Une liste de configurations de buckets GCS à provisionner par le module de plateforme :

| Champ | Valeur |
|---|---|
| `name_suffix` | `"assets"` — le module de plateforme en déduit le nom complet du bucket (`gcs-<service-name>-assets`) |
| `location` | Région du déploiement |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

### `secret_ids` / `secret_values` {#secret_ids--secret_values}

`secret_ids` associe `PENPOT_SECRET_KEY` à l'ID du secret Secret Manager
(`secret-<prefix>-penpot-key`) pour l'injecter en tant que variable d'environnement secrète ; `secret_values`
(sensible) expose la valeur générée elle-même.

### `path` {#path}

Le chemin absolu du répertoire du module, utilisé par les modules wrapper pour localiser le répertoire `scripts/`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"penpot"` | Nom de l'application |
| `application_version` | `string` | `"latest"` | Tag d'image Docker de Penpot appliqué aux trois images de service |
| `description` | `string` | `"Penpot is an open-source design and prototyping tool"` | Description de l'application |
| `db_name` | `string` | `"penpot"` | Nom de la base de données PostgreSQL |
| `db_user` | `string` | `"penpot"` | Utilisateur applicatif PostgreSQL |
| `cpu_limit` | `string` | `"2000m"` | Limite CPU du conteneur backend |
| `memory_limit` | `string` | `"2Gi"` | Limite mémoire du conteneur backend |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances backend. Définissez 1 ou plus — la mise à l'échelle à zéro interrompt les sessions WebSocket actives. |
| `max_instance_count` | `number` | `3` | Nombre maximal d'instances backend |
| `enable_image_mirroring` | `bool` | `true` | Copie toutes les images Penpot dans Artifact Registry |
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket du sidecar Cloud SQL Auth Proxy |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires fusionnées dans le conteneur backend |
| `initialization_jobs` | `list(any)` | `[]` | Jobs d'initialisation personnalisés. Laissez vide pour utiliser le job `db-init` intégré (qui crée la base de données et l'utilisateur PostgreSQL) ; Penpot exécute ses propres migrations de schéma au démarrage. |

### Configuration de Penpot {#penpot-configuration}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `penpot_flags` | `string` | `"enable-registration enable-login disable-demo-users"` | Flags de fonctionnalités Penpot séparés par des espaces, transmis via `PENPOT_FLAGS` |
| `public_uri` | `string` | `""` | URL publique par laquelle les utilisateurs accèdent à Penpot. Définit `PENPOT_PUBLIC_URI`. Détectée automatiquement à partir de l'URL du service frontend si vide. |
| `jvm_max_heap` | `string` | `"1g"` | Taille maximale du tas de la JVM. Définit `-Xmx` dans `JVM_OPTS`. |
| `jvm_min_heap` | `string` | `"512m"` | Taille initiale du tas de la JVM. Définit `-Xms` dans `JVM_OPTS`. |

### Redis {#redis}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `redis_host` | `string` | `null` | Nom d'hôte ou adresse IP de Redis pour le bus pub/sub WebSocket. Par défaut, l'adresse IP du serveur NFS si null. |
| `redis_port` | `string` | `"6379"` | Port Redis |
| `redis_auth` | `string` | `""` | Mot de passe AUTH de Redis (sensible) |
| `nfs_server_ip` | `string` | `null` | Adresse IP du serveur NFS utilisée en repli lorsque `redis_host` est null |

### SMTP {#smtp}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_enabled` | `bool` | `false` | Active SMTP. Requis pour les invitations et les réinitialisations de mot de passe. |
| `smtp_from` | `string` | `""` | Adresse e-mail d'expéditeur par défaut |
| `smtp_reply_to` | `string` | `""` | Adresse de réponse par défaut |
| `smtp_host` | `string` | `""` | Nom d'hôte du serveur SMTP |
| `smtp_port` | `number` | `587` | Port SMTP |
| `smtp_username` | `string` | `""` | Nom d'utilisateur d'authentification SMTP |
| `smtp_use_tls` | `bool` | `true` | Active STARTTLS |
| `smtp_use_ssl` | `bool` | `false` | Active SSL/TLS |

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse (name, bucket_name, mount_path, readonly, mount_options) |
| `startup_probe` | `object` | Voir §5 | Configuration de la sonde de démarrage |
| `liveness_probe` | `object` | Voir §5 | Configuration de la sonde de vivacité |

---

## 4. Architecture multi-services {#4-multi-service-architecture}

Penpot est une application à trois niveaux. `Penpot Common` ne définit que le backend ; les modules
wrapper assemblent les deux autres niveaux. Sur Cloud Run, les trois s'exécutent comme **un seul service
multi-conteneurs** — le frontend est le conteneur d'entrée, et le backend et l'exporter sont des sidecars
du même pod joints via localhost. Sur GKE, le frontend et l'exporter sont déployés comme services
supplémentaires distincts aux côtés du backend.

### Backend (`penpotapp/backend`) {#backend-penpotappbackend}

- **Image** : `penpotapp/backend:<version>`
- **Port** : `6060`
- **Protocole** : HTTP/1.1 (`http1`) — les WebSockets utilisent le mécanisme Upgrade de HTTP/1.1
- **Rôle** : serveur d'API HTTP Clojure, gestionnaire WebSocket pour la collaboration en temps réel, interface avec la base de données, gestion des ressources via GCS
- **Environnement** : reçoit toutes les variables d'environnement Penpot assemblées (voir §7)
- **Auth Proxy** : sidecar Cloud SQL Auth Proxy pour la connectivité PostgreSQL
- **Migrations** : exécutées automatiquement au démarrage — aucun job d'initialisation distinct n'est requis

### Frontend (`penpotapp/frontend`) {#frontend-penpotappfrontend}

- **Image** : `penpotapp/frontend:<version>`
- **Port** : `8080` (le nginx du frontend de Penpot écoute sur 8080, pas sur 80)
- **Rôle** : serveur nginx délivrant la SPA React aux navigateurs des designers. Toute l'édition des designs se fait côté client dans le navigateur ; le backend gère la persistance et la synchronisation en temps réel.
- **URL** : `PENPOT_PUBLIC_URI` est définie sur l'URL de ce service. Les utilisateurs accèdent à Penpot via le frontend, dont le nginx relaie `/api` et `/ws` vers le backend. Sur Cloud Run, le frontend est le conteneur d'entrée, de sorte que l'URL du frontend **est** l'URL du service principal.

### Exporter (`penpotapp/exporter`) {#exporter-penpotappexporter}

- **Image** : `penpotapp/exporter:<version>`
- **Port** : `6061`
- **Rôle** : instance Chromium headless qui effectue le rendu des designs Penpot et les exporte en PDF, PNG ou SVG. Appelée par le backend lorsqu'un designer déclenche une opération d'export. Partage le secret JWT `PENPOT_SECRET_KEY` avec le backend.
- **Ressources** : Chromium headless est gourmand en ressources ; le service exporter est dimensionné indépendamment du backend.

---

## 5. Sondes de santé {#5-health-probes}

Penpot 2.x n'expose **pas** de point de terminaison de santé HTTP non authentifié — `/api/health` renvoie
404 sur le backend (le véritable chemin de disponibilité est `/readyz`). Les deux wrappers utilisent donc par défaut
des **sondes TCP sur le port du backend (6060)**, qui réussissent dès que la JVM est à l'écoute. Les valeurs par défaut
des variables `startup_probe`/`liveness_probe` du module conservent la forme HTTP `/api/health`,
mais chaque wrapper remplace le type de sonde par TCP.

### Sondes Cloud Run (depuis le variables.tf de `Penpot_CloudRun`) {#cloud-run-probes-from-penpot_cloudrun-variablestf}

Cloud Run ne prend pas en charge les sondes de vivacité TCP. La sonde de démarrage utilise TCP pour vérifier que la JVM est à l'écoute avant de tenter des contrôles de santé HTTP.

| Sonde | Type | Port / Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|---|---|
| **Startup** | TCP | 6060 | 5s | 5s | 5s | 40 | Autorise jusqu'à 200s au total pour l'initialisation de la JVM + la migration PostgreSQL. TCP confirme que le port est ouvert. |
| **Liveness** | — | (désactivée) | — | — | — | — | Vivacité TCP non prise en charge par Cloud Run. Utilisez plutôt `health_check_config`. |
| **startup_probe_config** | TCP | — | 0s | 240s | 240s | 1 | Sonde alternative pour les contrôles de santé de l'équilibreur de charge. |
| **health_check_config** | HTTP | `/api/health` | 0s | 1s | 10s | 3 | Contrôle de vivacité HTTP une fois le backend prêt. |

### Sondes GKE (depuis le variables.tf de `Penpot_GKE`) {#gke-probes-from-penpot_gke-variablestf}

Sur GKE, les deux sondes sont des **sondes TCP sur le port 6060** — une sonde HTTP sur `/api/health` renverrait 404 et
ferait redémarrer en boucle un backend pourtant sain.

| Sonde | Type | Port | Délai initial | Délai d'expiration | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|---|---|
| **Startup** | TCP | 6060 | 30s | 10s | 10s | 30 | Autorise 30s de délai initial + 30 × 10s = 330s au total pour la JVM + les migrations. |
| **Liveness** | TCP | 6060 | 60s | 10s | 30s | 3 | Redémarre le pod si Penpot cesse d'écouter. |

Les seuils généreux de la sonde de démarrage tiennent compte du processus de migration de Penpot sur une base de données neuve, qui peut être lent lors du premier déploiement.

---

## 6. Secrets générés {#6-secrets-generated}

Comme Django Common (qui génère une `SECRET_KEY`), **`Penpot Common` génère un
secret applicatif** : `PENPOT_SECRET_KEY`, une valeur aléatoire de 64 caractères stockée dans Secret
Manager sous le nom `secret-<prefix>-penpot-key`. Il s'agit de la clé de signature JWT partagée utilisée par le backend
et l'exporter ; elle est exposée aux wrappers via la sortie `secret_ids` (injectée en tant que
variable d'environnement secrète) et la sortie sensible `secret_values`.

Le secret `DB_PASSWORD` est provisionné automatiquement par `App CloudRun` / `App GKE` et est injecté dans le conteneur backend sous le nom `DB_PASSWORD`. Le wrapper shell du point d'entrée du backend le mappe sur `PENPOT_DATABASE_PASSWORD` au démarrage du conteneur.

Si une authentification SMTP est requise, le mot de passe SMTP doit être fourni via `secret_environment_variables` dans le module wrapper — `Penpot Common` ne le provisionne pas.

---

## 7. Assemblage des variables d'environnement {#7-environment-variable-assembly}

`Penpot Common` assemble les variables d'environnement suivantes et les transmet au module de plateforme via `config.environment_variables`. Elles sont injectées dans le conteneur backend de Penpot à l'exécution.

### Variables Penpot principales {#core-penpot-variables}

| Variable d'environnement | Source | Description |
|---|---|---|
| `PENPOT_FLAGS` | `var.penpot_flags` | Flags de fonctionnalités séparés par des espaces contrôlant l'inscription, la connexion et les fonctionnalités facultatives |
| `PENPOT_PUBLIC_URI` | `var.public_uri` (ou détectée automatiquement) | L'URL par laquelle les utilisateurs accèdent à Penpot. Utilisée dans les e-mails d'invitation et le routage WebSocket. Doit correspondre à l'URL réelle du frontend. |
| `PENPOT_TELEMETRY_ENABLED` | `"false"` | Télémétrie désactivée par défaut pour les déploiements auto-hébergés |
| `PENPOT_HTTP_SERVER_HOST` | `"0.0.0.0"` | Écoute sur toutes les interfaces — requis pour le réseau des conteneurs Cloud Run et GKE |
| `PENPOT_HTTP_SERVER_PORT` | `"6060"` | Doit correspondre à `container_port` |

### Variables de base de données {#database-variables}

| Variable d'environnement | Source | Description |
|---|---|---|
| `PENPOT_DATABASE_URI` | Construite au démarrage du conteneur à partir de `DB_IP`, `DB_NAME` | Le wrapper shell du point d'entrée exporte `postgresql://$DB_IP:5432/$DB_NAME` (TCP vers l'IP privée de l'instance) |
| `PENPOT_DATABASE_USERNAME` | `DB_USER` | Exportée par le wrapper shell du point d'entrée à partir de `DB_USER` injectée par la plateforme |
| `PENPOT_DATABASE_PASSWORD` | `DB_PASSWORD` (depuis Secret Manager) | Exportée par le wrapper shell du point d'entrée à partir du secret injecté par la plateforme |

### Variables de stockage {#storage-variables}

| Variable d'environnement | Source | Description |
|---|---|---|
| `PENPOT_STORAGE_BACKEND` | `"gcs"` | Indique au backend d'utiliser Google Cloud Storage pour la persistance des ressources |
| `PENPOT_STORAGE_GCS_BUCKET_NAME` | Définie automatiquement à `gcs-<service-name>-assets` | Le bucket de ressources provisionné à partir de la sortie `storage_buckets` de `Penpot Common` |

### Variables Redis {#redis-variables}

| Variable d'environnement | Source | Description |
|---|---|---|
| `PENPOT_REDIS_URI` | Assemblée à partir de `redis_host`:`redis_port` (valeur par défaut calculée par Terraform), puis réexportée par le wrapper shell du point d'entrée | URI du bus d'événements pub/sub WebSocket. Format : `redis://HOST:PORT/0`. La valeur par défaut côté Terraform se rabat sur `nfs_server_ip` (ou l'espace réservé `$(NFS_SERVER_IP)`) lorsque `redis_host` est vide, principalement pour que les services supplémentaires puissent la référencer. Au démarrage du conteneur, le wrapper shell du point d'entrée réexporte `PENPOT_REDIS_URI` à partir des variables d'environnement réelles `NFS_SERVER_IP` (avec repli sur `REDIS_HOST`) et `REDIS_PORT`, ce qui prime sur la valeur Terraform statique. |

### Variables JVM {#jvm-variables}

| Variable d'environnement | Source | Description |
|---|---|---|
| `JVM_OPTS` | Assemblée à partir de `jvm_min_heap`, `jvm_max_heap` | Définit `-Xms` (tas initial) et `-Xmx` (tas maximal). Par défaut : `"-Xmx1g -Xms512m"`. |

### Variables SMTP (lorsque `smtp_enabled = true`) {#smtp-variables-when-smtp_enabled--true}

| Variable d'environnement | Source | Description |
|---|---|---|
| `PENPOT_SMTP_ENABLED` | `"true"` lorsque `smtp_enabled = true` | Active l'envoi d'e-mails sortants |
| `PENPOT_SMTP_DEFAULT_FROM` | `var.smtp_from` | Adresse d'expéditeur par défaut |
| `PENPOT_SMTP_DEFAULT_REPLY_TO` | `var.smtp_reply_to` | Adresse de réponse par défaut |
| `PENPOT_SMTP_HOST` | `var.smtp_host` | Nom d'hôte du serveur SMTP |
| `PENPOT_SMTP_PORT` | `var.smtp_port` | Port SMTP (nombre, converti en chaîne) |
| `PENPOT_SMTP_USERNAME` | `var.smtp_username` | Nom d'utilisateur d'authentification SMTP |
| `PENPOT_SMTP_USE_TLS` | `var.smtp_use_tls` | Flag STARTTLS |
| `PENPOT_SMTP_USE_SSL` | `var.smtp_use_ssl` | Flag SSL/TLS |

Lorsque `smtp_enabled = false`, aucune des variables `PENPOT_SMTP_*` n'est injectée, et Penpot fonctionne sans envoi d'e-mails sortants.

---

## 8. Différences propres à chaque plateforme {#8-platform-specific-differences}

| Aspect | Penpot CloudRun | Penpot GKE |
|---|---|---|
| **Type de sonde de démarrage** | TCP (port 6060) — Cloud Run ne prend pas en charge la vivacité TCP, seulement le démarrage TCP | TCP (port 6060) — `/api/health` renvoie 404 sur le backend, les sondes HTTP ne sont donc pas utilisées |
| **Sonde de vivacité** | Désactivée — Cloud Run ne prend pas en charge les sondes de vivacité TCP ; `health_check_config` est utilisé à la place | TCP (port 6060) — délai initial de 60s, période de 30s |
| **`min_instance_count`** | `0` (par défaut, configurable par l'utilisateur) — définissez `1` ou plus pour garder actives les sessions WebSocket | `1` (par défaut, configurable par l'utilisateur) — pas de mise à l'échelle à zéro en production |
| **`container_protocol`** | `"http1"` — les WebSockets fonctionnent via le mécanisme Upgrade de HTTP/1.1 ; `h2c` casse le frontend nginx HTTP/1.1 (502 "protocol error") | `"http1"` (par défaut) — HTTP/1.1 standard vers les pods |
| **`session_affinity`** | Sans objet sur Cloud Run (équilibrage de charge géré) | `"ClientIP"` par défaut — important pour la stabilité des WebSockets de Penpot ; achemine les clients récurrents vers le même pod |
| **`PENPOT_PUBLIC_URI`** | Définie sur l'URL prévue du service Cloud Run frontend (à partir de l'ID de déploiement et de la convention de nommage du projet) | Doit être définie explicitement via `environment_variables` sur GKE — aucune détection automatique équivalente |
| **`DB_HOST`** | Chemin du socket Cloud SQL Auth Proxy (`/cloudsql/...`) | Adresse IP privée de Cloud SQL |
| **`enable_nfs`** | `true` (par défaut) — le serveur NFS sert aussi d'hôte Redis de repli | `true` (par défaut) — même schéma de repli Redis sur NFS |
| **Source de l'image** | `"prebuilt"` — images officielles de Penpot sur Docker Hub, copiées dans Artifact Registry | `"prebuilt"` — identique |
| **Services supplémentaires** | Aucun — un seul service multi-conteneurs : le frontend est le conteneur d'entrée, le backend et l'exporter sont des sidecars du même pod sur localhost | Frontend et exporter en tant que services supplémentaires de type Deployment GKE |

---

## 9. Référence des flags de fonctionnalités Penpot {#9-penpot-feature-flags-reference}

La variable `penpot_flags` accepte une liste de flags séparés par des espaces. Ils sont transmis directement au backend via la variable d'environnement `PENPOT_FLAGS`. Les flags les plus couramment utilisés :

| Flag | Effet |
|---|---|
| `enable-registration` | Autorise les nouveaux utilisateurs à s'inscrire eux-mêmes. Adapté aux déploiements ouverts ou internes à une équipe. |
| `disable-registration` | Bloque l'inscription libre. Les administrateurs doivent inviter les utilisateurs par e-mail. À utiliser pour les déploiements réservés à une équipe ou à un client. |
| `enable-login-with-password` | Autorise la connexion par e-mail et mot de passe (méthode d'authentification par défaut). |
| `enable-oidc-google` | Active la connexion SSO OIDC via Google OAuth. Nécessite la configuration d'identifiants client OIDC. |
| `enable-oidc-github` | Active la connexion SSO OIDC via GitHub OAuth. |
| `disable-demo-users` | Empêche la création de comptes de démonstration/invités. Recommandé en production. |
| `enable-webhooks` | Active les rappels webhook pour les événements de design. |
| `enable-email-verification` | Exige que les nouveaux utilisateurs vérifient leur adresse e-mail avant d'accéder à la plateforme. |

Les flags sont cumulatifs et séparés par des espaces. La valeur par défaut `"enable-registration enable-login disable-demo-users"` convient à la configuration initiale. Pour un déploiement réservé à une équipe :

```
penpot_flags = "disable-registration enable-login-with-password disable-demo-users enable-email-verification"
```

Pour un déploiement en SSO uniquement (sans connexion par mot de passe) :

```
penpot_flags = "disable-registration enable-oidc-google disable-demo-users"
```

---

## 10. Modèle d'implémentation {#10-implementation-pattern}

L'exemple suivant montre comment `Penpot_CloudRun` instancie `Penpot_Common` et transmet ses sorties à `App_CloudRun` :

```hcl
# Penpot_CloudRun calls Penpot_Common for application config
module "penpot_app" {
  source = "../Penpot_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  penpot_flags           = var.penpot_flags
  jvm_max_heap           = var.jvm_max_heap
  jvm_min_heap           = var.jvm_min_heap
  smtp_enabled           = var.smtp_enabled
  smtp_host              = var.smtp_host
  smtp_port              = var.smtp_port
  smtp_from              = var.smtp_from
  smtp_reply_to          = var.smtp_reply_to
  smtp_username          = var.smtp_username
  smtp_use_tls           = var.smtp_use_tls
  smtp_use_ssl           = var.smtp_use_ssl
  enable_cloudsql_volume = var.enable_cloudsql_volume
  enable_image_mirroring = var.enable_image_mirroring
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
}

# Assemble the four locals the Foundation Module consumes
locals {
  application_modules    = { penpot = module.penpot_app.config }
  module_env_vars        = { REDIS_HOST = var.redis_host }
  module_secret_env_vars = module.penpot_app.secret_ids  # PENPOT_SECRET_KEY
  module_storage_buckets = module.penpot_app.storage_buckets
  scripts_dir            = abspath("${module.penpot_app.path}/scripts")
}

# Pass assembled config to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_modules    = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... all other variables passed through
}
```

---

## 11. Explorer avec la console GCP {#11-exploring-with-the-gcp-console}

`Penpot Common` ne crée directement que le secret `PENPOT_SECRET_KEY`. Après le déploiement, les autres ressources qu'il définit (le bucket GCS `gcs-<service-name>-assets`, les variables d'environnement du backend) sont visibles à travers l'infrastructure du module wrapper.

**Vérifier le bucket de ressources :**

Accédez à **Cloud Storage → Buckets** et recherchez `assets` (le bucket s'appelle `gcs-<service-name>-assets`). Vérifiez que :
- Le bucket existe dans la région attendue.
- Le contrôle d'accès est uniforme au niveau du bucket (`public_access_prevention = "inherited"`).
- Le compte de service Cloud Run ou le compte de service Workload Identity de GKE dispose de `roles/storage.objectAdmin` dans la stratégie IAM du bucket.

**Vérifier l'environnement du backend :**

Accédez à **Cloud Run** (ou **GKE → Workloads** pour la variante GKE), sélectionnez le service backend de Penpot et cliquez sur **Edit & Deploy New Revision** (inutile d'enregistrer). Dans l'onglet **Container**, faites défiler jusqu'à **Variables & Secrets** pour vérifier que :

- `PENPOT_FLAGS` est correctement définie.
- `PENPOT_STORAGE_BACKEND` vaut `gcs`.
- `PENPOT_STORAGE_GCS_BUCKET_NAME` pointe vers le bon bucket.
- `PENPOT_REDIS_URI` pointe vers l'hôte Redis attendu.
- `JVM_OPTS` contient les valeurs `-Xmx` et `-Xms` attendues.
- `PENPOT_SMTP_ENABLED` vaut `true` si SMTP a été configuré.

**Vérifier le point de terminaison de santé :**

Une fois le backend déployé, son point de terminaison `/readyz` renvoie HTTP 200 lorsque l'application est
prête (remarque : `/api/health` renvoie 404 — Penpot 2.x ne possède pas ce chemin). Depuis Cloud Shell ou une
machine ayant accès à l'URL du service :

```bash
curl -o /dev/null -s -w "%{http_code}\n" https://BACKEND_SERVICE_URL/readyz
```

Une réponse `200` confirme que le backend a terminé les migrations PostgreSQL et est prêt à traiter les requêtes.

---

## 12. Explorer avec gcloud {#12-exploring-with-gcloud}

Les commandes suivantes permettent de vérifier ce que `Penpot Common` a assemblé et de confirmer que le bucket de ressources est correctement configuré.

**Vérifier que le bucket de ressources existe et se trouve dans la bonne région :**
```bash
gcloud storage buckets describe gs://gcs-SERVICE_NAME-assets \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"
```

**Vérifier la stratégie IAM du bucket de ressources :**
```bash
gcloud storage buckets get-iam-policy gs://gcs-SERVICE_NAME-assets \
  --format="table(bindings.role,bindings.members)"
```

**Vérifier l'environnement du service Cloud Run backend (contrôler PENPOT_FLAGS, JVM_OPTS, PENPOT_STORAGE_BACKEND) :**
```bash
gcloud run services describe SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Vérifier que PENPOT_REDIS_URI est correctement définie dans la révision en cours :**
```bash
gcloud run revisions describe REVISION_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="json" | \
  python3 -c "import sys,json; [print(e['name'],'=',e.get('value','[secret]')) for e in json.load(sys.stdin)['spec']['containers'][0]['env'] if 'PENPOT' in e['name'] or 'JVM' in e['name']]"
```

**Lister tous les objets du bucket de ressources (miniatures de designs et fichiers téléversés) :**
```bash
gcloud storage ls gs://gcs-SERVICE_NAME-assets --recursive | head -50
```

**Vérifier la taille du bucket de ressources (utile pour estimer sa croissance) :**
```bash
gcloud storage du gs://gcs-SERVICE_NAME-assets --summarize
```

**Confirmer que l'instance Cloud SQL PostgreSQL 15 est en cours d'exécution :**
```bash
gcloud sql instances list \
  --project=PROJECT_ID \
  --filter="databaseVersion:POSTGRES_15" \
  --format="table(name,state,databaseVersion,region,settings.dataDiskSizeGb)"
```

**Vérifier que la base de données et l'utilisateur `penpot` existent :**
```bash
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,charset,collation)"

gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"
```

**Tester le point de terminaison `/readyz` depuis Cloud Shell :**
```bash
# Replace with the actual backend Cloud Run service URL
curl -s -o /dev/null -w "%{http_code}\n" https://BACKEND_URL/readyz
```

**Consulter Cloud Logging pour la sortie de démarrage et de migration du backend Penpot :**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="penpot-backend" AND textPayload:"migration"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Penpot sur Google Cloud Run](Penpot_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Penpot GKE — Guide de configuration](Penpot_GKE.md) — cette configuration déployée sur GKE.
