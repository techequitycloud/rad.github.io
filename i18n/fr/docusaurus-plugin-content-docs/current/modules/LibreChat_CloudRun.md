---
title: "LibreChat sur Google Cloud Run"
description: "Référence de configuration pour déployer LibreChat sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LibreChat_CloudRun.md @ 3055034 sha256:6a44685a40f6 -->

# LibreChat sur Google Cloud Run {#librechat-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LibreChat_CloudRun.png" alt="LibreChat sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LibreChat est une interface de chat IA open source, forte de plus de 20 000 étoiles sur GitHub, qui reproduit et
enrichit l'expérience ChatGPT avec plus de 20 fournisseurs de LLM (OpenAI, Anthropic, Google Gemini,
Mistral, Groq, Ollama et bien d'autres). Ce module déploie LibreChat sur **Cloud Run v2**
en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LibreChat et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LibreChat s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique en fonction des requêtes |
| Base de données | MongoDB (sidecar `mongo:7` dans le pod par défaut) | Cloud SQL n'est pas utilisé ; la compatibilité MongoDB de Firestore est une alternative à activer explicitement |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux fichiers téléversés, plus des buckets supplémentaires facultatifs |
| Secrets | Secret Manager | Clés JWT, clés de chiffrement des identifiants et URI MongoDB générés automatiquement |
| Cache et sessions | Redis (facultatif) | Requis pour les déploiements multi-instances afin de garantir la cohérence des sessions |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** LibreChat utilise MongoDB. Par défaut, `mongodb_uri` pointe vers un **sidecar
  `mongo:7` dans le pod** (`mongodb://127.0.0.1:27017/LibreChat`), ajouté comme entrée `additional_containers`
  dans le même service Cloud Run, avec son répertoire de données sur le volume NFS partagé
  (`/data/db`). L'API compatible MongoDB de Firestore accepte l'authentification mais ignore les commandes de démarrage
  de LibreChat ; ce n'est donc **pas** la valeur par défaut — videz `mongodb_uri` (`""`) (et définissez
  `firestore_mongodb_host`, ou laissez les deux vides pour la découverte automatique) pour choisir Firestore à la place.
- **Le sidecar MongoDB fait du service une instance unique.** Comme ses données résident sur NFS à un
  chemin unique, `min_instance_count = max_instance_count = 1` par défaut. Pointez vers une base MongoDB
  externe (Atlas, auto-hébergée ou Firestore) pour dépasser une instance.
- **La base de données Firestore n'est jamais supprimée lors de la destruction (lorsqu'elle est utilisée).** Si vous optez pour
  le provisionnement automatique de Firestore, la base de données est conservée pour éviter toute perte de données ; supprimez-la manuellement si vous
  n'en avez plus besoin.
- **Les secrets JWT et d'identifiants sont générés automatiquement** au premier déploiement et stockés dans Secret Manager.
  La rotation de `CREDS_KEY` ou de `CREDS_IV` après que des utilisateurs ont enregistré des identifiants de fournisseurs d'IA rend tous
  les identifiants stockés indéchiffrables.
- **La mise à l'échelle à zéro est désactivée par défaut** (`min_instance_count = 1`). Les démarrages à froid de LibreChat
  peuvent prendre 15 à 30 secondes en raison de la connexion à MongoDB et du chargement des ressources.
- **Redis est désactivé par défaut.** Activez-le pour tout déploiement de plus d'une instance —
  sans Redis, l'état des sessions est isolé par instance et les utilisateurs perdent leur session lors des changements d'échelle.
- **Le délai d'expiration est de 600 secondes par défaut.** Les réponses d'IA longues diffusées en streaming SSE nécessitent un
  délai généreux.
- **`max_instance_count` vaut `1` par défaut** dans la variante Cloud Run. Le déploiement par défaut
  intègre un sidecar MongoDB dont le répertoire de données réside sur un unique volume NFS partagé ; plusieurs
  instances écrivant dans le même répertoire de données peuvent provoquer une corruption. Lorsque vous pointez vers une base MongoDB
  externe, augmentez librement cette limite.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources figurent dans
