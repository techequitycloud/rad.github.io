---
title: "Invoice Ninja sur Google Cloud Run"
description: "Référence de configuration pour déployer Invoice Ninja sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/InvoiceNinja_CloudRun.md @ 3055034 sha256:c55a5c88c079 -->

# Invoice Ninja sur Google Cloud Run {#invoice-ninja-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/InvoiceNinja_CloudRun.png" alt="Invoice Ninja sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète du module `modules/InvoiceNinja_CloudRun`. Il couvre l'architecture, IAM, les variables de configuration, les comportements propres à Invoice Ninja et les schémas d'exploitation pour déployer Invoice Ninja sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Invoice Ninja est une plateforme open source professionnelle de facturation utilisée par les indépendants et les petites entreprises. Elle propose devis, factures, reçus, paiements clients, facturation récurrente, suivi des dépenses, suivi du temps, gestion de projets et un portail client en libre-service. `InvoiceNinja CloudRun` est un **module d'encapsulation** construit au-dessus d'`App CloudRun`. Il utilise `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte la configuration applicative, l'initialisation de la base de données et la configuration du stockage propres à Invoice Ninja via `InvoiceNinja Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Laravel PHP + nginx, 2 vCPU / 2 Gi par défaut. `min_instance_count = 0` par défaut (scale-to-zero, comme la valeur par défaut du socle `App_CloudRun`) — passez-le à `1` pour garder une instance active et éviter la latence de démarrage à froid lors du traitement des factures.
*   **Persistance des données** : Cloud SQL **MySQL 8.0** (et non PostgreSQL). Volumes GCS via GCS Fuse pour les PDF de factures, logos clients et documents téléversés partagés. NFS activable en option pour un stockage persistant partagé.
*   **Génération de PDF** : Invoice Ninja embarque snappdf (Chromium sans interface) dans `/usr/local/bin/chrome`. La génération de PDF est gourmande en CPU et en mémoire — 2 vCPU / 2 Gi constituent le minimum recommandé.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Le secret `APP_KEY` est généré automatiquement par `InvoiceNinja Common` et stocké dans Secret Manager.
*   **File d'attente et cache** : Redis **activé par défaut** (`enable_redis = true`) — Invoice Ninja utilise Redis pour `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. La génération de PDF en arrière-plan et la mise en file des e-mails nécessitent Redis en production.
*   **CI/CD** : image préconstruite `invoiceninja/invoiceninja:5` déployée par défaut (`container_image_source = 'prebuilt'`). Un pipeline Cloud Build d'image personnalisée est disponible.
*   **Fiabilité** : les sondes de santé ciblent `/` avec un délai initial généreux de 90 secondes et un seuil d'échec de 30 tentatives pour tenir compte de l'initialisation PHP d'Invoice Ninja et des migrations de base de données au premier démarrage.

**Projet et identité de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires e-mail des alertes de monitoring. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'invoiceninja'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `application_display_name` | 3 | `string` | `'Invoice Ninja'` | Nom lisible affiché dans la console GCP. |
| `application_description` | 3 | `string` | `'Invoice Ninja - Open-source invoicing platform'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'5'` | Tag de version de l'image Invoice Ninja. Incrémentez-le pour déployer une nouvelle version. |

**Architecture d'encapsulation :** `InvoiceNinja CloudRun` appelle `InvoiceNinja Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Invoice Ninja, la configuration des sondes et les définitions des jobs `db-init` et `artisan-migrate`. Le module injecte automatiquement `DB_CONNECTION=mysql` et la configuration du générateur de PDF snappdf. `module_storage_buckets` transporte le bucket de stockage GCS provisionné par `InvoiceNinja Common`. `scripts_dir` est résolu en `abspath("${module.invoiceninja_app.path}/scripts")` au moment de l'apply.

