---
title: "Mattermost sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mattermost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mattermost_CloudRun.md @ 15fd4c7 sha256:f3705de5e000 -->

# Mattermost sur Google Cloud Run {#mattermost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mattermost_CloudRun.png" alt="Mattermost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/Mattermost_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Mattermost et les modèles opérationnels pour le déploiement de Mattermost sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Mattermost est une plateforme open source de messagerie et de collaboration d'équipe auto-hébergeable — une alternative sécurisée à Slack avec des canaux persistants, des messages directs, le partage de fichiers, des intégrations, des bots, des commandes slash et des fonctionnalités de sécurité d'entreprise. `Mattermost CloudRun` est un **module enveloppe** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour toute la provision de l'infrastructure GCP et injecte la configuration d'application spécifique à Mattermost, l'initialisation de la base de données et le stockage via `Mattermost Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Mattermost personnalisé, 2 vCPU / 2 Gi par défaut. Le nombre minimum d'instances est de 1 par défaut — Mattermost maintient des connexions WebSocket persistantes pour la messagerie en temps réel, ce qui rend le scale-to-zero inadapté à la plupart des déploiements.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Le volume NFS partagé est monté à `/mattermost/data` par défaut (`enable_nfs = true`), de sorte que les téléchargements de fichiers et les pièces jointes survivent aux redémarrages et aux nouvelles révisions.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Mattermost génère ses propres clés de signature internes au premier démarrage et les stocke dans la base de données — aucun secret au niveau de l'application n'est auto-généré par ce module.
*   **Mise en cache** : Redis est **optionnel** (`enable_redis = false` par défaut). Lorsqu'il est activé, Mattermost utilise Redis comme cache distribué et backend de session — requis pour un comportement correct sur plusieurs réplicas.
*   **Éditions** : Team Edition (gratuit, par défaut) ou Enterprise Edition (licence payante requise). Contrôlé par la variable `edition`.
*   **Messagerie en temps réel** : Mattermost maintient des connexions WebSocket pour la livraison de messages en temps réel. Le délai d'expiration de 60 minutes de Cloud Run signifie que `timeout_seconds` doit être défini sur `3600` pour les déploiements fortement basés sur WebSocket. Pour les charges de travail de production nécessitant des connexions persistantes de longue durée, envisagez `Mattermost GKE`.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 1 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 1 | `list(string)` | `[]` | Destinataires des e-mails pour l'accès IAM et les alertes de surveillance. |
| `resource_labels` | 1 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'mattermost'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Mattermost'` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `description` | 3 | `string` | `'Mattermost - Open-source team messaging and collaboration'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'9.11.2'` | Tag de version de l'image Mattermost. Incrémenter pour déployer une nouvelle version. |

**Architecture de l'enveloppe :** `Mattermost CloudRun` appelle `Mattermost Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Mattermost, la configuration de la sonde et la définition du job `db-init`. `module_storage_buckets` contient tout bucket de données GCS configuré pour le montage FUSE. `scripts_dir` est résolu au répertoire de scripts `Mattermost Common` au moment de l'apply.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Mattermost_CloudRun` délègue toute la provision IAM à `App_CloudRun`. Le SA Cloud Run, le SA Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux de `App_CloudRun`.

**Aucun secret au niveau de l'application auto-généré :** Contrairement à de nombreux autres modules d'application, `Mattermost Common` ne génère pas automatiquement de secrets d'application tels qu'un `SECRET_KEY`. Mattermost génère ses propres clés de signature internes au premier démarrage et les stocke dans PostgreSQL. Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun` et consommés par le job `db-init`.

**Identité d'initialisation de la base de données :** Le job Cloud Run `db-init` s'exécute sous le SA Cloud Run. Il se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification, en utilisant `DB_HOST`, `DB_USER` et le secret `DB_PASSWORD` de Secret Manager.

**Délai de propagation IAM de 120 secondes :** Hérité de `App CloudRun` — le service Mattermost n'est pas déployé tant que le délai n'est pas écoulé, ce qui évite les échecs de lecture de secrets au démarrage de la première révision.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Mattermost est une application basée sur Go qui est économe en ressources au démarrage, mais qui bénéficie d'une allocation CPU constante pour la gestion des connexions WebSocket et la livraison des messages. `Mattermost CloudRun` expose `cpu_limit` et `memory_limit` comme variables de niveau supérieur.

