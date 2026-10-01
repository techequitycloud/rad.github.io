---
title: "Umami sur Google Cloud Run"
description: "Référence de configuration pour déployer Umami sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Umami_CloudRun.md @ 3055034 sha256:3b0702bbd2f9 -->

# Umami sur Google Cloud Run {#umami-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_CloudRun.png" alt="Umami sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document constitue une référence complète du module Terraform `modules/Umami_CloudRun`. Il couvre l'architecture, l'IAM, les variables de configuration, les comportements propres à Umami et les modèles d'exploitation pour déployer Umami sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Umami est une plateforme d'analyse web open source, légère et respectueuse de la vie privée — une alternative auto-hébergée à Google Analytics. Elle collecte les données de trafic et d'événements des sites web sans cookies ni données personnelles, ce qui la rend conforme au RGPD (GDPR), au CCPA et au PECR dès l'installation. `Umami CloudRun` est un **module wrapper** construit sur `App CloudRun`. Il s'appuie sur `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte, via `Umami Common`, la configuration applicative propre à Umami, l'initialisation de la base de données et la gestion des secrets.

**Fonctionnalités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Next.js, 1 vCPU / 512Mi par défaut. La mise à l'échelle à zéro (`min_instance_count = 0`) est prise en charge ; `max_instance_count` vaut 3 par défaut.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. Aucun stockage GCS n'est provisionné par défaut.
*   **Sécurité** : `APP_SECRET` est généré automatiquement par `Umami Common` et stocké dans Secret Manager. Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls d'`App CloudRun`.
*   **Confidentialité** : aucun cookie utilisé par défaut, aucune donnée personnelle stockée, entièrement conforme au RGPD/CCPA/PECR.
*   **Point de terminaison de santé** : Umami expose `/api/heartbeat` comme point de terminaison de santé. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.
*   **CI/CD** : pipeline d'image Cloud Build personnalisée par défaut ; livraison progressive Cloud Deploy en option.
*   **Suivi** : après le déploiement, intégrez `<script async src="https://<your-url>/script.js" data-website-id="..."></script>` dans les sites web suivis.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `string` | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'umami'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `application_display_name` | 3 | `string` | `'Umami'` | Nom lisible affiché dans la console GCP. |
| `application_description` | 3 | `string` | `'Umami Analytics on Cloud Run'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'postgresql-latest'` | Tag de version de l'image Umami. Utilisez un tag préfixé par `postgresql-` (p. ex. `postgresql-latest`, `postgresql-v2.11.3`). |

