---
title: "Umami sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Umami sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Umami_CloudRun.md @ df67eef sha256:d73f822d3ac9 -->

# Umami sur Google Cloud Run {#umami-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_CloudRun.png" alt="Umami sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module Terraform `modules/Umami_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Umami et les modèles opérationnels pour le déploiement d'Umami sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Umami est une plateforme d'analyse web open source, légère et axée sur la confidentialité — une alternative auto-hébergée à Google Analytics. Elle collecte le trafic du site web et les données d'événements sans cookies ni données personnelles, ce qui la rend conforme aux réglementations GDPR, CCPA et PECR dès sa mise en œuvre. `Umami CloudRun` est un **module enveloppe** construit sur `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Umami, l'initialisation de la base de données et la gestion des secrets via `Umami Common`.

**Fonctionnalités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Next.js, 1 vCPU / 512 Mio par défaut. Mise à l'échelle à zéro (`min_instance_count = 0`) prise en charge ; `max_instance_count` par défaut à 3.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. Aucun stockage GCS n'est provisionné par défaut.
*   **Sécurité** : `APP_SECRET` auto-généré par `Umami Common` et stocké dans Secret Manager. Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`.
*   **Confidentialité** : Aucun cookie utilisé par défaut, aucune donnée personnelle stockée, entièrement conforme aux réglementations GDPR/CCPA/PECR.
*   **Point de terminaison de santé** : Umami expose `/api/heartbeat` comme point de terminaison de santé. Les sondes de démarrage et de vivacité ciblent ce chemin.
*   **CI/CD** : Pipeline d'images Cloud Build personnalisé par défaut ; livraison progressive Cloud Deploy facultative.
*   **Suivi** : Après le déploiement, intégrez `<script async src="https://<your-url>/script.js" data-website-id="..."></script>` dans les sites web suivis.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `string` | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des alertes de surveillance par e-mail. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'umami'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `string` | `'Umami'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `string` | `'Umami Analytics on Cloud Run'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'postgresql-latest'` | Tag de version de l'image Umami. Utilisez un tag préfixé par `postgresql-` (par exemple, `postgresql-latest`, `postgresql-v2.11.3`). |

**Architecture de l'enveloppe :** `Umami CloudRun` appelle `Umami Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Umami, la configuration de la sonde et la définition du job `db-init`. `module_secret_env_vars` transporte `APP_SECRET` depuis `Umami Common`. Le `DATABASE_URL` est construit au moment de l'exécution à partir des variables de plateforme DB_* injectées par `App CloudRun`. `scripts_dir` est résolu en `abspath("${module.umami_app.path}/scripts")` au moment de l'apply.

**Note PostgreSQL :** Umami nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être modifiée.