**Remarque sur MySQL :** Invoice Ninja nécessite **MySQL 8.0**, et non PostgreSQL. `database_type = "MYSQL_8_0"` est la valeur par défaut et ne doit pas être modifiée.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`InvoiceNinja_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux d'App_CloudRun.

**Secret applicatif :** `InvoiceNinja Common` génère automatiquement le secret `APP_KEY` (clé de chiffrement de l'application Laravel — une valeur aléatoire de 32 octets encodée en base64, stockée sous la forme `base64:<value>`) dans Secret Manager et l'expose à la fois via sa propre sortie `secret_ids` et intégré dans `config.secret_environment_variables`. La variante `InvoiceNinja_CloudRun`, toutefois, ne consomme directement ni l'un ni l'autre pour le conteneur du service — elle calcule elle-même le même ID de secret (`secret-<resource_prefix>-<app>-app-key`) dans sa propre variable locale `module_secret_env_vars`, précisément pour éviter un cycle de dépendance Terraform « known after apply » qui se produirait sinon lors du remplacement du secret. L'effet net est le même : `APP_KEY` n'atteint le conteneur que sous forme de référence Secret Manager, jamais comme variable d'environnement en clair.

**Identité d'initialisation de la base de données :** les Cloud Run Jobs `db-init` et `artisan-migrate` s'exécutent sous le compte de service Cloud Run. Ils se connectent à Cloud SQL MySQL via le socket Unix de l'Auth Proxy (puisque `enable_cloudsql_volume = true` par défaut), en utilisant `DB_HOST` (le chemin du socket sous `/cloudsql`), `DB_USER` et `ROOT_PASSWORD` (depuis Secret Manager).

**Délai de propagation IAM de 120 secondes :** hérité d'`App CloudRun` — le service Invoice Ninja n'est pas déployé tant que ce délai n'est pas écoulé, ce qui évite les échecs de lecture de secrets au démarrage de la première révision.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Invoice Ninja est une application Laravel PHP embarquant Chromium pour la génération de PDF. Ces deux composants imposent des besoins en ressources importants. `InvoiceNinja CloudRun` expose `cpu_limit` et `memory_limit` comme variables dédiées de premier niveau.

**Le scale-to-zero est activé par défaut** (`min_instance_count = 0`, conformément à la valeur par défaut du socle `App_CloudRun`). Le démarrage à froid d'Invoice Ninja comprend l'initialisation de PHP-FPM, l'amorçage de Laravel et une éventuelle migration de base de données — cela peut prendre 20 à 40 secondes. Définissez `min_instance_count = 1` pour garder une instance active et éviter cette latence de démarrage à froid en production.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut par défaut `'prebuilt'`, ce qui déploie directement l'image officielle `invoiceninja/invoiceninja:5`. Définissez-la sur `'custom'` pour construire une image modifiée avec Cloud Build à partir d'un Dockerfile personnalisé issu d'`InvoiceNinja_Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` déploie l'image officielle. `'custom'` construit via Cloud Build. |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour l'image Invoice Ninja par défaut. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution (scale-to-zero par défaut). Définissez `1` pour éviter la latence de démarrage à froid lors du traitement des factures. |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances en cours d'exécution. Sert de plafond de coût. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU minimum pour la génération de PDF avec Chromium. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi minimum pour Chromium ; 4 Gi recommandés en production. |
| `container_port` | 4 | `80` | Invoice Ninja écoute sur le port 80 via nginx. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. À augmenter pour la génération de PDF ou les exports de rapports. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket du Cloud SQL Auth Proxy. |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête par défaut (priorité au coût, va de pair avec `min_instance_count=0`). **Compromis :** la file d'attente/le planificateur Laravel s'arrête en période d'inactivité, de sorte que les factures récurrentes et les e-mails planifiés ne se déclenchent pas — externalisez-les via Cloud Scheduler appelant le point de terminaison cron, ou définissez `true` avec `min_instance_count >= 1` pour un fonctionnement continu. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green en pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut d'`App CloudRun` :**

| Variable | `App CloudRun` | `InvoiceNinja CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `80` | Invoice Ninja utilise nginx sur le port 80. |
| `cpu_limit` | `'1000m'` | `'2000m'` | La génération de PDF Chromium de snappdf nécessite ≥2 vCPU pour un fonctionnement fiable. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Le processus Chromium nécessite 1 à 2 Gi en plus de l'empreinte mémoire de PHP-FPM. |
| `container_image_source` | `'custom'` | `'prebuilt'` | L'image officielle `invoiceninja/invoiceninja` est prête pour la production sans personnalisation. |
| `enable_image_mirroring` | `false` | `true` | Invoice Ninja copie par défaut son image de base en miroir dans Artifact Registry. |

### B. Base de données (Cloud SQL — MySQL 8.0) {#b-database-cloud-sql--mysql-80}

Invoice Ninja nécessite **MySQL 8.0**. PostgreSQL, SQL Server et les autres moteurs ne sont pas pris en charge et feront échouer Invoice Ninja au démarrage avec une erreur de pilote de base de données.

**Connexion par socket Unix :** `enable_cloudsql_volume` vaut `true` par défaut. `App CloudRun` injecte le sidecar Auth Proxy et définit `DB_HOST` sur le chemin du socket sous `/cloudsql`. Invoice Ninja le lit via les variables d'environnement standard `DB_*`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'MYSQL_8_0'` | Moteur Cloud SQL. **Doit rester `MYSQL_8_0`** — Invoice Ninja ne prend pas en charge PostgreSQL. |
| `application_database_name` | 12 | `'invoiceninja'` | Nom de la base de données MySQL. **Ne le modifiez pas après le déploiement initial.** |
| `application_database_user` | 12 | `'invoiceninja'` | Utilisateur applicatif MySQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer le service. |

> `db_name` et `db_user` sont transmises à `InvoiceNinja Common` pour être injectées dans l'`application_config`. Elles correspondent à `application_database_name` et `application_database_user` dans le chemin de provisionnement Cloud SQL — les deux doivent être définies sur la même valeur.

### C. Stockage (NFS et GCS) {#c-storage-nfs--gcs}

**NFS est activé par défaut** (`enable_nfs = true`). Invoice Ninja stocke les documents téléversés, les logos clients, les PDF de factures et d'autres ressources sur le partage NFS afin que toutes les instances Cloud Run accèdent à un système de fichiers cohérent. Nécessite `execution_environment = 'gen2'`.