**Architecture du wrapper :** `Umami CloudRun` appelle `Umami Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Umami, la configuration des sondes et la définition de la tâche `db-init`. `module_secret_env_vars` transporte `APP_SECRET` depuis `Umami Common`. Le `DATABASE_URL` est construit à l'exécution à partir des variables de plateforme DB_* injectées par `App CloudRun`. `scripts_dir` est résolu en `abspath("${module.umami_app.path}/scripts")` au moment de l'apply.

**Remarque sur PostgreSQL :** Umami exige **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être modifiée.

**Identifiants administrateur par défaut :** au premier déploiement, connectez-vous avec le nom d'utilisateur `admin` et le mot de passe `umami`. Modifiez-les immédiatement après la première connexion.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Umami_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux d'[App_CloudRun](./App_CloudRun.md#2-iam--access-control).

**Secret applicatif généré automatiquement :** `Umami Common` génère `APP_SECRET` au moment de l'apply à l'aide de `random_password` (32 caractères, sans caractères spéciaux). Il est écrit dans Secret Manager et injecté dans le conteneur Cloud Run en tant que variable d'environnement `APP_SECRET`. La valeur en clair n'est jamais stockée dans l'état Terraform après l'apply initial.

**Identité d'initialisation de la base de données :** le Job Cloud Run `db-init` s'exécute sous le compte de service Cloud Run. Il se connecte à Cloud SQL PostgreSQL via l'intégration native du socket Cloud SQL de Cloud Run (`run.googleapis.com/cloudsql-instances`, puisque `enable_cloudsql_volume = true` par défaut), à l'aide de `DB_HOST` (le chemin du socket sous `/cloudsql`), `DB_USER` et `DB_PASSWORD` (provenant de Secret Manager). Cloud Run n'a pas de sidecar Auth Proxy — ce mécanisme n'existe que sur GKE.

**Délai de propagation des secrets de 30 secondes :** `Umami Common` insère une attente de propagation après la création des secrets. La variable `secret_propagation_delay` (30 secondes par défaut) contrôle la durée pendant laquelle les ressources dépendantes attendent après la création d'un secret avant de poursuivre.

Pour les tableaux de rôles complets et les détails sur IAP, la rotation des mots de passe et l'accès public, consultez [App_CloudRun](./App_CloudRun.md#2-iam--access-control).

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Umami est une application Next.js légère aux besoins en ressources modestes. `Umami CloudRun` expose `cpu_limit` et `memory_limit` en tant que variables dédiées de premier niveau.

**La mise à l'échelle à zéro est prise en charge** (`min_instance_count = 0` par défaut). Les démarrages à froid d'Umami sont rapides — l'application est légère et n'effectue aucune opération de démarrage lente.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut par défaut `'custom'`, ce qui signifie que Cloud Build construit une image wrapper qui associe les variables d'environnement DB_* de la plateforme au `DATABASE_URL` d'Umami. Définissez `container_image_source = 'prebuilt'` et configurez `DATABASE_URL` manuellement pour déployer directement l'image officielle `ghcr.io/umami-software/umami`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement limité à l'infrastructure (SQL, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build (associe DB_* à DATABASE_URL). `'prebuilt'` déploie une URI d'image existante. |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | Image de base. Remplacez-la pour utiliser une image construite sur mesure ou une copie miroir. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU suffit pour la plupart des déploiements d'Umami. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. Passez à 1Gi pour les sites à fort trafic. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances. Définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances. Umami se met à l'échelle horizontalement — tout l'état est dans PostgreSQL. |
| `container_port` | 4 | `3000` | Port HTTP natif d'Umami. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommandé pour les performances. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | 4 | `true` | `true` par défaut — Umami se connecte via l'intégration native du socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir la section 3.D). |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête — le CPU n'est facturé que pendant le traitement d'une requête. Définissez `true` pour allouer le CPU en permanence (facturation à l'instance). |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green en pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut d'`App CloudRun` :**

| Variable | `App CloudRun` | `Umami CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Port Next.js natif d'Umami. |
| `cpu_limit` | `'1000m'` | `'1000m'` | Identique — Umami est léger. |
| `memory_limit` | `'512Mi'` | `'512Mi'` | Identique — Umami a des besoins en mémoire modestes. |
| `max_instance_count` | `1` | `3` | Umami se met à l'échelle horizontalement sans risque — tout l'état est dans PostgreSQL. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Umami exige **PostgreSQL 15**. Le module provisionne une instance Cloud SQL PostgreSQL 15 et crée une base de données et un utilisateur dédiés à Umami.