les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LibreChat {#a-cloud-run--the-librechat-service}

LibreChat s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal
et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité, l'environnement d'exécution
et la répartition du trafic.

### B. MongoDB — la base de données LibreChat {#b-mongodb--the-librechat-database}

LibreChat stocke tout l'historique des conversations, les comptes utilisateurs et la configuration dans MongoDB. Par défaut, un
conteneur officiel `mongo:7` s'exécute comme **sidecar dans le pod** au sein du même service Cloud Run
(`additional_containers`), joignable par le conteneur principal sur `127.0.0.1:27017`, avec son répertoire de
données (`/data/db`) sur le volume NFS partagé. Vous pouvez aussi vider `mongodb_uri` (`""`) pour
opter pour une **base de données Firestore ENTERPRISE compatible MongoDB** (découverte ou
créée automatiquement), ou faire pointer `mongodb_uri` vers MongoDB Atlas ou toute instance MongoDB auto-hébergée accessible
depuis le VPC.

- **Console :** Cloud Run → le détail de la révision du service affiche le conteneur sidecar `mongo`.
  Firestore → sélectionnez la base de données (en mode Firestore ; l'ID correspond à
  `firestore_mongodb_database`, par défaut `LibreChat`).
- **CLI :**
  ```bash
  # Inspect the sidecar and its NFS-backed data directory:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" --format=json | jq '.spec.template.spec.containers'
  # If using Firestore mode:
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Récupérez l'URI MongoDB depuis Secret Manager pour vérifier la connectivité :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — fichiers téléversés {#c-cloud-storage--file-uploads}

`LibreChat_Common` provisionne un bucket Cloud Storage dédié **`librechat-uploads`** pour les fichiers
que les utilisateurs partagent dans le chat (images, documents). Le compte de service de la charge de travail reçoit l'accès
automatiquement.

- **Console :** Cloud Storage → Buckets → repérez le bucket portant le suffixe `uploads`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les montages NFS, GCS Fuse et les options CMEK.

### D. Secret Manager — secrets applicatifs générés automatiquement {#d-secret-manager--auto-generated-application-secrets}

LibreChat nécessite plusieurs secrets cryptographiques qui sont générés automatiquement au premier déploiement
et ne sont jamais exposés en clair.

| Suffixe du secret | Variable d'environnement | Rôle |
|---|---|---|
| `creds-key` | `CREDS_KEY` | Clé AES-GCM hexadécimale de 32 octets pour les identifiants de fournisseurs enregistrés |
| `creds-iv` | `CREDS_IV` | IV AES-GCM hexadécimal de 16 octets — associé à `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signe les jetons d'accès des utilisateurs |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signe les jetons d'actualisation de longue durée |
| `mongo-uri` | `MONGO_URI` | Chaîne de connexion MongoDB |

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cache Redis (facultatif) {#e-redis-cache-optional}

Redis prend en charge la gestion des sessions de LibreChat et la mise en file d'attente des messages en temps réel. Il est requis lorsque
plus d'une instance est en cours d'exécution — sans lui, chaque instance dispose d'un état de session en mémoire isolé
et les utilisateurs perdent leur session lors des changements d'échelle.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run vers Cloud Monitoring, avec des
tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LibreChat {#3-librechat-application-behaviour}

- **Aucune tâche de migration de la base de données.** LibreChat migre automatiquement son schéma MongoDB au premier démarrage ;
  aucun job d'initialisation distinct n'est nécessaire.
- **Sidecar MongoDB dans le pod par défaut.** `mongodb_uri` vaut par défaut
  `mongodb://127.0.0.1:27017/LibreChat` et pointe vers un conteneur officiel `mongo:7` ajouté comme
  entrée `additional_containers` dans le même service Cloud Run ; son répertoire de données réside sur le
  volume NFS partagé, ce qui explique que le service soit par défaut une instance unique `min = max = 1`.
- **Provisionnement automatique de Firestore (à activer explicitement).** Définissez `mongodb_uri = ""` pour l'activer : lorsque
  `mongodb_uri` est vide et qu'aucun `firestore_mongodb_host` n'est défini, le module découvre ou crée
  une base de données Firestore ENTERPRISE compatible MongoDB. Un utilisateur SCRAM est provisionné
  automatiquement. La base de données n'est jamais détruite avec le module.
- **Clés d'API des fournisseurs d'IA.** LibreChat se connecte aux API des fournisseurs d'IA (OpenAI, Anthropic, etc.) au
  moment de la requête. Injectez les clés des fournisseurs via `secret_environment_variables`, qui référence des
  secrets Secret Manager existants. Ne transmettez pas les clés en tant que simples `environment_variables` — elles
  apparaîtraient dans les métadonnées des révisions Cloud Run et dans les journaux d'audit GCP.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/` (la racine de LibreChat), qui
  renvoie HTTP 200 une fois l'application entièrement initialisée et connectée à MongoDB. La
  sonde de démarrage dispose d'un seuil d'échec généreux pour laisser le temps d'établir la connexion à MongoDB au
  premier démarrage.
- **Continuité SSE et WebSocket.** LibreChat utilise les Server-Sent Events (SSE) pour diffuser en streaming les réponses de l'IA.
  Veillez à ce que `timeout_seconds` soit suffisamment élevé (600 s par défaut) pour éviter de tronquer
  les longues réponses de l'IA en cours de diffusion.
- **Inscription des utilisateurs.** L'auto-inscription est activée par défaut. Définissez `allow_registration = false`
  après avoir créé le compte administrateur initial pour empêcher les inscriptions non autorisées sur les déploiements publics.
- **Variables d'environnement injectées automatiquement.** Les variables suivantes sont toujours définies par le module
  et n'ont pas besoin d'être fournies manuellement :

  | Variable | Valeur | Rôle |
  |---|---|---|
  | `HOST` | `0.0.0.0` | Écoute sur toutes les interfaces dans le conteneur |
  | `NODE_ENV` | `production` | Optimisations de production |
  | `TRUST_PROXY` | `1` | Express lit correctement `X-Forwarded-For` derrière l'entrée Cloud Run |
  | `APP_TITLE` | `var.app_title` | Titre de l'en-tête de l'interface |
  | `DOMAIN_CLIENT` / `DOMAIN_SERVER` | URL du service | URI de redirection OAuth et liens des e-mails |
  | `ALLOW_REGISTRATION` | `var.allow_registration` | Indicateur d'auto-inscription |

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres
à LibreChat ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `firestore_mongodb_host` | `""` | Hôte du point de terminaison MongoDB de Firestore (remplacement manuel). Laissez vide pour la découverte automatique. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `librechat` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `LibreChat AI Chat` | Nom convivial affiché dans la console. |
| `application_description` | _(définie)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image LibreChat — **figez-le sur une version précise en production**. |
| `mongodb_uri` | `mongodb://127.0.0.1:27017/LibreChat` | URI de connexion MongoDB (sensible). Pointe par défaut vers le sidecar `mongo:7` dans le pod. Définissez `""` pour utiliser le provisionnement automatique de Firestore, ou fournissez l'URI d'une base MongoDB/Atlas externe. |
| `app_title` | `LibreChat` | Titre affiché dans l'en-tête de l'interface LibreChat et dans l'onglet du navigateur. |
| `allow_registration` | `true` | Autorise les nouveaux utilisateurs à s'inscrire eux-mêmes. **Définissez `false` après la création du compte administrateur initial.** |
| `allow_social_login` | `false` | Active les fournisseurs de connexion sociale OAuth. Nécessite la configuration d'une application OAuth dans `librechat.yaml`. |
| `allow_social_registration` | `null` | Autorise la création de compte via la connexion sociale. Prend par défaut la valeur de `allow_social_login`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) ou `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | URI de l'image de conteneur. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par instance ; 2 vCPU / 2 GiB au minimum. |
| `container_port` | `3080` | Port HTTP natif de LibreChat. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `600` | Durée maximale d'une requête ; augmentez-la pour des backends LLM lents ou de longues réponses d'IA. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Conservez ≥ 1 pour éviter les démarrages à froid et les flux SSE interrompus. |
| `max_instance_count` | `1` | Nombre maximal d'instances. **Conservez `1` lorsque vous utilisez le sidecar MongoDB intégré.** |
| `enable_cloudsql_volume` | `false` | **Doit rester à `false`.** LibreChat n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image GHCR dans Artifact Registry — évite les limites de débit. |
| `traffic_split` | `[]` | Répartition du trafic canary / blue-green entre les révisions. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` — internet public ; `internal` — VPC uniquement ; `internal-and-cloud-load-balancing` — via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables principales de LibreChat sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. **Utilisez-la pour les clés d'API des fournisseurs d'IA.** |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production/la conformité. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS {#group-9--nfs-instance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(définies)_ | Instance NFS existante / nom de base d'une instance créée en mode intégré (inline). |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `enable_nfs` | `true` | Volume Filestore partagé ; **requis par le sidecar MongoDB intégré** (stocke `/data/db`). Ne le désactivez que si vous utilisez une base MongoDB externe. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données / MongoDB {#group-12--database--mongodb}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Imposé — ne pas modifier.** LibreChat n'utilise pas Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | ID de la base de données Firestore / nom de la base de données MongoDB. |
| `firestore_mongodb_username` | `""` | Nom d'utilisateur SCRAM pour l'authentification Firestore. |
| `firestore_mongodb_password` | `""` | Mot de passe SCRAM (sensible). Généré automatiquement s'il n'est pas défini. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — LibreChat migre automatiquement MongoDB au démarrage. Ajoutez des tâches de configuration personnalisées si nécessaire. |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler (nettoyage des données, préchauffage du cache, etc.). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=10 }` | Sonde HTTP laissant le temps d'établir la connexion à MongoDB et de charger les ressources. |
| `liveness_probe` / `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité ciblant le chemin racine de LibreChat. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la gestion des sessions. **Requis pour les déploiements multi-instances.** |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources
en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de téléversements). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration exécutées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CREDS_KEY` / `CREDS_IV` (générés automatiquement) | définis une seule fois | Critique | Clés AES-GCM des identifiants de fournisseurs d'IA enregistrés. Leur rotation après que des utilisateurs ont enregistré des clés détruit tous les identifiants stockés — chaque utilisateur doit saisir à nouveau ses clés d'API. |
| `mongodb_uri` | conserver la valeur par défaut (sidecar) ou la définir explicitement | Critique | LibreChat nécessite MongoDB. Le sidecar `mongo:7` dans le pod par défaut a besoin de NFS pour son répertoire de données ; vider `mongodb_uri` (`""`) avec une configuration Firestore/Atlas défaillante fait planter le conteneur au démarrage, qui ne sert alors aucun trafic. |
| `enable_cloudsql_volume` | `false` | Critique | Doit rester à `false`. L'activer injecte un sidecar Cloud SQL Auth Proxy inutile. |
| `database_type` | `NONE` | Critique | Le définir sur un moteur SQL provisionne une instance Cloud SQL inutilisée, à un coût supplémentaire. |
| `secret_environment_variables` (clés d'IA) | utiliser des secrets | Critique | Les clés des fournisseurs d'IA transmises en simples `environment_variables` sont visibles dans les métadonnées des révisions Cloud Run et dans les journaux d'audit GCP. Utilisez toujours des références Secret Manager. |
| `allow_registration` | `false` après la configuration | Élevé | Une inscription ouverte sur un déploiement public permet à n'importe qui de créer un compte. Désactivez-la après la création de l'administrateur ou restreignez l'accès avec IAP. |
| `enable_redis` | `true` en multi-instances | Élevé | Sans Redis, chaque instance dispose d'un état de session en mémoire isolé ; les utilisateurs perdent leur session lors des changements d'échelle. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true`. S'il est vide, LibreChat ne peut pas se connecter à Redis. |
| `max_instance_count` | `1` avec MongoDB intégré | Élevé | Plusieurs instances écrivant dans le même répertoire de données MongoDB adossé à NFS peuvent corrompre la base de données. N'augmentez cette valeur que si vous utilisez une base MongoDB externe. |
| `enable_nfs` | `true` avec MongoDB intégré | Élevé | Le sidecar MongoDB intégré stocke son répertoire de données (`/data/db`) sur NFS. Désactiver NFS supprime le stockage durable et les données MongoDB sont perdues au redémarrage. |
| `timeout_seconds` | `600` | Élevé | Le streaming SSE de longues réponses d'IA peut dépasser plusieurs minutes. Un délai insuffisant tronque les réponses en cours de diffusion. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro interrompt tous les flux SSE en cours et provoque une latence de démarrage à froid au réveil. |
| `JWT_SECRET` (généré automatiquement) | défini une seule fois | Élevé | Sa rotation invalide simultanément toutes les sessions actives. Planifiez la rotation pendant une fenêtre de maintenance. |
| `application_version` | version figée | Moyen | `latest` peut introduire des changements incompatibles du schéma MongoDB ou des incompatibilités d'API lors de montées de version non planifiées. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sinon, LibreChat est directement joignable depuis l'internet public, protégé uniquement par la connexion au niveau de l'application. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS ne sont pas pris en charge en gen1. Utilisez toujours gen2 pour les déploiements avec NFS. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et simultanéité,
entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes
et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à LibreChat
partagée avec la variante GKE est décrite dans
**[LibreChat_Common](LibreChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LibreChat sur Cloud Run](../labs/LibreChat_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LibreChat sur GKE Autopilot](LibreChat_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LibreChat Common — Configuration applicative partagée](LibreChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