**Identifiants administrateur par défaut :** Lors du premier déploiement, connectez-vous avec le nom d'utilisateur `admin` et le mot de passe `umami`. Modifiez-les immédiatement après la première connexion.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Umami_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Les ensembles de rôles du compte de service Cloud Run, du compte de service Cloud Build, de l'agent de service IAP et de la rotation des mots de passe sont identiques à ceux de [App_CloudRun](./App_CloudRun.md#group-0--module-metadata--platform-wiring).

**Secret d'application auto-généré :** `Umami Common` génère `APP_SECRET` au moment de l'apply en utilisant `random_password` (32 caractères, pas de caractères spéciaux). Il est écrit dans Secret Manager et injecté dans le conteneur Cloud Run en tant que variable d'environnement `APP_SECRET`. Le texte en clair n'est jamais stocké dans l'état Terraform après l'apply initial.

**Identité d'initialisation de la base de données :** Le job Cloud Run `db-init` s'exécute sous le compte de service Cloud Run. Il se connecte à Cloud SQL PostgreSQL via l'intégration native de socket Cloud SQL de Cloud Run (`run.googleapis.com/cloudsql-instances`, puisque `enable_cloudsql_volume = true` par défaut), en utilisant `DB_HOST` (le chemin du socket sous `/cloudsql`), `DB_USER` et `DB_PASSWORD` (depuis Secret Manager). Cloud Run n'a pas de sidecar Auth Proxy — ce mécanisme n'existe que sur GKE.

**Délai de propagation des secrets de 30 secondes :** `Umami Common` insère une attente de propagation après la création des secrets. La variable `secret_propagation_delay` (30 secondes par défaut) contrôle la durée pendant laquelle les ressources dépendantes attendent après la création du secret avant de continuer.

Pour les tableaux de rôles complets et les détails sur IAP, la rotation des mots de passe et l'accès public, consultez [App_CloudRun](./App_CloudRun.md#group-15--identity-aware-proxy).

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Umami est une application Next.js légère avec des exigences de ressources modestes. `Umami CloudRun` expose `cpu_limit` et `memory_limit` comme variables de haut niveau dédiées.

La **mise à l'échelle à zéro est prise en charge** (`min_instance_count = 0` par défaut). Les démarrages à froid d'Umami sont rapides — l'application est légère et n'a pas d'opérations de démarrage lentes.

Le **Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` par défaut à `'custom'`, ce qui signifie que Cloud Build construit une image enveloppe qui mappe les variables d'environnement DB_* de la plateforme aux variables `DATABASE_URL` d'Umami. Définissez `container_image_source = 'prebuilt'` et configurez `DATABASE_URL` manuellement pour déployer directement l'image officielle `ghcr.io/umami-software/umami`.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build (mappe DB_* à DATABASE_URL). `'prebuilt'` déploie un URI d'image existant. |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | Image de base. Remplacez pour utiliser une image personnalisée ou une copie mise en miroir. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU est suffisant pour la plupart des déploiements Umami. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. Augmentez à 1 Gio pour les sites à fort trafic. |
| `min_instance_count` | 4 | `0` | Instances minimales. Définissez à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | 4 | `3` | Instances maximales. Umami s'adapte horizontalement — tout l'état est dans PostgreSQL. |
| `container_port` | 4 | `3000` | Port HTTP natif d'Umami. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommandé pour les performances. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | 4 | `true` | Par défaut `true` — Umami se connecte via l'intégration native de socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir Section 3.D). |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes — le CPU n'est facturé que pendant le traitement d'une requête. Définissez `true` pour allouer le CPU en permanence (facturation basée sur l'instance). |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Umami CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Port Next.js natif d'Umami. |
| `cpu_limit` | `'1000m'` | `'1000m'` | Identique — Umami est léger. |
| `memory_limit` | `'512Mi'` | `'512Mi'` | Identique — Umami a des besoins en mémoire modestes. |
| `max_instance_count` | `1` | `3` | Umami s'adapte horizontalement en toute sécurité — tout l'état est dans PostgreSQL. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Umami nécessite **PostgreSQL 15**. Le module provisionne une instance Cloud SQL PostgreSQL 15 et crée une base de données et un utilisateur dédiés pour Umami.

**Construction de DATABASE_URL :** Le point d'entrée personnalisé (en mode image `custom`) construit `DATABASE_URL` à partir des variables `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` et `DB_PORT` injectées par la plateforme. Cela évite de devoir passer une chaîne de connexion en texte clair.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `application_database_user` | 12 | `'umami'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation des extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer (par exemple, `['uuid-ossp']`). |

### C. Stockage (GCS) {#c-storage-gcs}

**Pas de stockage par défaut.** Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. `storage_buckets` est une liste vide par défaut. Provisionnez des buckets supplémentaires uniquement si nécessaire pour des cas d'utilisation personnalisés (par exemple, exportations de sauvegarde).

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Contrôle si le module provisionne les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami ne nécessite pas de stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne une instance Cloud Filestore NFS. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. Utilisé uniquement lorsque `enable_nfs = true`. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés CMEK KMS et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP interne de Cloud SQL. Étant donné que `enable_cloudsql_volume = true` est la valeur par défaut, l'intégration *native* Cloud SQL de Cloud Run (annotation `run.googleapis.com/cloudsql-instances`) monte un socket Unix à `/cloudsql/<proj:region:inst>` et injecte `DB_HOST` comme répertoire de ce socket. **Il n'y a pas de sidecar Auth Proxy et pas de listener TCP `127.0.0.1:5432` sur Cloud Run** — ce mécanisme n'existe que sur GKE, où un vrai sidecar `cloud-sql-proxy` écoute sur le loopback. Le point d'entrée `Umami_Common` (`scripts/umami-entrypoint.sh`, partagé avec `Umami_GKE`) résout un chemin de socket `DB_HOST` en `127.0.0.1` avant d'assembler `DATABASE_URL` — un mappage qui n'est valide que sur GKE. Sur Cloud Run, cela donne `ECONNREFUSED 127.0.0.1:5432` et un échec de la sonde de démarrage. Voir le tableau des pièges de configuration ci-dessous.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via VPC. `'ALL_TRAFFIC'` achemine tout le trafic sortant via VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Umami Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`). Il utilise une image client PostgreSQL et exécute `Umami_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via l'intégration native de socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir Section 3.D).
2. Crée l'utilisateur de base de données `umami` avec le mot de passe de Secret Manager.
3. Crée la base de données `umami` si elle n'existe pas.
4. Accorde à l'utilisateur `umami` tous les privilèges sur la base de données.

Umami lui-même exécute ses propres migrations de base de données basées sur Prisma au premier démarrage — le job `db-init` ne fait que pré-créer la base de données et l'utilisateur afin que les migrations d'Umami puissent s'exécuter avec succès.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laissez vide pour que `Umami Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés à côté de l'application principale. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit à 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, IP de sortie CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. L'authentification Google est requise avant que les requêtes n'atteignent Umami. Utile pour restreindre l'accès aux analyses aux seuls membres de l'équipe interne.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès. Format : `'group:name@example.com'`. |

**Note :** IAP protège le tableau de bord Umami. Le script de suivi (`/script.js`) et le point de terminaison d'événement (`/api/send`) doivent rester accessibles publiquement pour que les sites web suivis puissent rapporter des données. Si vous appliquez IAP, assurez-vous que les chemins de suivi sont exemptés ou utilisez une configuration d'entrée distincte.

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique Binary Authorization et un attestateur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Le `APP_SECRET` d'Umami est stocké dans Secret Manager et injecté nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappe nom de variable d'environnement → ID de secret Secret Manager. Résolu au moment de l'exécution ; jamais stocké dans l'état. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Umami à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

Voir [App_CloudRun](./App_CloudRun.md#group-16--cloud-armor--cdn) pour les détails complets de l'architecture.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Umami :** Le tableau de bord d'Umami est une application Next.js dynamique. Cloud CDN est utile pour mettre en cache les actifs statiques d'Umami (bundles JavaScript, CSS) mais ne doit pas mettre en cache les réponses d'API (`/api/*`) qui contiennent des données d'analyse en direct. Assurez-vous que les en-têtes `Cache-Control` appropriés sont définis.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées (pendantes) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. Définissez `0` pour désactiver la suppression basée sur l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'adresse IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. (par exemple, `['analytics.example.com']`) |

Après le premier apply, récupérez l'IP de l'équilibreur de charge et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10 à 30 minutes après la propagation DNS.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Umami personnalisée lorsque du code est poussé vers la branche configurée.

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
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` (mise à l'échelle à zéro) par défaut. Les démarrages à froid d'Umami sont rapides — l'application Next.js démarre en quelques secondes sans opérations lourdes au premier démarrage. `max_instance_count = 3` par défaut. Umami s'adapte horizontalement en toute sécurité car tout l'état est dans PostgreSQL.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. Umami stocke toutes les données d'analyse dans PostgreSQL (partagées entre toutes les instances), ce qui rend les déploiements canaris sûrs — toute révision peut servir des requêtes et écrire dans la même base de données.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Vide envoie 100 % à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Umami expose `/api/heartbeat` comme point de terminaison de santé dédié. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=10, failure_threshold=30 }` | Sonde de préparation au démarrage. Le conteneur ne reçoit pas de trafic tant que cela n'a pas réussi. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30 }` | Sonde de démarrage Cloud Run (passée directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (passée directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Vérification de la disponibilité de Cloud Monitoring (désactivée par défaut). Lorsqu'elle est activée, des alertes notifient `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL, écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Umami.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer le service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de rotation. Défaut : 30 jours. |

---

## 8. Intégrations {#8-integrations}

### A. Cache Redis {#a-redis-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Umami ne nécessite pas Redis — tout l'état est stocké dans PostgreSQL. Activez-le uniquement si vous intégrez une couche de cache externe pour des cas d'utilisation personnalisés.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_redis` | 16 | `false` | Active Redis en injectant les variables d'environnement `REDIS_HOST` et `REDIS_PORT`. Umami ne nécessite pas Redis. |
| `redis_host` | 16 | `""` | Nom d'hôte ou IP du serveur Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP du serveur Redis (chaîne). |

### B. Importation et récupération de sauvegarde {#b-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

### C. Observabilité et alertes {#c-observability--alerting}

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Configuration de la vérification de la disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les déclencheurs de vérification de la disponibilité et de politique d'alerte. |

### D. Exploration avec la console GCP {#d-exploring-with-the-gcp-console}

Après un déploiement réussi, explorez l'installation Umami dans la console GCP :

**Service Cloud Run :**
Accédez à **Cloud Run** dans la console GCP. Trouvez le service nommé `app<application_name><tenant_id><deployment_id>` (par exemple, `appumamidemoxyz`). Cliquez sur le service pour afficher :
- L'URL du service — utilisez-la pour accéder au tableau de bord Umami.
- L'onglet **Revisions** — liste toutes les révisions déployées avec les pourcentages de trafic.
- L'onglet **Logs** — diffuse les journaux du conteneur, y compris les journaux de démarrage et de requête d'Umami.
- L'onglet **Metrics** — affiche le nombre de requêtes, la latence, le nombre d'instances et l'utilisation du CPU/mémoire.
- L'onglet **Configuration** — affiche l'image de conteneur actuelle, les variables d'environnement (non sensibles) et les limites de ressources.

**Instance Cloud SQL :**
Accédez à **SQL** dans la console GCP. Trouvez l'instance nommée `app-sql-<deployment_id>`. Cliquez sur l'instance pour afficher :
- **Vue d'ensemble** — nom de connexion, région, version de PostgreSQL, utilisation du stockage.
- **Bases de données** — la base de données `umami`.
- **Utilisateurs** — l'utilisateur de l'application `umami`.
- **Connexions** — connexions actives depuis le service Cloud Run via Auth Proxy.
- **Sauvegardes** — calendrier de sauvegarde automatisé et points de restauration.

**Secret Manager :**
Accédez à **Security → Secret Manager**. Trouvez les secrets nommés `secret-<tenant_resource_prefix>-<application_name>-app-secret` (ou similaire). Cliquez sur un secret pour afficher :
- Les versions du secret et les horodatages de création.
- Les entrées du journal d'accès montrant quand Cloud Run a lu le secret.
- La politique de réplication.

**Artifact Registry :**
Accédez à **Artifact Registry**. Trouvez le dépôt pour ce déploiement. Cliquez pour afficher les images Umami mises en miroir, leurs tags, leurs tailles et l'état de la politique de rétention.

**Vérifications de la disponibilité de Cloud Monitoring :**
Si `uptime_check_config.enabled = true` a été défini, accédez à **Monitoring → Uptime checks** et trouvez la vérification pour ce déploiement Umami ciblant `/api/heartbeat`. Affichez les résultats de la vérification, le temps de réponse et l'historique des échecs dans les régions GCP.

### E. Exploration avec gcloud {#e-exploring-with-gcloud}

Utilisez ces commandes gcloud pour inspecter le déploiement Umami depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

```bash
# List Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.url,status.conditions[0].type)"

# Describe the Umami Cloud Run service
gcloud run services describe SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="yaml(status.url,spec.template.spec.containers[0].resources)"

# View the latest revision
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=SERVICE_NAME \
  --format="table(name,status.conditions[0].type,spec.containerConcurrency,metadata.creationTimestamp)"

# Tail Cloud Run logs
gcloud run services logs tail SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# Check Cloud SQL instance status
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.tier)"

# List databases in the Cloud SQL instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Secret Manager secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime,replication.auto)"

# Describe the APP_SECRET secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID

# View uptime check results (Cloud Monitoring)
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"

# List Artifact Registry images for Umami
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Check Cloud Run IAM policy
gcloud run services get-iam-policy SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# View Cloud Build triggers for this deployment
gcloud builds triggers list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime,github.push.branch)"
```

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Umami CloudRun`, quelles que soient les valeurs des variables. Ils ne peuvent pas être annulés via `tfvars`.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | Valeur par défaut de `database_type = "POSTGRES_15"` | Umami nécessite PostgreSQL. MySQL et les autres moteurs ne sont pas pris en charge. |
| **DATABASE_URL construite au moment de l'exécution** | Point d'entrée personnalisé en mode image `Umami Common` | Le mode image `custom` construit une enveloppe qui assemble `DATABASE_URL` à partir des variables DB_* injectées par la plateforme. L'utilisation du mode `prebuilt` nécessite une configuration manuelle de `DATABASE_URL`. |
| **APP_SECRET auto-généré** | `random_password` dans `Umami Common` | Secret alphanumérique de 32 caractères, stocké dans Secret Manager, injecté en tant que `APP_SECRET`. |
| **Pas de buckets de stockage par défaut** | Valeur par défaut de `storage_buckets = []` | Umami est sans état — aucun bucket GCS n'est provisionné sauf configuration explicite. |
| **Mise en miroir d'images activée par défaut** | `enable_image_mirroring = true` | Met en miroir depuis GitHub Container Registry (`ghcr.io`) vers Artifact Registry pour éviter les limites de débit. |
| **Job db-init par défaut** | Fourni par `Umami Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement avant qu'Umami n'exécute ses propres migrations. |
| **Migrations Prisma au démarrage** | Comportement du conteneur Umami | Umami exécute ses propres migrations de base de données Prisma à chaque démarrage. Le job `db-init` ne fait que pré-créer la base de données et l'utilisateur. |
| **Pas de Redis requis** | Valeur par défaut de `enable_redis = false` | Umami utilise uniquement PostgreSQL pour tout le stockage de données. Redis n'est pas requis. |
| **Répertoire des scripts** | `scripts_dir = abspath("${module.umami_app.path}/scripts")` | Les scripts d'initialisation proviennent de `Umami Common`, et non du répertoire de déploiement. |

L'**infrastructure intégrée** (lorsqu'aucune pile `Services_GCP` n'est présente) est identique à `App_CloudRun` §9 — `App_CloudRun` provisionne un VPC intégré, Cloud NAT, une instance Cloud SQL, des comptes de service et les API GCP selon les besoins. Voir [App_CloudRun](./App_CloudRun.md#dependency-on-services-gcp-for-shared-resources) pour l'inventaire complet des ressources intégrées et les notes de suppression.

---

## 10. Référence des variables {#10-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Umami CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `resource_creator_identity` | 0 | (SA de la plateforme) | Compte de service utilisé par Terraform pour gérer les ressources. |
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'umami'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `'Umami'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `'Umami Analytics on Cloud Run'` | Description du service. |
| `application_version` | 3 | `'postgresql-latest'` | Tag de l'image du conteneur Umami. Utilisez des tags préfixés par `postgresql-`. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | URI de l'image du conteneur. |
| `container_build_config` | 4 | `{ enabled=true }` | Configuration Cloud Build pour les constructions d'images personnalisées. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Umami dans Artifact Registry. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. |
| `min_instance_count` | 4 | `0` | Instances minimales (0 = mise à l'échelle à zéro). |
| `max_instance_count` | 4 | `3` | Instances maximales. |
| `container_port` | 4 | `3000` | Port natif d'Umami. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Génération de l'environnement d'exécution Cloud Run. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut. Définissez `true` pour allouer le CPU en permanence. |
| `enable_cloudsql_volume` | 4 | `true` | Monte l'instance Cloud SQL via l'intégration native de socket Cloud Run (pas de sidecar Auth Proxy sur Cloud Run). |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix Cloud SQL. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair (par exemple, `{ DISABLE_TELEMETRY = "1" }`). |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image au déploiement. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Mode d'application de Binary Authorization. Non référencé dans ce module. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Contrôle le provisionnement des buckets GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami n'a pas besoin de stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne un stockage partagé NFS. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin de montage NFS du conteneur. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé CMEK KMS pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `application_database_user` | 12 | `'umami'` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation des extensions PostgreSQL. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laissez vide pour que `Umami Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés à côté d'Umami. |
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | Sonde de démarrage. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de démarrage Cloud Run (passée directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (passée directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Vérification de la disponibilité de Cloud Monitoring (désactivée par défaut). |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |
| `enable_redis` | 16 | `false` | Active l'injection de variables d'environnement Redis. Non requis pour Umami. |
| `redis_host` | 16 | `""` | Nom d'hôte/IP Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP Redis (chaîne). |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans bloquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet si vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |

---

## 11. Sorties {#11-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Umami ne prend en charge que PostgreSQL. La configuration de MySQL ou d'un autre moteur cassera la construction `DATABASE_URL` et entraînera l'échec d'Umami au démarrage avec une erreur de connexion à la base de données. |
| `application_database_name` | `"umami"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur entraîne la recréation de la base de données par Terraform, détruisant toutes les données analytiques collectées par Umami. |
| `application_database_user` | `"umami"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur recrée l'utilisateur Cloud SQL, invalidant toutes les informations d'identification stockées et rompant la connexion d'Umami à la base de données. |
| `container_port` | `3000` | **Critique** | Umami écoute sur le port 3000. La modification de cette valeur sans faire correspondre le port lié du conteneur entraîne l'échec des sondes de santé Cloud Run et le marquage du service comme non sain. |
| `container_image_source` | `"custom"` | **Élevé** | Le mode `custom` construit une image wrapper qui assemble `DATABASE_URL` à partir des variables DB_*. L'utilisation de `"prebuilt"` avec l'image officielle d'Umami nécessite de fournir manuellement `DATABASE_URL` comme variable d'environnement — sans cela, Umami ne peut pas se connecter à PostgreSQL et plantera au démarrage. |
| `application_version` | `"postgresql-latest"` | **Moyen** | Utilisez toujours une balise préfixée `postgresql-` (par exemple, `postgresql-latest`, `postgresql-v2.11.3`). Les balises de version simples (par exemple, `latest`) ne sont pas publiées pour la variante PostgreSQL d'Umami et entraîneront une erreur de tirage de conteneur. |
| `admin_password` | _(à changer lors de la première connexion)_ | **Critique** | Les informations d'identification par défaut de l'administrateur Umami sont `admin` / `umami` — largement connues. Le fait de ne pas les changer lors de la première connexion expose votre tableau de bord analytique et toutes les données suivies à quiconque connaît l'URL. |
| `enable_iap` | `false` | **Moyen** | Sans IAP, quiconque connaît l'URL Cloud Run peut accéder à la page de connexion du tableau de bord Umami. L'authentification propre à Umami est la seule barrière. Activez IAP ou assurez-vous que `ingress_settings = "internal"` pour les déploiements privés. |
| `ingress_settings` | `"all"` | **Moyen** | `"all"` expose Umami publiquement. Le point de terminaison du script de suivi doit être publiquement accessible pour que les sites web suivis puissent rapporter des données, mais le tableau de bord d'administration doit être restreint pour les déploiements sensibles. Envisagez d'utiliser IAP ou un domaine personnalisé avec un accès restreint pour les chemins d'administration. |
| `min_instance_count` | `0` | **Faible** | La mise à l'échelle à zéro est sûre pour Umami — les démarrages à froid sont rapides (quelques secondes). Cependant, la première requête après un démarrage à froid subira une légère latence. Définissez sur `1` pour les tableaux de bord analytiques sensibles au temps. |
| `memory_limit` | `"512Mi"` | **Moyen** | 512 Mio est la valeur par défaut et suffisante pour un trafic modéré. Les sites à fort trafic avec de nombreux utilisateurs de tableau de bord simultanés ou des requêtes complexes peuvent rencontrer des erreurs OOM. Augmentez à `1Gi` si vous observez une pression mémoire dans Cloud Monitoring. |
| `enable_backup_import` | `false` | **Critique** | Nécessite qu'un fichier de sauvegarde valide soit accessible à `backup_file`. L'activation avec un chemin invalide entraîne l'échec du job Cloud Run de restauration pendant l'apply. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours est le minimum pour l'analyse de production. La perte de l'historique analytique a un impact commercial direct. Augmentez à plus de 30 jours pour tout déploiement analytique à long terme. |
| `secret_propagation_delay` | `30` | **Faible** | Occasionnellement insuffisant dans les configurations multi-régions. Augmentez à 60–90 s si des erreurs de lecture de secret sont observées pendant l'apply. |
| `enable_cloudsql_volume` | `true` | **Critique** | Sur Cloud Run, cela monte l'intégration de socket Cloud SQL *native* — il n'y a pas de sidecar Auth Proxy et pas de listener TCP `127.0.0.1:5432` (cela n'existe que sur GKE). Le point d'entrée partagé `Umami_Common` (`umami-entrypoint.sh`) résout inconditionnellement un chemin de socket `DB_HOST` vers `127.0.0.1` avant de construire `DATABASE_URL`, ce qui n'est valide que sur GKE — sur Cloud Run, cela produit `ECONNREFUSED 127.0.0.1:5432` dans les logs de révision et la sonde de démarrage échoue. Si Umami ne démarre pas, vérifiez les variables `DB_HOST`/`DB_IP` injectées de la révision déployée (`gcloud run revisions describe … --format=json`) plutôt que de supposer que la substitution de bouclage fonctionne. |
| `vpc_sc_dry_run` | `true` | **Moyen** | VPC-SC enregistre les violations en mode simulation mais ne les bloque pas. Après avoir vérifié l'absence de faux positifs dans Cloud Logging, passez à `false` pour une application réelle. Laisser en permanence `true` n'offre aucun avantage en matière de sécurité. |

---

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : Libération de l'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run. Terraform/OpenTofu ne peut pas terminer la suppression du sous-réseau ou du VPC tant qu'elles ne sont pas entièrement libérées.

**Résolution :** Attendez 20 à 30 minutes après la première tentative de destruction, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Umami sur Cloud Run](../labs/Umami_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Umami GKE — Guide de configuration](Umami_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Umami](Umami_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Directus sur Cloud Run](Directus_CloudRun.md) dans la solution **Plateforme de contenu sans tête**.