**Construction de DATABASE_URL :** le point d'entrée personnalisé (en mode d'image `custom`) construit `DATABASE_URL` à partir des variables `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` et `DB_PORT` injectées par la plateforme. Cela évite d'avoir à transmettre une chaîne de connexion en clair.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. **Ne le modifiez pas après le déploiement initial.** |
| `application_database_user` | 12 | `'umami'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant le redémarrage du service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation d'extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer (p. ex. `['uuid-ossp']`). |

### C. Stockage (GCS) {#c-storage-gcs}

**Aucun stockage par défaut.** Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. `storage_buckets` vaut par défaut une liste vide. Ne provisionnez des buckets supplémentaires qu'en cas de besoin pour des usages personnalisés (p. ex. des exports de sauvegarde).

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Détermine si le module provisionne les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami ne nécessite aucun stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne une instance NFS Cloud Filestore. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. Utilisé uniquement lorsque `enable_nfs = true`. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise la sortie VPC directe (Direct VPC Egress) pour joindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, l'intégration Cloud SQL *native* de Cloud Run (annotation `run.googleapis.com/cloudsql-instances`) monte un socket Unix dans `/cloudsql/<proj:region:inst>` et injecte `DB_HOST` comme répertoire de ce socket. **Il n'y a ni sidecar Auth Proxy ni écouteur TCP `127.0.0.1:5432` sur Cloud Run** — ce mécanisme n'existe que sur GKE, où un véritable sidecar `cloud-sql-proxy` écoute sur l'interface de bouclage. Le point d'entrée `Umami_Common` (`scripts/umami-entrypoint.sh`, partagé avec `Umami_GKE`) résout un `DB_HOST` de type chemin de socket en `127.0.0.1` avant d'assembler `DATABASE_URL` — une correspondance valable uniquement sur GKE. Sur Cloud Run, cela produit `ECONNREFUSED 127.0.0.1:5432` et un échec de la sonde de démarrage. Consultez le tableau des pièges de configuration ci-dessous.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` n'achemine via le VPC que le trafic RFC 1918. `'ALL_TRAFFIC'` achemine toute la sortie via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un Job Cloud Run `db-init` est provisionné automatiquement par `Umami Common` lorsque `initialization_jobs` est laissé à sa valeur par défaut, une liste vide (`[]`). Il utilise une image cliente PostgreSQL et exécute `Umami_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via l'intégration native du socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir la section 3.D).
2. Crée l'utilisateur de base de données `umami` avec le mot de passe provenant de Secret Manager.
3. Crée la base de données `umami` si elle n'existe pas.
4. Accorde à l'utilisateur `umami` tous les privilèges sur la base de données.

Umami exécute lui-même ses propres migrations de base de données basées sur Prisma au premier démarrage — la tâche `db-init` ne fait que pré-créer la base de données et l'utilisateur afin que les migrations d'Umami puissent s'exécuter correctement.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour qu'`Umami Common` fournisse la tâche `db-init` par défaut. Une liste non vide la remplace entièrement. |
| `cron_jobs` | 13 | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés aux côtés de l'application principale. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une règle Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit à 500 req/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un LB HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (p. ex. VPN du bureau, IP de sortie du CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Une authentification par identité Google est exigée avant que les requêtes n'atteignent Umami. Utile pour restreindre l'accès aux analyses aux seuls membres de l'équipe interne.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

**Remarque :** IAP protège le tableau de bord d'Umami. Le script de suivi (`/script.js`) et le point de terminaison des événements (`/api/send`) doivent rester accessibles publiquement pour que les sites web suivis puissent transmettre leurs données. Si vous appliquez IAP, veillez à exempter les chemins de suivi ou à utiliser une configuration d'entrée distincte.

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Nécessite une règle Binary Authorization et un attesteur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés dans un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Le `APP_SECRET` d'Umami est stocké dans Secret Manager et injecté nativement par Cloud Run au démarrage de la révision — la valeur en clair n'est jamais écrite dans l'état Terraform.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Correspondance nom de variable d'environnement → ID de secret Secret Manager. Résolue à l'exécution ; jamais stockée dans l'état. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG serverless est provisionné. Le trafic circule ainsi : Internet → Cloud Armor → LB HTTPS global → NEG serverless → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic d'Umami à passer par le LB, empêchant l'accès direct par l'URL `*.run.app`.

