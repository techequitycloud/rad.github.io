---
title: "EvolutionAPI sur Google Cloud Run"
description: "Référence de configuration pour déployer EvolutionAPI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/EvolutionAPI_CloudRun.md @ 3055034 sha256:ef859c8a3060 -->

# EvolutionAPI sur Google Cloud Run {#evolutionapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EvolutionAPI_CloudRun.png" alt="EvolutionAPI sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Evolution API est une passerelle open source Node.js vers l'API WhatsApp Business
(construite sur la bibliothèque Baileys) qui provisionne des instances WhatsApp,
envoie et reçoit des messages, et expose une API REST ainsi qu'une interface de
gestion (manager) pour intégrer WhatsApp à d'autres systèmes. Ce module déploie
Evolution API sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Evolution API et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Evolution API s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; **épinglé à une seule instance toujours active** |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Evolution API utilise Prisma, uniquement avec PostgreSQL |
| Cache | Redis | **Activé par défaut** (`CACHE_REDIS_URI`) ; met en cache l'état des instances et des messages |
| Stockage objet | Cloud Storage | Un bucket de données dédié, provisionné automatiquement |
| Secrets | Secret Manager | `AUTHENTICATION_API_KEY` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (publique) ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; Evolution API utilise Prisma et ne prend pas en
  charge d'autres moteurs.
- **Le service est épinglé à une seule instance** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API conserve en mémoire, par instance, les
  sessions de socket WhatsApp (Baileys) actives ; ces sessions ne sont **pas**
  partagées entre réplicas, si bien que la mise à l'échelle horizontale fragmente les
  connexions actives et qu'une instance doit rester active. N'augmentez pas
  `max_instance_count`.