**Bucket de stockage GCS :** un bucket GCS `data` est provisionné par défaut via `storage_buckets`. Des volumes GCS Fuse peuvent être configurés séparément pour monter des buckets directement dans le conteneur afin de stocker des documents.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisionne NFS pour le stockage partagé de documents et de fichiers. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau/une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, le sidecar Auth Proxy gère la connexion Cloud SQL via un socket Unix. Invoice Ninja a besoin d'un accès Internet sortant pour l'envoi d'e-mails SMTP — assurez-vous que `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` pour autoriser la sortie publique directe.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — Internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | Achemine uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine toute la sortie via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Deux Cloud Run Jobs sont provisionnés par `InvoiceNinja Common` lorsque `initialization_jobs` conserve sa valeur par défaut de liste vide (`[]`) :

**1. `db-init`** — Utilise l'image `mysql:8.0-debian`. Opérations idempotentes :
1. Se connecte à Cloud SQL MySQL via le socket Unix de l'Auth Proxy.
2. Crée l'utilisateur de base de données `invoiceninja` avec le mot de passe issu de Secret Manager.
3. Crée la base de données `invoiceninja` si elle n'existe pas.
4. Accorde à l'utilisateur `invoiceninja` tous les privilèges sur la base de données.

**2. `artisan-migrate`** — Utilise l'image de l'application Invoice Ninja. Exécute les migrations de base de données Laravel, y compris la création initiale du schéma et les données d'amorçage (`artisan migrate --seed`). Dépend de la réussite de `db-init`. `execute_on_apply = true`, il s'exécute donc à chaque déploiement pour appliquer les modifications de schéma issues des mises à niveau de version.

Des jobs cron récurrents supplémentaires peuvent être définis via `cron_jobs` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Cloud Run Jobs ponctuels. Laissez vide pour qu'`InvoiceNinja Common` fournisse les jobs par défaut `db-init` et `artisan-migrate`. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une règle Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit à 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (p. ex. VPN du bureau, IP de sortie CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Utile pour restreindre l'accès à Invoice Ninja aux employés authentifiés dans le cadre de processus de facturation internes.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Nécessite une règle Binary Authorization et un attesteur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont circonscrits à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets d'Invoice Ninja sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — aucune valeur en clair n'est jamais écrite dans l'état.

**Secrets générés automatiquement :** `InvoiceNinja Common` génère l'`APP_KEY` (clé de chiffrement Laravel) et l'injecte via `secret_environment_variables`. Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map nom de variable d'environnement → ID de secret Secret Manager. Résolue à l'exécution. (p. ex. `{ MAIL_PASSWORD = "smtp-password-secret" }`) |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic circule ainsi : Internet → Cloud Armor → équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Invoice Ninja à passer par l'équilibreur de charge, empêchant l'accès direct par l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est rattaché au backend de l'équilibreur de charge HTTPS. Invoice Ninja sert un mélange de ressources statiques et de données de facturation dynamiques. Cloud CDN convient bien aux ressources CSS, JS et logos d'Invoice Ninja. Assurez-vous que les réponses des PDF de factures et du portail client incluent des en-têtes `Cache-Control` appropriés avant d'activer le CDN pour les chemins d'API.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag (orphelines) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours au-delà duquel les images peuvent être supprimées. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont rattachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés pour chaque domaine. (p. ex. `['invoices.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Comme `container_image_source = 'prebuilt'` est la valeur par défaut, les déclencheurs CI/CD sont surtout utiles lorsque vous passez à `'custom'` pour construire une image Invoice Ninja modifiée avec des fichiers de thème ou des plugins propres à l'entreprise.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de la GitHub App (recommandé pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est transformé en pipeline de livraison Cloud Deploy géré, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` par défaut (scale-to-zero, conformément à la valeur par défaut du socle `App_CloudRun`) — définissez-le à `1` pour garder une instance active en permanence. `max_instance_count = 3` assure un scaling horizontal pendant les pics de traitement des factures ou les périodes d'export par lots. Les deux valeurs sont configurables par l'utilisateur.

Invoice Ninja utilise une file d'attente adossée à Redis, de sorte que plusieurs instances peuvent traiter différents jobs de la file sans contention. Les sessions sont stockées dans Redis lorsque `enable_redis = true`, ce qui rend le scaling horizontal sûr.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge via `traffic_split`. Les sessions et files d'attente d'Invoice Ninja adossées à Redis sont partagées entre les instances, ce qui rend les déploiements canary sûrs — les sessions client existantes persistent quelle que soit l'instance qui traite les requêtes suivantes.

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Invoice Ninja n'expose pas de point de terminaison de santé dédié. Les sondes de démarrage et de vivacité ciblent toutes deux `/` (la page de connexion ou le tableau de bord d'Invoice Ninja), qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée.