Consultez [App_CloudRun](./App_CloudRun.md#a-https-load-balancer) pour tous les détails de l'architecture.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est associé au backend de l'équilibreur de charge HTTPS.

**Point d'attention pour Umami :** le tableau de bord d'Umami est une application Next.js dynamique. Cloud CDN est utile pour mettre en cache les ressources statiques d'Umami (bundles JavaScript, CSS), mais ne doit pas mettre en cache les réponses d'API (`/api/*`), qui contiennent des données d'analyse en temps réel. Veillez à définir des en-têtes `Cache-Control` appropriés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend du LB HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag (orphelines) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lesquels les images deviennent éligibles à la suppression. Définissez `0` pour désactiver la suppression selon l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont associés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour le LB HTTPS. Un certificat SSL géré par Google est provisionné pour chaque domaine. (p. ex. `['analytics.example.com']`) |

Après le premier apply, récupérez l'IP du LB et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10–30 minutes après la propagation DNS.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Le déclencheur construit et déploie une image Umami personnalisée lorsque du code est poussé sur la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Requis au premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de la GitHub App (recommandé pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est remplacé par un pipeline de livraison Cloud Deploy géré, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` (mise à l'échelle à zéro) par défaut. Les démarrages à froid d'Umami sont rapides — l'application Next.js démarre en quelques secondes, sans opération lourde au premier démarrage. `max_instance_count = 3` par défaut. Umami se met à l'échelle horizontalement sans risque, car tout l'état est dans PostgreSQL.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. Umami stocke toutes les données d'analyse dans PostgreSQL (partagé entre toutes les instances), ce qui rend les déploiements canary sûrs — n'importe quelle révision peut traiter les requêtes et écrire dans la même base de données.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage entre des révisions nommées. La somme de toutes les entrées doit être égale à 100. Une liste vide envoie 100 % du trafic à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Umami expose `/api/heartbeat` comme point de terminaison de santé dédié. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=10, failure_threshold=30 }` | Sonde de disponibilité au démarrage. Le conteneur ne reçoit aucun trafic tant qu'elle n'a pas réussi. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30 }` | Sonde de démarrage Cloud Run (transmise directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (transmise directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). Lorsqu'il est activé, des alertes préviennent `support_users` en cas d'indisponibilité. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un Job Cloud Run de rotation.
3. La tâche génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, la tâche redémarre le service Umami.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après l'écriture du nouveau secret avant le redémarrage du service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de rotation. Par défaut : 30 jours. |

---

## 8. Intégrations {#8-integrations}

### A. Cache Redis {#a-redis-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Umami ne nécessite pas Redis — tout l'état est stocké dans PostgreSQL. Ne l'activez que si vous intégrez une couche de cache externe pour des usages personnalisés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 16 | `false` | Active Redis en injectant les variables d'environnement `REDIS_HOST` et `REDIS_PORT`. Umami ne nécessite pas Redis. |
| `redis_host` | 16 | `""` | Nom d'hôte ou IP du serveur Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP du serveur Redis (chaîne). |

### B. Import de sauvegarde et restauration {#b-backup-import--recovery}

Lorsque `enable_backup_import = true`, un Job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) des sauvegardes quotidiennes automatiques. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. Repassez à `false` après un import réussi. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complète) ou `'gdrive'` (ID de fichier Drive). |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

### C. Observabilité et alertes {#c-observability--alerting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Configuration du test de disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les tests de disponibilité et les déclenchements des règles d'alerte. |

### D. Explorer avec la console GCP {#d-exploring-with-the-gcp-console}

Après un déploiement réussi, explorez l'installation d'Umami dans la console GCP :

**Service Cloud Run :**
Accédez à **Cloud Run** dans la console GCP. Trouvez le service nommé `app<application_name><tenant_id><deployment_id>` (p. ex. `appumamidemoxyz`). Cliquez sur le service pour afficher :
- L'URL du service — utilisez-la pour accéder au tableau de bord d'Umami.
- Onglet **Revisions** — liste toutes les révisions déployées avec leur pourcentage de trafic.
- Onglet **Logs** — diffuse les journaux du conteneur, y compris les journaux de démarrage et de requêtes d'Umami.
- Onglet **Metrics** — affiche le nombre de requêtes, la latence, le nombre d'instances et l'utilisation du CPU et de la mémoire.
- Onglet **Configuration** — affiche l'image de conteneur actuelle, les variables d'environnement (non sensibles) et les limites de ressources.

**Instance Cloud SQL :**
Accédez à **SQL** dans la console GCP. Trouvez l'instance nommée `app-sql-<deployment_id>`. Cliquez sur l'instance pour afficher :
- **Overview** — nom de connexion, région, version de PostgreSQL, utilisation du stockage.
- **Databases** — la base de données `umami`.
- **Users** — l'utilisateur applicatif `umami`.
- **Connections** — connexions actives depuis le service Cloud Run via l'Auth Proxy.
- **Backups** — planification des sauvegardes automatiques et points de restauration.