- **`AUTHENTICATION_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager. C'est la clé d'administration globale d'Evolution API, et elle ne doit
  **jamais faire l'objet d'une rotation après le premier démarrage** — la renouveler
  rend injoignables les instances WhatsApp déjà provisionnées et renvoie `401` à tout
  client qui détient encore l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide
  pour utiliser l'IP de la VM du serveur NFS comme point de terminaison Redis
  (nécessite `enable_nfs = true`), ou pointez-le vers une instance gérée explicite.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin
  que les systèmes externes puissent atteindre les points de terminaison de webhook
  et l'interface de gestion. Activer IAP bloque ces appels externes.
- **La mémoire est de 4 GiB par défaut** — Evolution API a besoin d'au moins 2 GiB
  pour fonctionner de manière fiable.
- **`SERVER_URL` prend par défaut l'URL réelle du service** à l'exécution, via le
  point d'entrée du conteneur, de sorte que les URL de QR code et de rappel de webhook
  reflètent l'adresse Cloud Run réelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Evolution API {#a-cloud-run--the-evolution-api-service}

Evolution API s'exécute comme un service Cloud Run v2 épinglé à une seule instance.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~evolutionapi"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Evolution API stocke toutes les données applicatives (instances WhatsApp, contacts,
conversations, historique des messages) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Au premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application ; les migrations Prisma créent ensuite le schéma au démarrage du
conteneur.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le
stockage de fichiers d'Evolution API. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache) {#d-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Evolution API l'utilise pour
mettre en cache les instances et les messages (`CACHE_REDIS_URI`, index de base Redis
`6`). Lorsque `redis_host` est laissé vide et que `enable_nfs = true`, l'IP de la VM
du serveur NFS sert de point de terminaison Redis ; le point d'entrée du conteneur
assemble l'URI à l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is set in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`AUTHENTICATION_API_KEY` — la clé d'API d'administration globale d'Evolution API,
injectée comme variable d'environnement secrète. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, ce qui permet l'accès public
nécessaire aux rappels de webhook WhatsApp et à l'interface de gestion. Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs. Le point d'entrée émet des marqueurs
`[cloud-entrypoint]` qui confirment au démarrage la configuration résolue de la base
de données, de Redis et de l'URL.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application EvolutionAPI {#3-evolutionapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le rôle
  `evolution`, accorde les privilèges et fait de l'utilisateur de l'application le
  propriétaire du schéma `public`. Le job peut être réexécuté sans risque.
- **Migrations Prisma au démarrage.** Evolution API exécute `prisma migrate deploy` à
  chaque démarrage du conteneur (via le script encapsulé `deploy_database.sh`), de
  sorte que la mise à niveau de la version de l'application applique les modifications
  de schéma sans étape de migration distincte. Le point d'entrée attend le socket
  Cloud SQL avant cette exécution et lance le script de migration comme sous-processus,
  afin qu'un échec transitoire ne puisse pas empêcher le serveur de démarrer.
- **`AUTHENTICATION_API_KEY` est immuable après le premier démarrage.** La clé
  d'administration globale est générée une seule fois et écrite dans Secret Manager.
  La renouveler rend injoignables toutes les instances WhatsApp déjà provisionnées et
  renvoie `401` à tout client qui détient encore l'ancienne clé. Ne la renouvelez que
  lors d'une migration planifiée.
- **Instance unique par conception.** Les sessions de socket WhatsApp (Baileys)
  résident dans la mémoire de l'instance et ne sont pas partagées entre réplicas.
  `min_instance_count = 1` en garde une active ; `max_instance_count = 1` évite de
  fragmenter les connexions actives. Ne procédez pas à une mise à l'échelle
  horizontale.
- **URL de rappel webhook / QR.** Le point d'entrée attribue par défaut à `SERVER_URL`
  la valeur injectée `CLOUDRUN_SERVICE_URL`, de sorte que les URL de QR code et de
  rappel de webhook utilisent l'adresse réelle du service. Vérifiez l'URL du service
  en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Configuration initiale.** Après le déploiement, récupérez
  `AUTHENTICATION_API_KEY` dans Secret Manager et utilisez-la (comme en-tête `apikey`)
  pour accéder à l'interface de gestion sur `/manager`, créez une instance WhatsApp
  (`POST /instance/create`), puis scannez le QR code renvoyé depuis WhatsApp sur votre
  téléphone pour connecter le numéro.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/` —
  un point de terminaison d'état non authentifié qui répond dès que le serveur est
  opérationnel. Prévoyez environ 7 minutes au premier démarrage (la sonde de démarrage
  accorde un délai initial de 60 secondes plus une fenêtre de 30 tentatives pendant
  les migrations Prisma).
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Evolution API ou notables pour elle
sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Evolution API` | Nom lisible affiché dans la console. |
| `application_version` | `v2.1.1` | Tag de l'image Evolution API. `latest` correspond à un `v2.1.1` épinglé dans l'argument de build. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; **2 GiB minimum** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Garde une instance active — les sockets WhatsApp sont conservés en mémoire. |
| `max_instance_count` | `1` | **Épinglé à 1.** Ne l'augmentez pas — les sessions ne sont pas partagées entre réplicas. |
| `container_port` | `8080` | Evolution API écoute sur le port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image `evoapicloud/evolution-api` dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les rappels de webhook publics et l'interface de gestion. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les rappels de webhook WhatsApp externes.** |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales `SERVER_*`, `DATABASE_*`, `CACHE_REDIS_*` et `AUTHENTICATION_*` sont définies automatiquement — ne définissez pas `AUTHENTICATION_API_KEY` ni `DATABASE_CONNECTION_URI` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne une instance NFS Filestore ; place également le point de terminaison Redis sur la VM du serveur NFS lorsque `redis_host` est laissé vide (voir le groupe 21). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `evolution` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `evolution` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay, 30 retries | Premier démarrage lent (migrations Prisma) ; prévoyez environ 7 minutes. |
| `liveness_probe` | HTTP `/` 60s delay | Sonde de vivacité sur le point de terminaison d'état racine. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active le cache Redis d'Evolution API (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `redis_port`/`backup_retention_days` hors plage, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, une mémoire inférieure au plancher gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (généré automatiquement) | Ne jamais la renouveler après le premier démarrage | Critical | La renouveler rend injoignable chaque instance WhatsApp déjà provisionnée et renvoie `401` à tous les clients qui détiennent l'ancienne clé. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit tout l'historique des messages. |
| `max_instance_count` | `1` | Critical | La mise à l'échelle horizontale fragmente les sessions de socket WhatsApp en mémoire entre les instances, ce qui rompt les connexions actives et duplique les livraisons de webhook. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` | `true` | High | Le désactiver supprime le cache des instances et des messages d'Evolution API ; l'application est configurée pour s'y attendre (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) ou explicite | High | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, l'URI du cache est vide et la mise en cache est désactivée silencieusement. |
| `memory_limit` | `4Gi` (min `2Gi`) | High | En dessous de 2 GiB, Evolution API est sujette à des arrêts pour manque de mémoire (OOM) sous la charge des messages. |
| `ingress_settings` | `all` | High | Le définir sur `internal` bloque tous les rappels de webhook WhatsApp externes. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | High | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhook externes. |
| `min_instance_count` | `1` | Medium | La mise à l'échelle à zéro abandonne les sessions de socket WhatsApp actives ; un démarrage à froid doit rétablir chaque connexion. |
| `application_version` | Épingler (p. ex. `v2.1.1`) | Medium | `latest` correspond à un tag épinglé, mais épingler explicitement évite des mises à niveau surprises qui exécutent de nouvelles migrations Prisma. |
| Délais de `startup_probe` | Par défaut (60s + 30 tentatives) | Medium | Une fenêtre trop serrée fait échouer la sonde avant la fin des migrations Prisma du premier démarrage. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Evolution API, partagée avec la variante GKE, est décrite dans
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Evolution API sur Cloud Run](../labs/EvolutionAPI_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EvolutionAPI sur GKE Autopilot](EvolutionAPI_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [EvolutionAPI Common — Configuration applicative partagée](EvolutionAPI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) dans la solution **Conversational Outreach**.