Le tableau ci-dessous indique la valeur par défaut déclarée de `var.startup_probe` — **mais `startup_probe` est actuellement inerte.** Les `locals.invoiceninja_module` de `InvoiceNinja_CloudRun/main.tf` fusionnent inconditionnellement une surcharge codée en dur *après* `module.invoiceninja_app.config`, de sorte que toute valeur fournie pour `var.startup_probe` est silencieusement ignorée au moment de l'apply. La sonde réellement déployée est :

```hcl
startup_probe = {
  enabled               = true
  type                  = "TCP"   # port-open check — Cloud Run health checks arrive over plain HTTP
  path                  = "/"     # ignored for a TCP probe
  initial_delay_seconds = 60
  timeout_seconds       = 10
  period_seconds        = 15
  failure_threshold     = 36
}
```

c'est-à-dire **TCP / délai initial de 60 s / 36 tentatives** (540 secondes de tolérance au total), et non la valeur par défaut HTTP/90 s/30 tentatives indiquée dans le tableau des entrées. Ne comptez pas sur une modification de `startup_probe` pour changer le type ou la temporisation de la sonde déployée — modifiez plutôt le bloc codé en dur dans `main.tf`. `liveness_probe` est également codée en dur dans la même fusion, mais avec les valeurs identiques à celles que déclare sa variable (`HTTP` / `/` / délai initial de 120 s / délai d'expiration de 10 s / période de 30 s / 3 échecs), de sorte que — contrairement à `startup_probe` — sa valeur par défaut documentée correspond bien à ce qui est déployé.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=30 }` | **Inerte** — `main.tf` la remplace inconditionnellement par une sonde `TCP` codée en dur (`initial_delay_seconds=60`, `failure_threshold=36`) quelle que soit la valeur de cette variable. Voir ci-dessus. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. `main.tf` la code en dur avec les mêmes valeurs, la valeur par défaut déclarée correspond donc à la sonde déployée. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). Lorsqu'il est activé, des alertes notifient `support_users` en cas d'indisponibilité. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un Cloud Run Job de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL MySQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Invoice Ninja.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après l'écriture du nouveau secret avant de redémarrer le service. |

---

## 8. Intégrations {#8-integrations}

### A. Redis (file d'attente et cache) {#a-redis-queue--cache}

Redis est **requis pour les déploiements Invoice Ninja de production** (`enable_redis = true` par défaut). Invoice Ninja utilise Redis pour trois fonctions essentielles :

- **`QUEUE_CONNECTION=redis`** — Traitement des jobs en arrière-plan, notamment la génération de PDF, l'envoi d'e-mails et la distribution des webhooks. Sans Redis, ces opérations bloquent le cycle de requête HTTP et provoquent des délais d'expiration.
- **`CACHE_DRIVER=redis`** — Cache au niveau de l'application pour les paramètres, les données de l'entreprise et les calculs de taxes.
- **`SESSION_DRIVER=redis`** — Stockage des sessions garantissant que les utilisateurs restent connectés sur plusieurs instances Cloud Run.

Lorsque `enable_redis = true` et que `redis_host` n'est pas fourni, le module utilise par défaut l'IP du serveur NFS comme hôte Redis (une instance Redis légère colocalisée sur la VM GCE NFS). Pour les déploiements de production, faites pointer `redis_host` vers une instance dédiée Google Cloud Memorystore for Redis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | Active Redis. Requis pour la génération de PDF en arrière-plan et la mise en file des e-mails en production. |
| `redis_host` | 21 | `""` | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible — jamais stocké dans l'état. |

### B. SMTP et e-mail {#b-smtp--email}

Invoice Ninja envoie des e-mails transactionnels pour la remise des factures aux clients, les approbations de devis, les confirmations de paiement et les notifications de factures récurrentes. SMTP doit être configuré avant la mise en production.

**Variables propres à Invoice Ninja** (groupe 23) :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `invoiceninja_admin_email` | 23 | `'admin@example.com'` | Adresse e-mail de l'administrateur pour la connexion et les notifications système. |
| `mail_from_name` | 23 | `'Invoice Ninja'` | Nom d'affichage de l'expéditeur des e-mails sortants. |
| `mail_from_address` | 23 | `'ninja@example.com'` | Adresse e-mail de l'expéditeur. Doit correspondre à votre domaine d'envoi vérifié. |

Les identifiants SMTP (hôte, port, utilisateur, mot de passe) sont transmis via `environment_variables` et `secret_environment_variables` :

```hcl
environment_variables = {
  MAIL_MAILER = "smtp"
  MAIL_HOST   = "smtp.mailgun.org"
  MAIL_PORT   = "587"
  MAIL_USERNAME = "postmaster@mg.example.com"
}