**Le nombre minimum d'instances est de 1 par défaut** (`min_instance_count = 1`). Cela empêche les démarrages à froid (scale-to-zero) qui interrompraient les connexions WebSocket actives. Pour les environnements de développement ou sensibles aux coûts, `min_instance_count = 0` est pris en charge, mais entraînera la perte des sessions utilisateur lorsque l'instance sera réduite.

Le **Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` est défini par défaut sur `'custom'`, ce qui signifie que Cloud Build compile une image personnalisée en utilisant le Dockerfile de `Mattermost Common` (basé sur l'image officielle `mattermost/mattermost-team-edition` ou `mattermost/mattermost-enterprise-edition`, selon `edition`). Définissez `container_image_source = 'prebuilt'` et `container_image` sur un URI d'image pour ignorer l'étape de build.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build. `'prebuilt'` déploie une image existante. |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour que Cloud Build gère l'image. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour Mattermost. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi est le minimum ; augmentez pour les grandes équipes. |
| `cpu_always_allocated` | 4 | `true` | CPU alloué en permanence (facturation par instance). Maintenu `true` : les connexions WebSocket en temps réel nécessitent une instance non limitée (à associer à `min_instance_count >= 1`). |
| `container_resources` | 4 | `null` | Lorsqu'il est défini, remplace `cpu_limit` et `memory_limit`. |
| `min_instance_count` | 4 | `1` | Maintenez à `1` pour la production afin d'éviter les interruptions WebSocket. |
| `max_instance_count` | 4 | `1` | Plafond de coût pour l'auto-scaling. |
| `container_port` | 4 | `8065` | Port HTTP natif de Mattermost. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages de volume GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Définir à `3600` pour les déploiements fortement basés sur WebSocket. |
| `enable_cloudsql_volume` | 4 | `true` | Injecte le sidecar Cloud SQL Auth Proxy. Définissez `false` pour TCP. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Mattermost dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canary/blue-green basée sur un pourcentage. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Mattermost CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `8065` | Port natif de Mattermost. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Mattermost gère les connexions WebSocket concurrentes et l'indexation des messages. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Mattermost met en cache les canaux, les utilisateurs et les sessions en mémoire. |
| `min_instance_count` | `0` | `1` | Le scale-to-zero interrompt les connexions WebSocket actives des utilisateurs. |
| `cpu_always_allocated` | `false` | `true` | La livraison WebSocket en temps réel ne doit pas être limitée par le CPU entre les requêtes. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Mattermost nécessite **PostgreSQL 13 ou ultérieur** — PostgreSQL 15 est la valeur par défaut. Mattermost exécute ses propres migrations de schéma au démarrage ; aucune configuration manuelle du schéma de base de données n'est nécessaire au-delà de la création de la base de données et de l'utilisateur (gérée par le job `db-init`).

Le module utilise les variables abrégées `db_name` et `db_user` qui transitent par `Mattermost Common` vers la configuration de l'application.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur de base de données Cloud SQL. Ne pas changer de PostgreSQL. |
| `db_name` | 12 | `'mattermost'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'mattermost'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

### C. Stockage (NFS) {#c-storage-nfs}

Mattermost stocke les fichiers téléchargés, les pièces jointes et les données de plugin sous `/mattermost/data`. Sans stockage persistant, tous les téléchargements d'utilisateurs sont perdus lors du redémarrage du conteneur ou du déploiement d'une nouvelle révision.