**Secret Manager :**
Accédez à **Security → Secret Manager**. Trouvez les secrets nommés `secret-<tenant_resource_prefix>-<application_name>-app-secret` (ou similaire). Cliquez sur un secret pour afficher :
- Les versions du secret et leurs horodatages de création.
- Les entrées du journal d'accès indiquant quand Cloud Run a lu le secret.
- La règle de réplication.

**Artifact Registry :**
Accédez à **Artifact Registry**. Trouvez le dépôt de ce déploiement. Cliquez dessus pour afficher les images Umami copiées en miroir, leurs tags, leurs tailles et l'état de la règle de rétention.

**Tests de disponibilité Cloud Monitoring :**
Si `uptime_check_config.enabled = true` a été défini, accédez à **Monitoring → Uptime checks** et trouvez le test de ce déploiement d'Umami ciblant `/api/heartbeat`. Consultez les résultats des tests, le temps de réponse et l'historique des échecs dans les différentes régions GCP.

### E. Explorer avec gcloud {#e-exploring-with-gcloud}

Utilisez ces commandes gcloud pour inspecter le déploiement d'Umami depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

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

Les comportements suivants sont appliqués automatiquement par `Umami CloudRun`, quelles que soient les valeurs des variables. Ils ne peuvent pas être remplacés via `tfvars`.

| Comportement | Mise en œuvre | Détail |
|---|---|---|
| **PostgreSQL 15 obligatoire** | Valeur par défaut `database_type = "POSTGRES_15"` | Umami exige PostgreSQL. MySQL et les autres moteurs ne sont pas pris en charge. |
| **DATABASE_URL construit à l'exécution** | Point d'entrée personnalisé dans l'image `Umami Common` | Le mode d'image `custom` construit un wrapper qui assemble `DATABASE_URL` à partir des variables DB_* injectées par la plateforme. Le mode `prebuilt` nécessite de configurer `DATABASE_URL` manuellement. |
| **APP_SECRET généré automatiquement** | `random_password` dans `Umami Common` | Secret alphanumérique de 32 caractères, stocké dans Secret Manager, injecté en tant que `APP_SECRET`. |
| **Aucun bucket de stockage par défaut** | Valeur par défaut `storage_buckets = []` | Umami est sans état — aucun bucket GCS n'est provisionné sauf configuration explicite. |
| **Copie miroir des images activée par défaut** | `enable_image_mirroring = true` | Copie les images depuis GitHub Container Registry (`ghcr.io`) vers Artifact Registry pour éviter les limitations de débit. |
| **Tâche db-init par défaut** | Fournie par `Umami Common` lorsque `initialization_jobs = []` | La base de données PostgreSQL et l'utilisateur sont créés automatiquement avant qu'Umami n'exécute ses propres migrations. |
| **Migrations Prisma au démarrage** | Comportement du conteneur Umami | Umami exécute ses propres migrations de base de données Prisma à chaque démarrage. La tâche `db-init` ne fait que pré-créer la base de données et l'utilisateur. |
| **Redis non requis** | Valeur par défaut `enable_redis = false` | Umami n'utilise que PostgreSQL pour le stockage de toutes ses données. Redis n'est pas nécessaire. |
| **Répertoire des scripts** | `scripts_dir = abspath("${module.umami_app.path}/scripts")` | Les scripts d'initialisation proviennent d'`Umami Common`, et non du répertoire de déploiement. |