secret_environment_variables = {
  MAIL_PASSWORD = "invoiceninja-smtp-password"
}
```

### C. Génération de PDF (snappdf / Chromium) {#c-pdf-generation-snappdf--chromium}

Invoice Ninja embarque snappdf avec un exécutable Chromium sans interface dans `/usr/local/bin/chrome`. Les variables d'environnement suivantes sont définies automatiquement par `InvoiceNinja Common` :

- `PDF_GENERATOR=snappdf`
- `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome`

**Besoins en CPU et en mémoire pour la génération de PDF :** Chromium lance un processus distinct pour chaque rendu PDF. Sous charge concurrente (plusieurs clients consultant des factures simultanément), chaque génération de PDF peut consommer jusqu'à 500 Mo de RAM et 1 vCPU. L'allocation par défaut de 2 vCPU / 2 Gi prend en charge environ 2 à 4 rendus PDF simultanés. Augmentez `memory_limit` à `'4Gi'` pour les environnements à fort volume de factures.

### D. Import de sauvegarde et restauration {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un Cloud Run Job dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL MySQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. Définissez `false` après un import réussi. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (p. ex. `'gs://my-bucket/invoiceninja-2024-01.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### E. Observabilité et alertes {#e-observability--alerting}

Un test de disponibilité Cloud Monitoring interroge le point de terminaison Invoice Ninja depuis plusieurs emplacements dans le monde. Des règles d'alerte personnalisées peuvent surveiller les métriques Cloud Run (latence, taux d'erreur, nombre d'instances) et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Configuration du test de disponibilité. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur métriques. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées lors du déclenchement des tests de disponibilité et des règles d'alerte. |

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `InvoiceNinja CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **MySQL 8.0 requis** | Valeur par défaut `database_type = "MYSQL_8_0"` | L'application Laravel d'Invoice Ninja cible exclusivement MySQL. |
| **APP_KEY générée automatiquement** | `InvoiceNinja Common` la génère et l'injecte via `secret_environment_variables` | Une clé de chiffrement Laravel aléatoire de 32 octets encodée en base64 est générée une seule fois et stockée dans Secret Manager. Elle n'est PAS régénérée lors des apply ultérieurs. |
| **Générateur de PDF snappdf** | `PDF_GENERATOR=snappdf` et `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome` injectées automatiquement | Chromium est embarqué dans le conteneur `invoiceninja/invoiceninja:5`. |
| **TRUSTED_PROXIES=*** | Injectée automatiquement | Nécessaire pour que le proxy inverse de Cloud Run transmette correctement les adresses IP des clients et les en-têtes HTTPS à Laravel. |
| **DB_CONNECTION=mysql** | Injectée automatiquement | Sélection du pilote de base de données Laravel. |
| **Redis requis pour les files d'attente** | Valeur par défaut `enable_redis = true` | Les jobs en arrière-plan d'Invoice Ninja (génération de PDF, e-mail) échouent silencieusement ou expirent sans Redis. |
| **Jobs db-init + artisan-migrate par défaut** | Fournis par `InvoiceNinja Common` lorsque `initialization_jobs = []` | La base de données MySQL, l'utilisateur et le schéma sont créés automatiquement. `artisan-migrate` s'exécute à chaque apply pour gérer les mises à niveau de version. |
| **NFS activé par défaut** | Valeur par défaut `enable_nfs = true` | Invoice Ninja stocke les documents téléversés, les logos clients et les PDF générés dans le système de fichiers du conteneur. Sans NFS, ces fichiers sont perdus à chaque nouvelle révision. |
| **min_instance_count = 0** | Valeur par défaut (identique à `App_CloudRun`) | Invoice Ninja est ramené à zéro instance par défaut ; définissez `min_instance_count = 1` pour garder une instance active et éviter la latence de démarrage à froid lors de la remise des factures aux clients. |

---

## 10. Explorer avec la console GCP {#10-exploring-with-the-gcp-console}

Après le déploiement, rendez-vous aux emplacements suivants de la console GCP pour explorer l'infrastructure Invoice Ninja.

**Service Cloud Run**
- Accédez à **Cloud Run** → sélectionnez le service `invoiceninja-<deployment-id>`.
- **Onglet Revisions** : affiche toutes les révisions déployées, la répartition du trafic et les condensés (digests) des images de conteneur. Chaque exécution d'`artisan-migrate` crée une nouvelle révision.
- **Onglet Logs** : diffuse en continu les journaux de l'application. Filtrez sur `severity=ERROR` pour trouver les exceptions PHP et les jobs de file d'attente en échec. Recherchez les entrées de journal `Laravel` et les messages de plantage de Chromium.
- **Onglet Metrics** : affiche le nombre de requêtes, la latence des requêtes, le nombre d'instances de conteneur, l'utilisation du CPU et l'utilisation de la mémoire. Surveillez l'utilisation de la mémoire pendant la génération de PDF — des pics au-delà de 1.8 Gi indiquent une marge insuffisante.
- **Onglet YAML** : inspectez la configuration complète du service Cloud Run, y compris toutes les variables d'environnement (en clair uniquement — les secrets apparaissent sous forme de références), les montages de volumes et la configuration des sondes.

**Cloud Run Jobs**
- Accédez à **Cloud Run** → **Jobs**. Recherchez :
  - `invoiceninja-<deployment-id>-db-init` — le job d'initialisation de la base de données MySQL.
  - `invoiceninja-<deployment-id>-artisan-migrate` — le job de migration Laravel.
- Sélectionnez un job et cliquez sur **Executions** pour voir l'historique de chaque exécution, les codes de sortie et la sortie des journaux.
- Cliquez sur une exécution pour diffuser ses journaux — recherchez la sortie de migration de Laravel confirmant les tables créées ou ignorées.

**Cloud SQL**
- Accédez à **SQL** → sélectionnez l'instance Cloud SQL MySQL 8.0 (nommée `app<name><deploymentid>` ou similaire).
- **Overview** : affiche l'utilisation du CPU, de la mémoire et du stockage. Le profil de requêtes d'Invoice Ninja est majoritairement en lecture (génération de rapports) — surveillez les IOPS en lecture.
- **Onglet Connections** : confirme les connexions actives depuis l'Auth Proxy de Cloud Run. Chaque instance Cloud Run maintient un pool de connexions via le sidecar.
- **Databases** : vérifiez que la base de données `invoiceninja` existe et a été créée par le job `db-init`.
- **Users** : vérifiez que l'utilisateur `invoiceninja` existe avec les privilèges appropriés.
- **Backups** : consultez les instantanés de sauvegarde automatisés et leur état de conservation.

**Secret Manager**
- Accédez à **Security** → **Secret Manager**.
- Recherchez les secrets suivants (le préfixe varie selon le déploiement) :
  - `app<name><id>-db-password` — le mot de passe de l'utilisateur MySQL d'Invoice Ninja.
  - `app<name><id>-db-root-password` — le mot de passe root MySQL utilisé par `db-init`.
  - `app<name><id>-app-key` — la clé de chiffrement Laravel `APP_KEY`.
- Cliquez sur un secret pour voir ses versions, son historique d'accès et sa configuration de rotation.
- **Onglet Versions** : confirmez que la dernière version est `ENABLED`. Une version `DESTROYED` ou `DISABLED` fait échouer Invoice Ninja au démarrage avec une erreur d'accès au secret.

**Cloud Storage**
- Accédez à **Cloud Storage** → **Buckets**.
- Recherchez le bucket `app<name><id>-data` provisionné pour le stockage des documents d'Invoice Ninja.
- Parcourez le contenu du bucket pour voir les logos clients téléversés, les pièces jointes des factures et les fichiers PDF générés.
- Vérifiez les règles **Lifecycle** pour confirmer que les règles de conservation des sauvegardes sont appliquées.

**Artifact Registry**
- Accédez à **Artifact Registry** → **Repositories**.
- Recherchez le dépôt de ce déploiement. L'image `invoiceninja/invoiceninja:5` (ou un build personnalisé) y est stockée après la mise en miroir.
- Consultez les tags des images, les valeurs de condensé et les résultats de l'analyse des vulnérabilités.
- Vérifiez que la règle de nettoyage supprime les images sans tag et les images au-delà de `max_images_to_retain`.

**Monitoring**
- Accédez à **Monitoring** → **Uptime checks** pour voir l'état de disponibilité du point de terminaison Invoice Ninja depuis les emplacements de sondage mondiaux.
- Accédez à **Monitoring** → **Alerting** pour voir les règles d'alerte configurées pour ce déploiement. Les alertes sont envoyées à `support_users` lorsque le test de disponibilité échoue.
- Accédez à **Monitoring** → **Dashboards** → sélectionnez le tableau de bord Cloud Run pour les métriques par service.

---

## 11. Explorer avec gcloud {#11-exploring-with-gcloud}

Utilisez ces commandes pour inspecter et dépanner le déploiement Invoice Ninja depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION`, `SERVICE_NAME` et `DEPLOYMENT_ID` par vos valeurs réelles.