**Par défaut, le volume NFS partagé est monté à `/mattermost/data`** (`enable_nfs = true`, `nfs_mount_path = "/mattermost/data"`), ce qui est l'emplacement vers lequel `MM_FILESETTINGS_DIRECTORY` pointe — les téléchargements sont donc durables sans configuration supplémentaire. Le montage d'un bucket GCS à cet endroit avec `gcs_volumes` est une alternative uniquement si vous désactivez NFS ; ne montez pas les deux au même chemin.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Monte le volume NFS partagé à `nfs_mount_path`, où Mattermost conserve les téléchargements. Laissez-le activé, sauf si vous y montez un autre stockage durable. |
| `nfs_mount_path` | 11 | `'/mattermost/data'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 11 | `""` | Nom de la VM GCE NFS existante. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base pour la VM GCE NFS intégrée. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Uniquement nécessaire à `/mattermost/data` si NFS est désactivé. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

**Alternative (NFS désactivé) : un volume GCS FUSE pour le stockage de fichiers Mattermost :**

```hcl
gcs_volumes = [
  {
    name        = "mattermost-data"
    bucket_name = "my-project-mattermost-data"
    mount_path  = "/mattermost/data"
    readonly    = false
    mount_options = [
      "implicit-dirs",
      "stat-cache-ttl=60s",
      "type-cache-ttl=60s"
    ]
  }
]
```

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP privée de Cloud SQL. Le sidecar Auth Proxy (`enable_cloudsql_volume = true`) gère la connexion à la base de données via un socket Unix.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine tout le trafic sortant via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Mattermost Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`). Il utilise une image basée sur `postgres` et exécute `Mattermost_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification.
2. Crée la base de données `mattermost` si elle n'existe pas.
3. Crée l'utilisateur `mattermost` avec le mot de passe de Secret Manager.
4. Accorde à l'utilisateur tous les privilèges sur la base de données.

Mattermost exécute ensuite ses propres migrations de schéma au premier démarrage — aucune configuration manuelle du schéma n'est requise.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Mattermost Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. Chaque entrée : `name`, `description`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `execution_mode`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `script_path`. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. Chaque entrée : `name`, `schedule`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit de 500 req/min) est provisionné devant Cloud Run.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, IPs de sortie CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée sur le service. L'authentification Google Identity est requise avant que les requêtes n'atteignent Mattermost. Utile pour les déploiements internes uniquement où les utilisateurs doivent s'authentifier avec le compte Google Workspace de leur organisation avant d'atteindre la page de connexion Mattermost.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès à IAP. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. Format : `'group:name@example.com'`. |

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run s'assure que les images Mattermost déployées portent une attestation cryptographique valide.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire et un attestateur préconfigurés dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets d'application Mattermost sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage nom de variable d'environnement → ID de secret Secret Manager. Résolu à l'exécution. |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites dans Secret Manager pendant le déploiement. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. Défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne procèdent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Mattermost à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Mattermost :** Mattermost sert un mélange de trafic API en temps réel (WebSocket, REST) et d'actifs statiques (bundles JavaScript, CSS, fichiers de plugins). Cloud CDN est adapté à la livraison d'actifs statiques mais ne doit pas mettre en cache les réponses API ou les mises à niveau WebSocket. Mattermost définit les en-têtes `Cache-Control` appropriés sur ses actifs statiques, de sorte que le CDN peut être activé en toute sécurité pour la mise en cache en périphérie du bundle d'application.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. Définissez `0` pour désactiver la suppression basée sur l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés. Certificats SSL gérés par Google provisionnés par domaine. |

Après le premier apply, récupérez l'IP de l'équilibreur de charge et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10 à 30 minutes après la propagation DNS. Ensuite, définissez `site_url` sur le domaine personnalisé afin que Mattermost génère des liens d'invitation et des URL de webhook corrects.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Mattermost personnalisée lorsque du code est poussé vers la branche configurée.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (scopes `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chaque : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count` est défini par défaut sur `1` — Mattermost maintient des connexions WebSocket actives pour la messagerie en temps réel, et le scale-to-zero déconnecterait tous les utilisateurs actifs. `max_instance_count` est défini par défaut sur `1` : Mattermost Team Edition n'a pas de clustering HA (une fonctionnalité Enterprise), donc une deuxième instance ne partage pas l'état WebSocket, de session ou de cache — les clients sur différentes instances cessent de voir les messages des autres en temps réel. N'augmentez cette valeur qu'avec une licence Enterprise et un clustering configuré.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge pour les déploiements canary.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Une valeur vide envoie 100 % à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Mattermost expose un point de terminaison de santé dédié à `/api/v4/system/ping` qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée et connectée à la base de données. Les sondes de santé ciblent ce point de terminaison.

Mattermost effectue des migrations de schéma au premier démarrage. La sonde de démarrage alloue un temps suffisant pour que la migration se termine avant que le trafic ne soit dirigé vers la nouvelle révision.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, period_seconds=15, failure_threshold=30 }` | Sonde de démarrage. Le conteneur ne reçoit pas de trafic tant que cela ne réussit pas. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60 }` | **Inerte pour Mattermost.** `App_CloudRun` ne le connecte qu'à son propre préréglage d'échantillon/de secours interne et inutilisé `cloudrunapp` (`cloudrunapp.tf`) — il n'atteint jamais le service Mattermost déployé. |
| `health_check_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60 }` | **Inerte pour Mattermost**, comme `startup_probe_config` ci-dessus. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). Lorsqu'il est activé, des alertes notifient `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |

**Remarque sur le chemin de la sonde :** Les sondes réellement déployées proviennent uniquement de `startup_probe`/`liveness_probe` (transférées à `Mattermost_Common`, puis dans `App_CloudRun`'s `local.selected_module.startup_probe`/`.liveness_probe`) — celles-ci sont par défaut `path = "/"` dans le module Cloud Run, tandis que la variante GKE est par défaut `/api/v4/system/ping`. Pour une signalisation de santé plus précise dans Cloud Run, remplacez `startup_probe`/`liveness_probe`'s `path` par `/api/v4/system/ping`. `startup_probe_config`/`health_check_config` sont une paire de variables séparées et inertes (voir tableau ci-dessus) — les remplacer n'a aucun effet sur les sondes déployées de Mattermost, alors ne vous en souciez pas.

### D. Rotation automatique du mot de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL, écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Mattermost.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique du mot de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant le redémarrage. |

---

## 8. Intégrations {#8-integrations}

### A. Paramètres de l'application Mattermost {#a-mattermost-application-settings}

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `site_url` | 20 | `""` | L'URL publique où Mattermost est accessible. Définit `MM_SERVICESETTINGS_SITEURL`. Laissé vide, il est dérivé au démarrage de l'URL du service Cloud Run ; définissez-le pour un domaine personnalisé. (par exemple, `'https://chat.example.com'`) |
| `edition` | 20 | `'team'` | `'team'` (gratuit) ou `'enterprise'` (payant — nécessite une clé de licence définie via `environment_variables`). Contrôle quelle image de conteneur Mattermost est sélectionnée. |

**URL du site.** Mattermost utilise SiteURL pour les liens d'invitation, les e-mails et les rappels OAuth. Si `site_url` est vide, le point d'entrée le définit au démarrage à partir de l'URL du service Cloud Run ; définissez `site_url` explicitement lorsque vous servez Mattermost sur un domaine personnalisé.

### B. Variables d'environnement {#b-environment-variables}

Mattermost est configuré entièrement via des variables d'environnement en utilisant le préfixe `MM_`. La variable `environment_variables` accepte toute clé de configuration Mattermost :

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair. Utilisez-les pour la configuration de Mattermost telle que l'e-mail, les plugins et les paramètres de service. |

Variables de configuration Mattermost courantes injectées automatiquement par `Mattermost Common` :

| Variable d'environnement | Valeur | Objectif |
|---|---|---|
| `MM_SERVICESETTINGS_LISTENADDRESS` | `:8065` | Adresse de liaison pour le serveur HTTP Mattermost. |
| `MM_METRICSSETTINGS_LISTENADDRESS` | `:8067` | Point de terminaison des métriques Prometheus. |
| `MM_FILESETTINGS_DRIVERTYPE` | `local` | Type de stockage de fichiers — fichiers locaux sous le répertoire monté. |
| `MM_FILESETTINGS_DIRECTORY` | `/mattermost/data/` | Chemin de stockage de fichiers — correspond au point de montage GCS FUSE ou NFS. |
| `MM_LOGSETTINGS_CONSOLELEVEL` | `INFO` | Niveau de journalisation envoyé à stdout (capturé par Cloud Logging). |
| `MM_LOGSETTINGS_ENABLEFILE` | `false` | Journalisation basée sur les fichiers désactivée — Cloud Run capture stdout vers Cloud Logging. |
| `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER` | `X-Forwarded-For` | Active l'extraction correcte de l'IP client à partir des en-têtes de proxy Cloud Run et de l'équilibreur de charge. |
| `MM_EMAILSETTINGS_ENABLEEMAILBATCHING` | `false` | Désactivé pour la compatibilité avec le scale-to-zero de Cloud Run. Le traitement par lots des e-mails nécessite des files d'attente persistantes en mémoire. |
| `MM_CACHEBACKEND` | `redis` ou `memory` | Défini sur `redis` lorsque `enable_redis = true` ; sinon `memory`. |
| `MM_REDIS_ADDRESS` | Hôte Redis:port | Injecté lorsque `enable_redis = true`. |

### C. Cache Redis {#c-redis-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Activez Redis pour tout déploiement exécutant plus d'une instance — sans Redis, plusieurs instances Mattermost ne peuvent pas partager l'état de session ou les caches, ce qui entraîne des échecs d'authentification intermittents et des données obsolètes.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Active Redis pour la mise en cache Mattermost et le stockage de session. Recommandé pour les déploiements multi-réplicas. |
| `redis_host` | 21 | `""` | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS lorsque `enable_redis = true`. Remplacez par une instance Memorystore pour la production. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe AUTH Redis. Laissez vide si l'authentification n'est pas requise. Sensible — jamais stocké dans l'état. |

### D. Métriques {#d-metrics}

Mattermost expose des métriques au format Prometheus sur le port 8067 (`/metrics`). Activez les métriques dans la console système Mattermost sous **Environnement → Surveillance des performances**, puis intégrez-les à Google Cloud Monitoring via un point de terminaison d'écriture à distance Prometheus ou un scraper exécuté dans le même VPC.

### E. Importation et récupération de sauvegarde {#e-backup-import--recovery}

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (nom de fichier du bucket GCS) ou `'gdrive'` (ID de fichier Drive). |
| `backup_file` | 7 | `'backup.sql'` | Nom de fichier de la sauvegarde dans le bucket GCS de sauvegardes géré par le module. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### F. Observabilité et alertes {#f-observability--alerting}

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique. Chaque : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |
| `support_users` | 1 | `[]` | Adresses e-mail notifiées par les déclencheurs de test de disponibilité et de politique d'alerte. |

---

## 9. Exploration avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, la console GCP est l'outil principal pour inspecter le déploiement Mattermost en direct.

**Service Cloud Run**
Accédez à **Cloud Run** dans la console GCP et sélectionnez le service Mattermost (nommé `app<name><tenant><id>` par défaut, par exemple, `appmattermostdemo`). À partir de la page du service, vous pouvez :
- Afficher l'URL du service pour accéder au client web Mattermost.
- Inspecter les révisions actives et leurs pourcentages d'allocation de trafic.
- Examiner la configuration du conteneur, y compris les variables d'environnement, les volumes montés et les limites de ressources.
- Vérifier l'onglet **Logs** pour diffuser directement les journaux de l'application Mattermost — toutes les sorties `stdout` sont capturées par Cloud Logging.
- Surveiller les **Metrics** pour le nombre de requêtes, la latence (p50, p95, p99), le nombre d'instances de conteneur, l'utilisation de la mémoire et la latence de démarrage.
- Afficher les **Revisions** pour voir l'historique des déploiements, les poids de trafic actuels et les tags de révision actifs.

**Cloud SQL**
Accédez à **SQL** et sélectionnez l'instance PostgreSQL 15. Vérifications utiles :
- Onglet **Connections** : nombre de connexions actives depuis le service Cloud Run (via l'Auth Proxy).
- **Operations & logs** : activité récente de création de base de données, d'octroi d'utilisateur et de migration.
- Onglet **Databases** : vérifiez que la base de données `mattermost` existe après le premier déploiement.
- Onglet **Users** : confirmez que l'utilisateur `mattermost` a été créé par le job `db-init`.
- **Backups** : sauvegardes automatisées et à la demande. Vérifiez avec la variable `backup_schedule`.

**Cloud Storage**
Si vous avez remplacé NFS par un bucket `gcs_volumes` à `/mattermost/data`, accédez à **Cloud Storage** et sélectionnez le bucket. (Avec le montage NFS par défaut, la même arborescence se trouve sur le partage NFS.) Mattermost crée cette structure de répertoires sous le point de montage :
- `teams/` — icônes d'équipe et pièces jointes.
- `users/` — photos de profil.
- `plugins/` — fichiers de données de plugin.
Les opérations de fichiers dans le bucket reflètent les téléchargements et les pièces jointes effectués par les utilisateurs de Mattermost.

**Secret Manager**
Accédez à **Secret Manager** et filtrez par les libellés de ressources du déploiement. Les secrets créés par `App CloudRun` pour Mattermost incluent :
- `DB_PASSWORD` — le mot de passe de l'utilisateur de l'application PostgreSQL.
- `ROOT_PASSWORD` — le mot de passe root/superutilisateur PostgreSQL utilisé par le job `db-init`.
Cliquez sur un secret pour afficher ses versions, son historique d'accès et sa configuration de rotation.

**Cloud Build**
Accédez à **Cloud Build → History** pour inspecter les journaux de build d'image. Chaque déploiement crée un build qui compile l'image Mattermost personnalisée (lorsque `container_image_source = 'custom'`). Les journaux de build affichent les étapes de build Docker, le comportement de mise en cache des couches et le push vers Artifact Registry.

**Artifact Registry**
Accédez à **Artifact Registry** et trouvez le dépôt pour le projet. L'image Mattermost est stockée ici après chaque exécution de Cloud Build. Les images plus anciennes sont nettoyées selon `max_images_to_retain` et `image_retention_days`.

**Cloud Monitoring**
Accédez à **Monitoring → Dashboards** pour voir les tableaux de bord des métriques Cloud Run. Si `uptime_check_config` est activé, le test de disponibilité apparaît sous **Monitoring → Uptime checks**. Les politiques d'alerte créées via `alert_policies` apparaissent sous **Monitoring → Alerting**.

---

## 10. Explorer avec gcloud {#10-exploring-with-gcloud}

Les commandes `gcloud` suivantes sont utiles pour les opérations quotidiennes et le dépannage après le déploiement. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par vos valeurs réelles.

**Décrire le service Cloud Run :**
```bash
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Afficher l'URL du service et la répartition actuelle du trafic :**
```bash
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(status.url, status.traffic[].revisionName, status.traffic[].percent)"
```

**Lister toutes les révisions et leurs poids de trafic :**
```bash
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --sort-by="~metadata.creationTimestamp" \
  --format="table(metadata.name, status.conditions[0].type, status.conditions[0].status, metadata.creationTimestamp)"
```

**Diffuser les logs en direct du service Mattermost :**
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --project=PROJECT_ID \
  --format="value(textPayload)" \
  --freshness=10m \
  --order=asc
```

**Vérifier l'historique d'exécution du job Cloud Run db-init :**
```bash
gcloud run jobs executions list \
  --job=SERVICE_NAME-db-init \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name, status.conditions[0].type, metadata.creationTimestamp)"
```

**Déclencher manuellement le job db-init (par exemple, après une restauration de base de données) :**
```bash
gcloud run jobs execute SERVICE_NAME-db-init \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Inspecter l'instance Cloud SQL et vérifier la connectivité de la base de données :**
```bash
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier, ipAddresses[].ipAddress)"
```

**Lister les bases de données Cloud SQL sur l'instance :**
```bash
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Afficher les secrets Secret Manager pour le déploiement :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="labels.app=mattermost" \
  --format="table(name, createTime, replication.automatic)"
```

**Accéder à la dernière version du secret du mot de passe de la base de données :**
```bash
gcloud secrets versions access latest \
  --secret=DB_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID
```

**Lister les images de conteneurs dans Artifact Registry :**
```bash
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --filter="tags:mattermost" \
  --sort-by="~createTime" \
  --format="table(IMAGE, TAGS, CREATE_TIME, UPDATE_TIME)"
```

**Forcer un nouveau déploiement (redéployer la dernière révision) :**
```bash
gcloud run services update SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --update-env-vars=DEPLOY_TIMESTAMP=$(date +%s)
```

**Vérifier l'état du test de disponibilité de Cloud Monitoring :**
```bash
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName, httpCheck.path, period, selectedRegions)"
```

**Afficher les politiques d'alerte actives :**
```bash
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName, enabled, conditions[0].displayName)"
```

**Inspecter le bucket GCS utilisé pour le stockage des fichiers Mattermost :**
```bash
gsutil ls -l gs://BUCKET_NAME/
gsutil du -s gs://BUCKET_NAME/
```

**Vérifier si un fichier de téléchargement Mattermost spécifique est présent :**
```bash
gsutil stat gs://BUCKET_NAME/teams/TEAM_ID/channels/CHANNEL_ID/attachments/FILE_ID
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Mattermost CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | `database_type = "POSTGRES_15"` par défaut | Mattermost nécessite PostgreSQL 13 ou une version ultérieure. La chaîne de connexion à la base de données et le pilote sont configurés par `Mattermost Common`. |
| **NFS pour les données** | `enable_nfs = true`, `nfs_mount_path = "/mattermost/data"` | `/mattermost/data` se trouve sur le volume NFS partagé par défaut, offrant un stockage de fichiers durable. |
| **Mise en miroir des images activée par défaut** | `enable_image_mirroring = true` | L'image Docker Hub de Mattermost est mise en miroir dans Artifact Registry avant le déploiement, évitant ainsi la dépendance à des registres externes. |
| **Minimum 1 instance** | `min_instance_count = 1` par défaut | Empêche la mise à l'échelle à zéro de déconnecter les sessions WebSocket des utilisateurs actifs. |
| **Pas de secrets d'application auto-générés** | Mattermost génère des clés au premier démarrage | Les clés de signature internes, les secrets de session et les clés de chiffrement symétriques sont générés par Mattermost lui-même et stockés dans PostgreSQL — pas dans Secret Manager. |
| **Job db-init par défaut** | Fourni par `Mattermost Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement avant le démarrage de Mattermost. Remplacez par une liste `initialization_jobs` non vide pour remplacer. |
| **Confiance de l'en-tête du proxy** | `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER=X-Forwarded-For` | Requis pour une extraction correcte de l'adresse IP du client lorsque Cloud Run est derrière Cloud Armor ou un équilibreur de charge. Injecté automatiquement. |
| **Traitement par lots des e-mails désactivé** | `MM_EMAILSETTINGS_ENABLEEMAILBATCHING=false` | Le traitement par lots nécessite des files d'attente persistantes en mémoire incompatibles avec le modèle d'exécution sans état de Cloud Run. |
| **Variable d'environnement Site URL** | `MM_SERVICESETTINGS_SITEURL` défini à partir de la variable `site_url` | Lorsque `site_url` n'est pas vide, il est injecté comme `MM_SERVICESETTINGS_SITEURL` ; sinon, le point d'entrée le dérive au démarrage de `CLOUDRUN_SERVICE_URL`. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Mattermost CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour le déploiement des ressources. |
| `tenant_id` | 1 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 1 | `[]` | Adresses e-mail pour l'accès IAM et les alertes de surveillance. |
| `resource_labels` | 1 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'mattermost'` | Nom de ressource de base. Ne pas modifier après le déploiement. |
| `display_name` | 3 | `'Mattermost'` | Nom lisible par l'homme affiché dans l'interface utilisateur. |
| `description` | 3 | `'Mattermost - Open-source team messaging and collaboration'` | Description du service. |
| `application_version` | 3 | `'9.11.2'` | Tag de l'image du conteneur Mattermost. |
| `deploy_application` | 4 | `true` | Définir `false` pour un déploiement uniquement d'infrastructure. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `""` | URI de l'image du conteneur. Laisser vide pour que Cloud Build le gère. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. |
| `cpu_always_allocated` | 4 | `true` | CPU alloué en permanence. Maintenu `true` pour la gestion des WebSockets en temps réel. |
| `container_resources` | 4 | `null` | Remplace `cpu_limit` et `memory_limit` lorsqu'il est défini. |
| `min_instance_count` | 4 | `1` | Garder à `1` pour éviter les déconnexions WebSocket. |
| `max_instance_count` | 4 | `1` | Plafond de coût d'auto-mise à l'échelle. |
| `container_port` | 4 | `8065` | Port HTTP natif de Mattermost. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Définir `3600` pour les connexions WebSocket. |
| `enable_cloudsql_volume` | 4 | `true` | Sidecar Cloud SQL Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Mattermost dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/SA ayant accès à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair pour la configuration de Mattermost. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites dans Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde dans le bucket de sauvegardes géré par le module. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image lors du déploiement. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | `'ALWAYS_ALLOW'`, `'REQUIRE_ATTESTATION'`, ou `'ALWAYS_DENY'`. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécuter les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définir `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne un stockage partagé NFS. |
| `nfs_mount_path` | 11 | `'/mattermost/data'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 11 | `""` | Nom de la VM GCE NFS existante. Laisser vide pour la découvrir automatiquement. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base pour la VM NFS intégrée. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Mattermost nécessite PostgreSQL. |
| `db_name` | 12 | `'mattermost'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement. |
| `db_user` | 12 | `'mattermost'` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laisser vide pour le job `Mattermost Common` `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=30 }` | Sonde de démarrage. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/" }` | Inerte pour Mattermost — voir §C. Utiliser `startup_probe` à la place. |
| `health_check_config` | 14 | `{ enabled=true, path="/" }` | Inerte pour Mattermost — voir §C. Utiliser `liveness_probe` à la place. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |
| `site_url` | 20 | `""` | URL publique pour Mattermost. Définit `MM_SERVICESETTINGS_SITEURL`. |
| `edition` | 20 | `'team'` | `'team'` (gratuit) ou `'enterprise'` (payant). |
| `enable_redis` | 21 | `false` | Redis pour la mise en cache de Mattermost. Requis pour les réplicas multiples. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Par défaut, l'IP du serveur NFS si vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe AUTH Redis. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définir `false` pour appliquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement si vide. |
| `enable_audit_logging` | 22 | `false` | Active les logs d'audit Cloud détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## 14. Pièges de configuration et valeurs par défaut judicieuses {#14-configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Mattermost nécessite PostgreSQL 13 ou une version ultérieure. La définition d'une variante MySQL ou SQL Server entraîne l'échec du démarrage de Mattermost avec une erreur de connexion du pilote. |
| `db_name` | `"mattermost"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur entraîne la recréation de la base de données par Mattermost, détruisant tout l'historique des messages, les utilisateurs et la configuration. |
| `db_user` | `"mattermost"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur recrée l'utilisateur Cloud SQL et interrompt la connexion à la base de données. |
| `min_instance_count` | `1` | **Élevé** | La mise à l'échelle à zéro (`0`) entraîne la perte des connexions WebSocket actives (messagerie en temps réel) pour tous les utilisateurs en ligne chaque fois que l'instance unique est réduite. Définir à `1` pour tout déploiement en production. |
| `timeout_seconds` | `300` | **Élevé** | Mattermost maintient des connexions WebSocket pour la messagerie en temps réel. Un délai d'attente de 5 minutes entraîne la terminaison par Cloud Run de toutes les connexions WebSocket actives toutes les 5 minutes. Définir à `3600` pour les déploiements de production fortement dépendants des WebSockets. |
| `enable_redis` | `false` | **Élevé** | Sûr avec l'instance unique par défaut. L'exécution de plusieurs réplicas (`max_instance_count > 1`) nécessite un clustering HA Enterprise et Redis pour le partage de session distribué. Sans cela, les utilisateurs rencontrent des échecs d'authentification intermittents et des données obsolètes car les requêtes sont acheminées vers différentes instances avec des caches mémoire indépendants. |
| `site_url` | `""` (dérivé de l'URL du service) | **Élevé** avec un domaine personnalisé | Vide est acceptable sur l'URL `run.app` — elle est dérivée au démarrage. Sur un domaine personnalisé, la laisser vide fait que les liens d'invitation, les URI de redirection OAuth et les rappels de webhook pointent vers l'URL `run.app` à la place. |
| `enable_nfs` | `true` | **Élevé** | Le désactiver sans monter un autre stockage durable (par exemple `gcs_volumes`) à `/mattermost/data` place les téléchargements et les pièces jointes sur le système de fichiers éphémère du conteneur ; ils sont perdus lorsqu'une nouvelle révision est déployée ou que le conteneur redémarre. |
| `edition` | `"team"` | **Moyen** | La définition de `edition = "enterprise"` sélectionne l'image de conteneur Enterprise Edition. Sans une clé de licence valide définie via `environment_variables`, Mattermost démarre en mode d'essai Enterprise et finit par revenir aux fonctionnalités de Team Edition. |
| `memory_limit` | `"2Gi"` | **Moyen** | Mattermost met en cache les listes de canaux, les sessions utilisateur et les index de messages en mémoire. La réduction en dessous de `1Gi` provoque des redémarrages OOM en cas d'activité modérée de l'équipe. Augmenter à `4Gi` pour les équipes de plus de 100 utilisateurs actifs. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour les équipes actives. Augmenter à plus de 30 jours pour toute instance Mattermost de production afin de permettre une récupération ponctuelle en cas de corruption de données ou de suppression accidentelle. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, Mattermost est exposé directement sur l'URL `*.run.app`. Pour les équipes de production, activez Cloud Armor pour protéger l'API des attaques de bots et du bourrage d'identifiants. |
| `enable_iap` | `false` | **Faible** | Avec IAP désactivé, Mattermost est responsable de sa propre authentification. Envisagez d'activer IAP pour les déploiements internes uniquement afin d'ajouter une couche d'authentification supplémentaire avant que les requêtes n'atteignent Mattermost. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multi-régions. Augmenter à 60-90s si les secrets ne sont pas trouvés lors de l'apply. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : Libération de l'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** Attendez 20 à 30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mattermost sur Cloud Run](../labs/Mattermost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Mattermost GKE — Guide de configuration](Mattermost_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Mattermost](Mattermost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **Espace de travail d'équipe**.