**L'infrastructure intégrée** (lorsqu'aucune pile `Services_GCP` n'est présente) est identique à celle de la section 9 d'`App_CloudRun` — `App_CloudRun` provisionne au besoin un VPC intégré, Cloud NAT, une instance Cloud SQL, des comptes de service et les API GCP. Consultez [App_CloudRun](./App_CloudRun.md#9-inline-infrastructure-provisioning) pour l'inventaire complet des ressources intégrées et les remarques sur leur suppression.

---

## 10. Référence des variables {#10-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Umami CloudRun`, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `resource_creator_identity` | 0 | (compte de service de la plateforme) | Compte de service utilisé par Terraform pour gérer les ressources. |
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail destinataires des alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'umami'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `application_display_name` | 3 | `'Umami'` | Nom lisible affiché dans la console GCP. |
| `application_description` | 3 | `'Umami Analytics on Cloud Run'` | Description du service. |
| `application_version` | 3 | `'postgresql-latest'` | Tag de l'image de conteneur Umami. Utilisez des tags préfixés par `postgresql-`. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement limité à l'infrastructure. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | URI de l'image de conteneur. |
| `container_build_config` | 4 | `{ enabled=true }` | Configuration Cloud Build pour la construction d'images personnalisées. |
| `enable_image_mirroring` | 4 | `true` | Copie l'image Umami en miroir dans Artifact Registry. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances (0 = mise à l'échelle à zéro). |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances. |
| `container_port` | 4 | `3000` | Port natif d'Umami. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Génération de l'environnement d'exécution Cloud Run. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête par défaut. Définissez `true` pour allouer le CPU en permanence. |
| `enable_cloudsql_volume` | 4 | `true` | Monte l'instance Cloud SQL via l'intégration native par socket de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run). |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix Cloud SQL. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés via IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés via IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en clair (p. ex. `{ DISABLE_TELEMETRY = "1" }`). |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) des sauvegardes automatiques. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de la GitHub App. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images lors du déploiement. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Mode d'application de Binary Authorization. Non référencé dans ce module. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un LB HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lesquels les images deviennent éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Contrôle le provisionnement des buckets GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami n'a besoin d'aucun stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne un stockage partagé NFS. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin de montage NFS dans le conteneur. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. Ne le modifiez pas après le déploiement initial. |
| `application_database_user` | 12 | `'umami'` | Utilisateur applicatif PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant le redémarrage du service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation d'extensions PostgreSQL. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour qu'`Umami Common` fournisse la tâche `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés aux côtés d'Umami. |
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | Sonde de démarrage. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de démarrage Cloud Run (transmise directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (transmise directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |
| `enable_redis` | 16 | `false` | Active l'injection des variables d'environnement Redis. Non requis pour Umami. |
| `redis_host` | 16 | `""` | Nom d'hôte/IP Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP Redis (chaîne). |
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet s'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux Cloud Audit Logs détaillés. |

---

## 11. Sorties {#11-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Nom de l'utilisateur de la base de données applicative. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou fortement dégradé) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Umami ne prend en charge que PostgreSQL. Choisir MySQL ou un autre moteur casse la construction de `DATABASE_URL` et fait échouer le démarrage d'Umami avec une erreur de connexion à la base de données. |
| `application_database_name` | `"umami"` | **Critique** | Immuable après le premier déploiement — le modifier amène Terraform à recréer la base de données, ce qui détruit toutes les données d'analyse collectées par Umami. |
| `application_database_user` | `"umami"` | **Critique** | Immuable après le premier déploiement — le modifier recrée l'utilisateur Cloud SQL, invalide tous les identifiants stockés et coupe la connexion d'Umami à la base de données. |
| `container_port` | `3000` | **Critique** | Umami écoute sur le port 3000. Modifier cette valeur sans l'aligner sur le port lié par le conteneur fait échouer les sondes de santé de Cloud Run et marque le service comme défaillant. |
| `container_image_source` | `"custom"` | **Élevé** | Le mode `custom` construit une image wrapper qui assemble `DATABASE_URL` à partir des variables DB_*. Utiliser `"prebuilt"` avec l'image officielle d'Umami nécessite de fournir manuellement `DATABASE_URL` comme variable d'environnement — sans elle, Umami ne peut pas se connecter à PostgreSQL et plante au démarrage. |
| `application_version` | `"postgresql-latest"` | **Moyen** | Utilisez toujours un tag préfixé par `postgresql-` (p. ex. `postgresql-latest`, `postgresql-v2.11.3`). Les tags de version simples (p. ex. `latest`) ne sont pas publiés pour la variante PostgreSQL d'Umami et provoquent une erreur de récupération de l'image de conteneur. |
| `admin_password` | _(à modifier à la première connexion)_ | **Critique** | Les identifiants administrateur par défaut d'Umami sont `admin` / `umami` — largement connus. Ne pas les modifier à la première connexion expose votre tableau de bord d'analyse et toutes les données suivies à quiconque connaît l'URL. |
| `enable_iap` | `false` | **Moyen** | Sans IAP, quiconque connaît l'URL Cloud Run peut accéder à la page de connexion du tableau de bord d'Umami. L'authentification propre à Umami est alors la seule barrière. Activez IAP ou assurez-vous que `ingress_settings = "internal"` pour les déploiements privés. |
| `ingress_settings` | `"all"` | **Moyen** | `"all"` expose Umami publiquement. Le point de terminaison du script de suivi doit être accessible publiquement pour que les sites suivis transmettent leurs données, mais le tableau de bord d'administration doit être restreint pour les déploiements sensibles. Envisagez d'utiliser IAP ou un domaine personnalisé à accès restreint pour les chemins d'administration. |
| `min_instance_count` | `0` | **Faible** | La mise à l'échelle à zéro est sans risque pour Umami — les démarrages à froid sont rapides (quelques secondes). La première requête après un démarrage à froid subit toutefois une légère latence. Définissez `1` pour les tableaux de bord d'analyse sensibles au temps de réponse. |
| `memory_limit` | `"512Mi"` | **Moyen** | 512Mi est la valeur par défaut et suffit pour un trafic modéré. Les sites à fort trafic, avec de nombreux utilisateurs simultanés du tableau de bord ou des requêtes complexes, peuvent subir des OOM. Passez à `1Gi` si vous observez une pression mémoire dans Cloud Monitoring. |
| `enable_backup_import` | `false` | **Critique** | Nécessite qu'un fichier de sauvegarde valide soit accessible à `backup_file`. L'activer avec un chemin invalide fait échouer le job Cloud Run de restauration pendant l'apply. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours est un minimum pour des analyses en production. La perte de l'historique d'analyse a un impact direct sur l'activité. Passez à 30 jours ou plus pour tout déploiement d'analyse à long terme. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multirégionales. Passez à 60–90 s si des erreurs de lecture de secrets sont observées pendant l'apply. |
| `enable_cloudsql_volume` | `true` | **Critique** | Sur Cloud Run, cela monte l'intégration *native* du socket Cloud SQL — il n'y a ni sidecar Auth Proxy ni écouteur TCP `127.0.0.1:5432` (cela n'existe que sur GKE). Le point d'entrée partagé `Umami_Common` (`umami-entrypoint.sh`) résout sans condition un `DB_HOST` de type chemin de socket en `127.0.0.1` avant de construire `DATABASE_URL`, ce qui n'est valable que sur GKE — sur Cloud Run, cela produit `ECONNREFUSED 127.0.0.1:5432` dans les journaux de la révision et la sonde de démarrage échoue. Si Umami ne démarre pas, vérifiez les `DB_HOST`/`DB_IP` injectés dans la révision déployée (`gcloud run revisions describe … --format=json`) plutôt que de supposer que la substitution par l'adresse de bouclage fonctionne. |
| `vpc_sc_dry_run` | `true` | **Moyen** | Le mode simulation (dry-run) de VPC-SC journalise les violations mais ne les bloque pas. Après avoir vérifié l'absence de faux positifs dans Cloud Logging, passez à `false` pour une application effective. Le laisser à `true` en permanence n'apporte aucun bénéfice de sécurité. |

---

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la suppression d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à celle-ci :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 serverless sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20–30 minutes** après la suppression du service Cloud Run. Terraform/OpenTofu ne peut pas terminer la suppression du sous-réseau ou du VPC tant qu'elles ne sont pas entièrement libérées.

**Résolution :** attendez 20–30 minutes après la première tentative de suppression, puis relancez la commande destroy :

```bash
tofu destroy
```

La deuxième exécution réussira dès que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Umami sur Cloud Run](../labs/Umami_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module Umami GKE — Guide de configuration](Umami_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Umami Common](Umami_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Directus sur Cloud Run](Directus_CloudRun.md) dans la solution **Headless Content Platform**.