**Inspecter le service Cloud Run**
```bash
# List all Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.url,status.conditions[0].status)"

# Describe the Invoice Ninja service in full detail
gcloud run services describe invoiceninja-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format=yaml

# Show the current revision serving traffic
gcloud run revisions list \
  --service=invoiceninja-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type,spec.containers[0].image)"
```

**Diffuser et filtrer les journaux Cloud Run**
```bash
# Tail Invoice Ninja application logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID"' \
  --project=PROJECT_ID \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)" \
  --freshness=1h

# Filter for errors only
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID" AND severity>=ERROR' \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,textPayload)"

# Watch for Chromium/PDF generation events
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID" AND textPayload=~"pdf|chromium|snappdf"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Inspecter les Cloud Run Jobs (db-init, artisan-migrate)**
```bash
# List all Cloud Run jobs
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type)"

# View recent executions of the artisan-migrate job
gcloud run jobs executions list \
  --job=invoiceninja-DEPLOYMENT_ID-artisan-migrate \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type,status.conditions[0].lastTransitionTime)"

# Stream logs from the most recent artisan-migrate execution
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="invoiceninja-DEPLOYMENT_ID-artisan-migrate"' \
  --project=PROJECT_ID \
  --limit=100 \
  --format="table(timestamp,textPayload)" \
  --freshness=1d
```

**Inspecter Cloud SQL**
```bash
# List all Cloud SQL instances in the project
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,state,ipAddresses[0].ipAddress)"

# Describe the Invoice Ninja MySQL instance
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(name,databaseVersion,state,settings.tier,settings.dataDiskSizeGb,settings.ipConfiguration)"

# List databases on the instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,passwordPolicy.status)"

# Check current active connections
gcloud sql operations list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(name,operationType,status,startTime)"
```

**Inspecter Secret Manager**
```bash
# List all secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~invoiceninja" \
  --format="table(name,replication.automatic,createTime)"

# Check the APP_KEY secret versions
gcloud secrets versions list app-key-SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Access the APP_KEY value (requires secretAccessor role — use with care)
gcloud secrets versions access latest \
  --secret=APP_KEY_SECRET_NAME \
  --project=PROJECT_ID
```

**Inspecter le stockage GCS**
```bash
# List storage buckets for this deployment
gcloud storage ls --project=PROJECT_ID | grep invoiceninja

# List top-level objects in the data bucket
gcloud storage ls gs://BUCKET_NAME/

# Check bucket IAM bindings
gcloud storage buckets get-iam-policy gs://BUCKET_NAME

# View lifecycle rules
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="json(lifecycle)"
```

**Inspecter les images Artifact Registry**
```bash
# List images in the repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/invoiceninja \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Show vulnerability scan results
gcloud artifacts docker images scan \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/invoiceninja:5 \
  --project=PROJECT_ID \
  --format="json"
```

**Vérifier Memorystore Redis (si vous utilisez une instance dédiée)**
```bash
# List Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Describe a specific Redis instance
gcloud redis instances describe REDIS_INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID
```

**Tests de disponibilité et alertes**
```bash
# List uptime checks for this project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,monitoredResource.labels.host,period,timeout)"

# List alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"
```

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `InvoiceNinja CloudRun`, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail destinataires des alertes de monitoring. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'invoiceninja'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `application_display_name` | 3 | `'Invoice Ninja'` | Nom lisible affiché dans la console GCP. |
| `application_description` | 3 | `'Invoice Ninja - Open-source invoicing platform'` | Description du service. |
| `application_version` | 3 | `'5'` | Tag de l'image de conteneur Invoice Ninja. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` (image officielle) ou `'custom'` (Cloud Build). |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour l'image Invoice Ninja par défaut. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances (scale-to-zero par défaut). Définissez `1` pour garder Invoice Ninja actif. |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances. Sert de plafond de coût. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU minimum pour la génération de PDF. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi minimum pour Chromium. |
| `container_port` | 4 | `80` | Port nginx d'Invoice Ninja. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. À augmenter pour la génération de PDF. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket Unix du Cloud SQL Auth Proxy. |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête par défaut. Voir le §3.A pour le compromis concernant la file d'attente/le planificateur. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix de l'Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Copie en miroir l'image Invoice Ninja dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service bénéficiant de l'accès IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google bénéficiant de l'accès IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en clair. À utiliser pour l'hôte, le port et le nom d'utilisateur SMTP, ainsi que la configuration Mail. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager (p. ex. `{ MAIL_PASSWORD = "smtp-password-secret" }`). |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complet) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de la GitHub App. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images lors du déploiement. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours au-delà duquel les images peuvent être supprimées. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne un stockage partagé NFS. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base de la VM NFS intégrée (inline). L'ID de déploiement y est ajouté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'MYSQL_8_0'` | Moteur Cloud SQL. Doit rester `MYSQL_8_0` pour Invoice Ninja. |
| `application_database_name` | 12 | `'invoiceninja'` | Nom de la base de données MySQL. Ne le modifiez pas après le déploiement initial. |
| `application_database_user` | 12 | `'invoiceninja'` | Utilisateur applicatif MySQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer le service. |
| `initialization_jobs` | 13 | `[]` | Cloud Run Jobs ponctuels. Laissez vide pour les jobs par défaut `db-init` et `artisan-migrate`. |
| `cron_jobs` | 13 | `[]` | Cloud Run Jobs planifiés récurrents. |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=90, failure_threshold=30, ... }` | **Inerte** — la valeur par défaut déclarée indiquée ici n'est jamais déployée ; `main.tf` la remplace inconditionnellement par une sonde codée en dur `type="TCP"`, `initial_delay_seconds=60`, `failure_threshold=36`. Voir le §7C. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=120, failure_threshold=3, ... }` | Sonde de vivacité. `main.tf` la code en dur avec les mêmes valeurs que la valeur par défaut déclarée, c'est donc toujours celle-ci dans les faits. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur métriques Cloud Monitoring. |
| `enable_redis` | 21 | `true` | **Activé par défaut.** Requis pour la génération de PDF et la mise en file des e-mails. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Utilise par défaut l'IP du serveur NFS lorsqu'il est vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement lorsqu'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active des Cloud Audit Logs détaillés. |
| `invoiceninja_admin_email` | 23 | `'admin@example.com'` | Adresse e-mail de l'administrateur pour la connexion et les notifications. |
| `mail_from_name` | 23 | `'Invoice Ninja'` | Nom d'affichage des e-mails sortants. |
| `mail_from_address` | 23 | `'ninja@example.com'` | Adresse e-mail de l'expéditeur des e-mails sortants. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP dans laquelle le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL MySQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Nom de l'utilisateur de la base de données applicative. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |

---

## 14. Pièges de configuration et valeurs par défaut judicieuses {#14-configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"MYSQL_8_0"` | **Critique** | L'application Laravel d'Invoice Ninja utilise exclusivement MySQL. La définir sur `POSTGRES` fait échouer Invoice Ninja au démarrage avec une erreur de pilote PDO. |
| `application_database_name` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modifier amène Terraform à recréer la base de données, détruisant toutes les données de factures, de clients et de paiements. |
| `application_database_user` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modifier recrée l'utilisateur MySQL, invalidant les identifiants stockés et cassant l'application. |
| `memory_limit` | `"2Gi"` | **Élevé** | Invoice Ninja lance un processus Chromium pour chaque rendu PDF. En dessous de 1 Gi, Chromium est tué pour OOM pendant la génération de PDF, renvoyant des PDF vides ou des erreurs 500 aux clients. Le minimum pour Chromium est d'environ 512 Mi par rendu simultané. |
| `cpu_limit` | `"2000m"` | **Élevé** | En dessous de 1 vCPU, le rendu PDF de Chromium ralentit considérablement et peut expirer. Il peut être nécessaire d'augmenter `timeout_seconds` en même temps que toute réduction du CPU. |
| `enable_redis` | `true` | **Critique** | Invoice Ninja REQUIERT Redis pour le traitement de la file d'attente en arrière-plan. Sans Redis, la génération des PDF de factures et l'envoi des e-mails sont synchrones — ils bloquent la requête HTTP, provoquent des délais d'expiration et échouent sous charge concurrente. Désactiver Redis en production rend le processus de remise des factures peu fiable. |
| `redis_host` | `""` (résolu automatiquement en IP NFS) | **Élevé** | Si `enable_nfs = false` et que `redis_host` reste vide avec `enable_redis = true`, Invoice Ninja ne peut pas se connecter à Redis au démarrage. L'application démarrera mais les jobs de la file d'attente échoueront silencieusement. |
| `enable_nfs` | `true` | **Élevé** | Invoice Ninja écrit les documents téléversés, les logos clients et les données en cache dans le système de fichiers du conteneur. Sans NFS, les fichiers téléversés sur une instance sont invisibles pour les autres, et tous les téléversements des utilisateurs sont perdus à chaque déploiement d'une nouvelle révision Cloud Run. |
| `min_instance_count` | `0` (par défaut) — définissez `1` en production | **Moyen** | Le scale-to-zero par défaut provoque des démarrages à froid. L'initialisation de PHP-FPM d'Invoice Ninja + la vérification des migrations de base de données prennent 10 à 30 secondes. Les clients qui accèdent à des liens de factures pendant un démarrage à froid reçoivent des erreurs de délai d'expiration. |
| `container_image_source` | `"prebuilt"` | **Faible** | L'image officielle `invoiceninja/invoiceninja` est prête pour la production. Passer à `"custom"` nécessite un Dockerfile valide dans `InvoiceNinja_Common/scripts/` — si le build échoue, aucune nouvelle révision n'est déployée. |
| `invoiceninja_admin_email` | `"admin@example.com"` | **Moyen** | L'adresse e-mail de l'administrateur doit être valide et accessible. Utiliser l'espace réservé par défaut empêche l'administrateur de recevoir les notifications système et bloque les processus initiaux de réinitialisation du mot de passe. |
| `mail_from_address` | `"ninja@example.com"` | **Élevé** | Les e-mails de remise de factures envoyés depuis un domaine non vérifié risquent d'être rejetés par les serveurs de messagerie des clients ou classés comme spam. Configurez un domaine d'expédition vérifié avant d'envoyer des factures aux clients. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour des données de facturation. Dans de nombreuses juridictions, la loi impose la conservation des factures et des enregistrements de paiement. Augmentez cette valeur à 90 jours ou plus pour les déploiements de production. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration et le portail client d'Invoice Ninja sont exposés au trafic de bots. Les identifiants administrateur d'Invoice Ninja peuvent être ciblés par des attaques de credential stuffing. |
| `timeout_seconds` | `300` | **Moyen** | La génération de PDF pour des factures complexes de plusieurs lignes avec une image de marque personnalisée peut prendre 10 à 30 secondes sous charge. Les exports de rapports sur de longues périodes peuvent dépasser 300 secondes. Augmentez à `600` pour les déploiements à fort volume. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Moyen** | Invoice Ninja doit atteindre des serveurs SMTP externes pour envoyer des e-mails. `PRIVATE_RANGES_ONLY` autorise la sortie publique directe pour SMTP. Définir `"ALL_TRAFFIC"` avec un pare-feu VPC restrictif bloque le SMTP sortant. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 sans serveur sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** attendez 20 à 30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La seconde exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : InvoiceNinja sur Cloud Run](../labs/InvoiceNinja_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Invoice Ninja GKE — Guide de configuration](InvoiceNinja_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée InvoiceNinja Common](InvoiceNinja_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) et [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
