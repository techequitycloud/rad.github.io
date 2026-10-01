---
title: "Paperless-ngx sur Google Cloud Run"
description: "Référence de configuration pour déployer Paperless-ngx sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Paperless_CloudRun.md @ 3055034 sha256:5983640257e5 -->

# Paperless-ngx sur Google Cloud Run {#paperless-ngx-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Paperless_CloudRun.png" alt="Paperless-ngx sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document constitue une référence complète du module `modules/Paperless_CloudRun`. Il couvre l'architecture, l'IAM, les variables de configuration, les comportements propres à Paperless-ngx et les modèles d'exploitation pour déployer Paperless-ngx sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Paperless-ngx est un système de gestion documentaire open source, maintenu par la communauté, qui transforme les documents papier en une archive numérique consultable par recherche. `Paperless CloudRun` est un **module wrapper** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour l'ensemble du provisionnement de l'infrastructure GCP et injecte, via `Paperless Common`, la configuration applicative, l'initialisation de la base de données et la configuration du stockage propres à Paperless-ngx.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Python/gunicorn, 2 vCPU / 2 Gi par défaut. `min_instance_count = 0` par défaut (mise à l'échelle jusqu'à zéro) — définissez `1` ou plus pour maintenir à chaud le pipeline de consommation en arrière-plan et éviter les délais de démarrage à froid lors du téléversement de documents.
*   **OCR et classification** : moteur OCR Tesseract avec packs de langues configurables (`ocr_language`). Classification des documents par apprentissage automatique, recherche en texte intégral, étiquettes, correspondants, types de documents et champs personnalisés.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Volume GCS FUSE monté automatiquement sur `/usr/src/paperless/media` pour le stockage persistant des documents (documents traités, miniatures, originaux).
*   **File de tâches** : Redis **obligatoire** (et non facultatif). Paperless-ngx utilise Redis comme courtier de messages Celery pour le traitement OCR en arrière-plan, la classification des documents, le pipeline de consommation et les tâches asynchrones.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Deux secrets générés automatiquement par `Paperless Common` : `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY`.
*   **CI/CD** : pipeline d'image personnalisée Cloud Build par défaut ; livraison progressive Cloud Deploy en option.
*   **Fiabilité** : les sondes de santé ciblent `/` (la page de connexion de Paperless-ngx) avec un délai initial de 60 secondes pour laisser le temps aux migrations de base de données et au démarrage des workers Celery lors du premier démarrage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires e-mail des alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'paperless'` | Nom de base des ressources. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Paperless-ngx - Document Management System'` | Nom lisible affiché dans les tableaux de bord. |
| `description` | 3 | `string` | `'Paperless-ngx - open-source document management system with OCR...'` | Description du service. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image de conteneur. Épinglez une version précise (par exemple `'2.13.5'`) en production. |

**Architecture du wrapper :** `Paperless CloudRun` appelle `Paperless Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Paperless-ngx, la configuration des sondes, les définitions des buckets de stockage et la définition du job `db-init`. `module_storage_buckets` transporte le bucket `paperless-media` provisionné par `Paperless Common`. `scripts_dir` est résolu vers le répertoire de scripts de `Paperless Common` au moment de l'apply.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Paperless_CloudRun` délègue l'intégralité du provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux d'`App_CloudRun`.

**Secrets applicatifs :** contrairement à Ghost, `Paperless Common` génère automatiquement deux secrets au niveau de l'application au moment du déploiement :

| Secret | Description |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Mot de passe du compte administrateur initial. Généré automatiquement et stocké dans Secret Manager. |
| `PAPERLESS_SECRET_KEY` | Clé secrète de l'application Django. Générée automatiquement et stockée dans Secret Manager. |

Les deux secrets sont injectés nativement par Cloud Run au démarrage de la révision — la valeur en clair n'est jamais écrite dans l'état Terraform.

**Identité d'initialisation de la base de données :** le Cloud Run Job `db-init` s'exécute sous le compte de service Cloud Run. Il se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy (puisque `enable_cloudsql_volume = true` par défaut).

**Délai de propagation IAM de 120 secondes :** hérité d'`App CloudRun` — le service Paperless-ngx n'est déployé qu'à l'issue de ce délai, ce qui évite les échecs de lecture des secrets au premier démarrage de la révision.

Pour les tableaux complets des rôles et les détails sur IAP, la rotation des mots de passe et l'accès public, consultez la documentation d'`App_CloudRun`.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Paperless-ngx est une application Python Django/gunicorn dotée de workers Celery en arrière-plan. Elle effectue l'OCR avec Tesseract, ce qui sollicite fortement le CPU lors de l'ingestion des documents. `Paperless CloudRun` expose `cpu_limit` et `memory_limit` comme variables dédiées de premier niveau, avec des valeurs par défaut adaptées à la production.

**`min_instance_count = 0` et `cpu_always_allocated = false` par défaut.** Comme la plupart des modules de ce dépôt, Paperless-ngx descend à zéro instance et est facturé à la requête par défaut (priorité au coût). Le compromis : le consommateur de documents en arrière-plan et le worker OCR ne fonctionnent que lorsqu'une instance est active, si bien que les documents déposés dans le répertoire de consommation peuvent rester non traités jusqu'à ce que la requête suivante réveille le service. Définir `min_instance_count = 1` seul **ne suffit pas** à rétablir un traitement continu — la facturation à la requête (`cpu_always_allocated = false`) continue de réduire le CPU à presque zéro entre les requêtes. Définissez **à la fois** `cpu_always_allocated = true` **et** `min_instance_count = 1` ou plus pour que le pipeline de consommation reste en écoute permanente avec du CPU alloué.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut par défaut `'custom'`, ce qui signifie que Cloud Build compile une image personnalisée à partir du Dockerfile de `Paperless_Common` (basé sur `ghcr.io/paperless-ngx/paperless-ngx`). Définissez `container_image_source = 'prebuilt'` et `container_image = 'ghcr.io/paperless-ngx/paperless-ngx:2.13.5'` pour déployer directement une image existante.

**Mise en miroir des images activée par défaut** (`enable_image_mirroring = true`) : les images Paperless-ngx sont hébergées sur GitHub Container Registry (GHCR). Le module met l'image en miroir dans Artifact Registry pour éviter les limites de débit de GHCR et satisfaire les exigences de Binary Authorization.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement (SQL, stockage, secrets). |
| `container_image_source` | — | `'custom'` | `'custom'` effectue le build via Cloud Build. `'prebuilt'` déploie un URI d'image existant. |
| `container_image` | — | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build le gère. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour les charges de travail OCR. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi minimum ; à augmenter pour les gros lots de documents. |
| `cpu_always_allocated` | 4 | `false` | `false` = démarrage à froid privilégiant le coût (facturation à la requête) ; le consommateur de documents et le worker OCR cessent de traiter lorsque le service descend à zéro. Définissez `true` **et** `min_instance_count >= 1` ensemble pour rétablir un fonctionnement continu. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Mise à l'échelle jusqu'à zéro par défaut ; définissez `1` ou plus **et** `cpu_always_allocated = true` pour maintenir le pipeline de consommation actif. |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances en cours d'exécution. Plafond de coût. |
| `container_port` | 4 | `8000` | Port gunicorn de Paperless-ngx. Ne pas modifier sans adapter le Dockerfile. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages de volumes GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. L'OCR de documents volumineux peut être lent ; 300s ou plus recommandés. |
| `enable_cloudsql_volume` | 4 | `true` | Par défaut `true` — connexion via le socket Unix de Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image GHCR dans Artifact Registry. Recommandé pour éviter les limites de débit. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage (canary/blue-green). |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut d'`App CloudRun` :**

| Variable | `App CloudRun` | `Paperless CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `8000` | Le gunicorn de Paperless-ngx écoute sur le port 8000. |
| `cpu_limit` | `'1000m'` | `'2000m'` | L'OCR avec Tesseract sollicite fortement le CPU ; 2 vCPU recommandés. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Paperless-ngx charge en mémoire les miniatures de documents et les modèles de ML. |
| `enable_image_mirroring` | `false` | `true` | Mise en miroir depuis GHCR pour éviter les limites de débit et prendre en charge Binary Authorization. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Paperless-ngx exige **PostgreSQL**. `Paperless Common` fixe `database_type = "POSTGRES_15"` et configure les variables de connexion en conséquence. MySQL et SQLite ne sont pas pris en charge.

**Connexion par socket Unix :** `enable_cloudsql_volume` vaut `true` par défaut. `App CloudRun` injecte le side-car Auth Proxy et définit `DB_HOST` sur le chemin du socket sous `/cloudsql`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | PostgreSQL 15. Ne pas modifier — Paperless-ngx exige PostgreSQL. |
| `db_name` | 12 | `'paperless'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'paperless'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage du service. |

### C. Stockage (GCS Fuse) {#c-storage-gcs-fuse}

**GCS Fuse est le principal mécanisme de stockage persistant.** Contrairement à Ghost (qui s'appuie sur NFS pour le contenu), Paperless-ngx stocke l'ensemble des documents traités, des miniatures et des originaux dans un bucket monté via GCS FUSE sur `/usr/src/paperless/media`. Cette conception rend Paperless-ngx bien adapté à Cloud Run — les documents survivent au recyclage des instances et à la mise à l'échelle jusqu'à zéro, puisqu'ils se trouvent dans GCS et non sur le disque local.

**Volume GCS Fuse par défaut :** lorsque `gcs_volumes = []` (valeur par défaut), `Paperless Common` provisionne automatiquement un bucket GCS `paperless-media` et le monte sur `/usr/src/paperless/media` avec les options `implicit-dirs`, `stat-cache-ttl=60s` et `type-cache-ttl=60s`. GCS Fuse requiert `execution_environment = 'gen2'`.

**NFS est également activé par défaut** (`enable_nfs = true`). L'IP du serveur NFS sert d'hôte Redis lorsqu'aucun `redis_host` n'est configuré explicitement. NFS fournit aussi, si nécessaire, un système de fichiers local de secours pour le répertoire de consommation. Requiert `execution_environment = 'gen2'`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Lorsque la liste est vide, `Paperless Common` monte automatiquement le bucket `paperless-media` sur `/usr/src/paperless/media`. Requiert `gen2`. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer de buckets GCS supplémentaires. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires en plus du bucket média provisionné automatiquement. |
| `enable_nfs` | 11 | `true` | Provisionne un serveur NFS. Utilisé comme hôte Redis lorsque `redis_host` est vide. Requiert `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du montage NFS dans le conteneur. |
| `nfs_instance_name` | 11 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour une découverte automatique ou un provisionnement intégré. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base d'une VM GCE NFS intégrée. L'ID de déploiement y est ajouté. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine tout le trafic sortant via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un Cloud Run Job `db-init` est provisionné automatiquement par `Paperless Common` lorsque `initialization_jobs` conserve sa valeur par défaut de liste vide (`[]`). Il utilise une image de client PostgreSQL et exécute `Paperless_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy.
2. Crée l'utilisateur de base de données `paperless` avec le mot de passe issu de Secret Manager.
3. Crée la base de données `paperless` si elle n'existe pas.
4. Accorde à l'utilisateur applicatif tous les privilèges sur la base de données.

Remplacez `initialization_jobs` par une liste non vide pour substituer des jobs personnalisés à ce comportement par défaut. Lorsque `initialization_jobs` n'est pas vide, `Paperless Common` n'injecte pas le job `db-init` par défaut.

Des cron jobs récurrents supplémentaires et des services Cloud Run side-car supplémentaires (par exemple Gotenberg pour la conversion de documents bureautiques, Tika pour l'extraction de contenu) peuvent être configurés via `cron_jobs` et `additional_services` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Cloud Run Jobs ponctuels. Laissez vide pour que `Paperless Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés aux côtés de Paperless-ngx. À utiliser pour ajouter Gotenberg ou Tika. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une stratégie Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit à 500 req/min) est provisionné devant Cloud Run. Les systèmes de gestion documentaire contenant des fichiers sensibles sont de bons candidats à une protection WAF.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un LB HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple le VPN du bureau). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Une authentification par identité Google est alors exigée avant que les requêtes n'atteignent Paperless-ngx. Recommandé pour les archives documentaires internes dont l'accès doit être réservé aux utilisateurs authentifiés de l'organisation.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Requiert une stratégie Binary Authorization et un attesteur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés dans un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets applicatifs de Paperless-ngx sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — la valeur en clair n'est jamais écrite dans l'état Terraform.

`Paperless Common` génère automatiquement `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY`. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Table associant un nom de variable d'environnement → un ID de secret Secret Manager. Résolue à l'exécution. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic suit le chemin : Internet → Cloud Armor → LB HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Paperless-ngx à passer par le LB, ce qui empêche l'accès direct par l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (requiert `enable_cloud_armor = true`), Cloud CDN est rattaché au backend de l'équilibreur de charge HTTPS.

**Point d'attention pour Paperless-ngx :** Paperless-ngx sert principalement du contenu authentifié et propre à chaque utilisateur (listes de documents, aperçus, liens de téléchargement). La mise en cache CDN est surtout utile pour les ressources statiques (CSS, JS, miniatures). Assurez-vous que les réponses de documents authentifiées incluent des en-têtes `Cache-Control: private` avant d'activer le CDN, afin d'éviter l'empoisonnement du cache entre utilisateurs.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend du LB HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images deviennent éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour le LB HTTPS. Des certificats SSL gérés par Google sont provisionnés pour chaque domaine. |

Après le premier apply, récupérez l'IP du LB dans la sortie Terraform `load_balancer_ip` et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10 à 30 minutes après la propagation DNS.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Le déclencheur construit et déploie une image Paperless-ngx personnalisée lorsque du code est poussé sur la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de la GitHub App (à privilégier pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (requiert `enable_cicd_trigger = true`), le pipeline CI/CD est transformé en pipeline de livraison géré Cloud Deploy avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Requiert `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` et `max_instance_count = 3` sont configurables via des variables (contrairement aux valeurs codées en dur de Ghost). Les tâches OCR de Paperless-ngx s'exécutent de manière asynchrone via des workers Celery adossés à Redis — l'interface web reste réactive pendant les gros traitements OCR. Plusieurs instances Cloud Run peuvent s'exécuter simultanément, les documents étant stockés dans GCS.

> **Remarque sur le pipeline de consommation :** le pipeline de consommation des documents en arrière-plan nécessite au moins une instance en cours d'exécution. Avec `min_instance_count = 0`, les documents téléversés ne seront pas traités avant que la requête suivante ne réveille l'instance.

### B. Répartition du trafic {#b-traffic-splitting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage entre des révisions nommées. La somme de toutes les entrées doit être égale à 100. Une liste vide envoie 100 % du trafic à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Les sondes de démarrage et de liveness ciblent toutes deux `/` (la page de connexion de Paperless-ngx), qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée. Paperless-ngx effectue les migrations de base de données et démarre les workers Celery au premier démarrage — la sonde de démarrage accorde 60 secondes de délai initial avec un seuil de 60 échecs avant d'abandonner.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=10, period_seconds=10, failure_threshold=60 }` | Sonde de démarrage. 60 × 10s = 600s de marge totale pour le premier démarrage. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de liveness. Le conteneur est redémarré après 3 échecs consécutifs. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. Les alertes notifient `support_users` en cas d'inaccessibilité. |
| `alert_policies` | 14 | `[]` | Stratégies d'alerte sur les métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un Cloud Run Job de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Paperless-ngx.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après l'écriture du nouveau secret avant le redémarrage. |

---

## 8. Intégrations {#8-integrations}

### A. Redis (obligatoire) {#a-redis-required}

Redis est **obligatoire** et **activé par défaut** (`enable_redis = true`). Paperless-ngx utilise Redis comme courtier de messages Celery — le traitement OCR en arrière-plan, la classification des documents, les tâches du pipeline de consommation et les appels d'API asynchrones dépendent tous de Redis. Paperless-ngx ne démarrera pas sans instance Redis joignable.

Lorsque `enable_redis = true` et que `redis_host` n'est pas fourni, le module utilise par défaut l'IP du serveur NFS comme hôte Redis (une instance Redis légère co-hébergée sur la VM GCE NFS). Pour les déploiements de production, faites pointer `redis_host` vers une instance dédiée Google Cloud Memorystore for Redis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Obligatoire.** Redis pour la file de tâches Celery et le backend de résultats. |
| `redis_host` | 21 | `""` | Nom d'hôte ou IP du serveur Redis. Utilise par défaut l'IP du serveur NFS lorsqu'il est vide. À remplacer par Memorystore en production. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Laissez vide si Redis n'exige pas d'authentification. Sensible. |

### B. Paramètres applicatifs de Paperless-ngx {#b-paperless-ngx-application-settings}

Paperless-ngx expose plusieurs paramètres applicatifs sous forme de variables de premier niveau. Ils sont injectés comme variables d'environnement par `Paperless Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `time_zone` | 15 | `'UTC'` | Fuseau horaire des horodatages de documents et des tâches planifiées. Important pour une analyse correcte des dates lors de l'OCR. Utilisez un identifiant de fuseau horaire valide (par exemple `'Europe/London'`, `'America/New_York'`). |
| `ocr_language` | 15 | `'eng'` | Code de langue OCR de Tesseract. Combinez-en plusieurs avec `+` (par exemple `'eng+deu+fra'`). Les packs de langues doivent être installés dans l'image de conteneur. |
| `admin_user` | 15 | `'admin'` | Nom d'utilisateur du superutilisateur créé automatiquement au premier démarrage. |
| `admin_email` | 15 | `'admin@example.com'` | Adresse e-mail du compte superutilisateur créé automatiquement. |

**Codes de langue OCR :** utilisez les codes ISO 639-2/T employés par Tesseract. Valeurs courantes : `eng` (anglais), `deu` (allemand), `fra` (français), `spa` (espagnol), `ita` (italien), `nld` (néerlandais), `por` (portugais). Le pack de langue doit être présent dans le conteneur — l'image par défaut inclut un ensemble standard ; les builds personnalisés peuvent ajouter des packs supplémentaires.

### C. Tika et Gotenberg (facultatifs) {#c-tika--gotenberg-optional}

Paperless-ngx peut s'intégrer en option à Tika (Apache) pour l'extraction de contenu à partir de documents bureautiques et à Gotenberg pour la conversion de formats de documents. Ces intégrations sont désactivées par défaut (`PAPERLESS_TIKA_ENABLED=false`).

Pour les activer, ajoutez-les en tant que services Cloud Run supplémentaires via `additional_services` et définissez `PAPERLESS_TIKA_ENABLED=true` dans `environment_variables` :

```hcl
additional_services = [
  {
    name         = "gotenberg"
    image        = "gotenberg/gotenberg:8"
    port         = 3000
    cpu_limit    = "1000m"
    memory_limit = "512Mi"
    ingress      = "INGRESS_TRAFFIC_ALL"
    output_env_var_name = "PAPERLESS_TIKA_GOTENBERG_ENDPOINT"
  },
  {
    name         = "tika"
    image        = "apache/tika:latest"
    port         = 9998
    cpu_limit    = "1000m"
    memory_limit = "512Mi"
    ingress      = "INGRESS_TRAFFIC_ALL"
    output_env_var_name = "PAPERLESS_TIKA_ENDPOINT"
  }
]

environment_variables = {
  PAPERLESS_TIKA_ENABLED = "true"
}
```

### D. Import de sauvegarde et restauration {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un Cloud Run Job dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée. Il s'exécute après le job `db-init`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes quotidiennes automatiques. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. Repassez à `false` après un import réussi. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple `'gs://my-bucket/paperless-backup.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### E. Observabilité et alertes {#e-observability--alerting}

Un test de disponibilité Cloud Monitoring interroge le point de terminaison Paperless-ngx depuis plusieurs emplacements dans le monde. Des stratégies d'alerte personnalisées peuvent surveiller les métriques Cloud Run (latence, taux d'erreur, nombre d'instances) et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Configuration du test de disponibilité. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Stratégies d'alerte sur les métriques. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |

---

## 9. Explorer avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, les zones suivantes de la console GCP offrent la meilleure visibilité sur une instance Paperless-ngx en cours d'exécution.

**Cloud Run — Détails du service**
Accédez à **Cloud Run → Services → paperless-\<deployment-id\>**. L'onglet **Revisions** affiche toutes les révisions déployées, leur pourcentage de trafic et le tag de l'image de conteneur. Cliquez sur une révision pour voir ses variables d'environnement (masquées pour les secrets) et ses limites de ressources. L'onglet **Logs** diffuse en continu le flux stdout/stderr combiné du serveur gunicorn et du worker Celery.

**Cloud Run — URL du service**
Le champ **URL** de la vue d'ensemble du service correspond à l'adresse directe `*.run.app` de Paperless-ngx. Ouvrez-la dans un navigateur pour accéder à la page de connexion. Connectez-vous avec le nom d'utilisateur `admin_user` et le mot de passe récupéré dans Secret Manager (voir §11).

**Secret Manager**
Accédez à **Security → Secret Manager**. Filtrez sur le préfixe `application_name`. Vous verrez :
- `paperless-admin-password-<deployment-id>` — le mot de passe administrateur initial.
- `paperless-secret-key-<deployment-id>` — la clé secrète de l'application Django.
- `paperless-db-password-<deployment-id>` — le mot de passe de l'utilisateur applicatif PostgreSQL.

Cliquez sur un secret et sélectionnez **View secret value** (dernière version) pour récupérer l'identifiant.

**Cloud SQL**
Accédez à **SQL → Instances**. L'instance Paperless-ngx est nommée `app<name><tenant><id>` selon la convention de nommage du dépôt. Cliquez sur l'instance, puis :
- Onglet **Databases** : confirme que la base de données `paperless` a été créée par `db-init`.
- Onglet **Users** : confirme que l'utilisateur `paperless` a été créé.
- Onglet **Connections** : affiche les connexions actives provenant du side-car Auth Proxy de Cloud Run.
- Onglet **Operations** : affiche l'historique de toutes les opérations Cloud SQL, y compris la création de la base de données et de l'utilisateur.

**Cloud Storage**
Accédez à **Cloud Storage → Buckets**. Le bucket `paperless-media-<deployment-id>` contient toutes les données documentaires persistantes : PDF traités, originaux, miniatures et texte extrait par OCR. Parcourez le bucket pour vérifier que les documents sont bien stockés. Le bucket utilise la classe de stockage `STANDARD` avec la prévention de l'accès public appliquée.

**Artifact Registry**
Accédez à **Artifact Registry → Repositories**. Le dépôt `paperless` stocke l'image de conteneur Paperless-ngx personnalisée. L'onglet **Images** affiche les versions taguées avec leurs horodatages et leurs empreintes (digests).

**Cloud Monitoring — Tests de disponibilité**
Accédez à **Monitoring → Uptime checks**. Le test de disponibilité de la page de connexion de Paperless-ngx affiche la disponibilité depuis les différents emplacements de test dans le monde ainsi que les temps de réponse. Les échecs déclenchent une alerte par e-mail à `support_users`.

**Cloud Build**
Accédez à **Cloud Build → History**. Chaque exécution de déploiement y apparaît avec ses journaux de build. L'exécution du Cloud Run Job `db-init` est déclenchée dans le cadre du pipeline d'apply.

---

## 10. Explorer avec gcloud {#10-exploring-with-gcloud}

Les commandes suivantes sont utiles pour inspecter et exploiter un déploiement Paperless-ngx sur Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

```bash
# List all Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.url,status.latestReadyRevisionName,status.conditions[0].status)"

# Describe the Paperless-ngx service and show the current URL
gcloud run services describe paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="value(status.url)"

# Stream live logs from the Paperless-ngx service (last 5 minutes)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="paperless-DEPLOYMENT_ID"' \
  --project=PROJECT_ID \
  --freshness=5m \
  --format="table(timestamp,textPayload)" \
  --order=asc

# List all revisions of the Paperless-ngx service
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=paperless-DEPLOYMENT_ID \
  --format="table(name,status.conditions[0].status,spec.containers[0].image,metadata.creationTimestamp)"

# Get the admin password from Secret Manager
gcloud secrets versions access latest \
  --secret="paperless-admin-password-DEPLOYMENT_ID" \
  --project=PROJECT_ID

# Get the Django secret key from Secret Manager
gcloud secrets versions access latest \
  --secret="paperless-secret-key-DEPLOYMENT_ID" \
  --project=PROJECT_ID

# List all secrets created for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,replication.automatic,createTime)"

# Describe the Cloud SQL instance
gcloud sql instances describe APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,ipAddresses[0].ipAddress,state)"

# List databases on the Cloud SQL instance
gcloud sql databases list \
  --instance=APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List GCS buckets for the deployment (filter by name prefix)
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,location,storageClass,timeCreated)"

# List objects in the paperless-media bucket (document store)
gcloud storage ls gs://paperless-media-DEPLOYMENT_ID/

# List objects in the media/documents directory
gcloud storage ls gs://paperless-media-DEPLOYMENT_ID/documents/

# Check Memorystore Redis instance (if using dedicated Redis)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# List Cloud Run Jobs (db-init and any custom jobs)
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.latestCreatedExecution.name,metadata.creationTimestamp)"

# Execute the db-init job manually (e.g., for re-initialisation)
gcloud run jobs execute paperless-db-init-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION

# Get the execution status of a Cloud Run Job
gcloud run jobs executions list \
  --job=paperless-db-init-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,completionStatus,startTime,completionTime)"

# Check Cloud Monitoring uptime check results
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"

# List Artifact Registry images for the paperless repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/paperless \
  --project=PROJECT_ID \
  --format="table(package,version,tags,createTime)"

# Update the Cloud Run service's traffic to a specific revision (canary)
gcloud run services update-traffic paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --to-revisions=paperless-DEPLOYMENT_ID-REVISION=10,LATEST=90

# Send all traffic back to latest
gcloud run services update-traffic paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --to-latest

# Check IAM bindings on the Cloud Run service
gcloud run services get-iam-policy paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Paperless CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 obligatoire** | `database_type = "POSTGRES_15"` défini par `Paperless Common` | Paperless-ngx exige PostgreSQL. MySQL et SQLite ne sont pas pris en charge. |
| **Mot de passe administrateur généré automatiquement** | Secret `PAPERLESS_ADMIN_PASSWORD` provisionné par `Paperless Common` | Le mot de passe administrateur initial est stocké dans Secret Manager. Récupérez-le via `gcloud secrets versions access latest --secret=paperless-admin-password-<id>`. |
| **Clé secrète Django générée automatiquement** | Secret `PAPERLESS_SECRET_KEY` provisionné par `Paperless Common` | Requise pour la signature des sessions Django. Régénérer cette clé invalide toutes les sessions utilisateur existantes. |
| **GCS Fuse monté automatiquement** | Bucket `paperless-media` monté sur `/usr/src/paperless/media` | Lorsque `gcs_volumes = []`, `Paperless Common` provisionne et monte automatiquement le bucket média. Requiert `gen2`. |
| **Redis obligatoire** | Valeur par défaut `enable_redis = true` | Paperless-ngx ne démarrera pas sans Redis. Lorsque `redis_host = ""`, l'IP du serveur NFS est utilisée. |
| **min_instance_count = 0, cpu_always_allocated = false** | Valeur par défaut dans `variables.tf` (mise à l'échelle jusqu'à zéro, facturation à la requête) | Valeur par défaut privilégiant le coût. Définissez **à la fois** `cpu_always_allocated = true` et `min_instance_count = 1` ou plus pour maintenir le pipeline de consommation actif sans délai de démarrage à froid — `min_instance_count` seul ne suffit pas. |
| **Mise en miroir des images activée** | Valeur par défaut `enable_image_mirroring = true` | Les images GHCR sont mises en miroir dans Artifact Registry pour éviter les limites de débit et satisfaire les exigences de Binary Authorization. |
| **Job db-init par défaut** | Fourni par `Paperless Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement. Fournissez une liste non vide pour le remplacer. |
| **Répertoire des scripts** | `scripts_dir = abspath("${module.paperless_app.path}/scripts")` | Les scripts d'initialisation proviennent de `Paperless Common`, et non du répertoire de déploiement. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Paperless CloudRun`, triées par groupe d'interface.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail destinataires des alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'paperless'` | Nom de base des ressources. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Paperless-ngx - Document Management System'` | Nom lisible pour les tableaux de bord. |
| `description` | 3 | `'Paperless-ngx - open-source document management system...'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image de conteneur. Épinglez une version précise en production. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour l'OCR. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. |
| `cpu_always_allocated` | 4 | `false` | Valeur par défaut privilégiant le coût (démarrage à froid). Définissez `true` conjointement avec `min_instance_count >= 1` pour rétablir un traitement continu par le consommateur et l'OCR. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances. Mise à l'échelle jusqu'à zéro par défaut ; définissez `1` ou plus **et** `cpu_always_allocated = true` pour maintenir le pipeline de consommation actif. |
| `max_instance_count` | 4 | `3` | Nombre maximal d'instances. Plafond de coût. |
| `container_port` | 4 | `8000` | Port gunicorn de Paperless-ngx. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. À augmenter pour l'OCR de documents volumineux. |
| `enable_cloudsql_volume` | 4 | `true` | Connexion via le socket Unix de Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image GHCR dans Artifact Registry. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du socket Unix de l'Auth Proxy dans le conteneur. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés via IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés via IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en clair pour la configuration de Paperless-ngx. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes automatiques. |
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
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts avec l'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un LB HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images deviennent éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer de bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne un serveur NFS. Utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du montage NFS dans le conteneur. |
| `nfs_instance_name` | 11 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base de la VM NFS intégrée. |
| `gcs_volumes` | 11 | `[]` | Montages de volumes GCS Fuse. Si vide, paperless-media est monté automatiquement sur /usr/src/paperless/media. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry. |
| `database_type` | 12 | `'POSTGRES_15'` | Version de PostgreSQL. Ne pas modifier — Paperless-ngx exige PostgreSQL. |
| `db_name` | 12 | `'paperless'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | 12 | `'paperless'` | Utilisateur applicatif PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage. |
| `initialization_jobs` | 13 | `[]` | Cloud Run Jobs ponctuels. Si vide : `Paperless Common` fournit le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Cloud Run Jobs planifiés récurrents. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires (par exemple Gotenberg, Tika). |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=60, ... }` | Sonde de démarrage. Seuil d'échec élevé pour les migrations du premier démarrage. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=3, ... }` | Sonde de liveness. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | 14 | `[]` | Stratégies d'alerte sur les métriques Cloud Monitoring. |
| `time_zone` | 15 | `'UTC'` | Fuseau horaire des horodatages de documents. Important pour l'analyse des dates par l'OCR. |
| `ocr_language` | 15 | `'eng'` | Langue OCR de Tesseract. Combinez avec `+` pour plusieurs langues. |
| `admin_user` | 15 | `'admin'` | Nom d'utilisateur du compte administrateur initial. |
| `admin_email` | 15 | `'admin@example.com'` | Adresse e-mail du compte administrateur initial. |
| `enable_redis` | 21 | `true` | **Obligatoire.** Redis pour la file de tâches Celery. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP de Redis. Utilise par défaut l'IP du serveur NFS lorsqu'il est vide. |
| `redis_port` | 21 | `'6379'` | Port TCP de Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement lorsqu'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP dans laquelle le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `load_balancer_ip` | Adresse IP statique de l'équilibreur de charge. |
| `load_balancer_url` | URL HTTPS permettant d'accéder à l'application via l'équilibreur de charge. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critical** (perte de données, interruption totale, faille de sécurité) — **High** (service indisponible ou dégradation importante) — **Medium** (fonctionnement dégradé ou coût accru) — **Low** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critical** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Paperless-ngx exige PostgreSQL. Passer à MySQL ou NONE provoque un échec au démarrage — l'ORM de Paperless-ngx est configuré exclusivement pour PostgreSQL. |
| `enable_redis` | `true` | **Critical** | Redis est obligatoire. Sans Redis, Paperless-ngx ne peut pas démarrer ses workers Celery — le pipeline de consommation, le traitement OCR et la classification des documents sont tous inopérants. Les documents téléversés via l'interface web restent indéfiniment en file d'attente. |
| `redis_host` | `""` (résolu automatiquement vers l'IP NFS) | **High** | S'appuie sur l'IP du serveur NFS lorsqu'il est vide. Si `enable_nfs = false` et que `redis_host` reste vide avec `enable_redis = true`, Paperless-ngx ne parviendra pas à se connecter à Redis au démarrage. |
| `enable_nfs` | `true` | **High** | L'IP du serveur NFS sert d'hôte Redis par défaut. Désactiver NFS sans fournir de `redis_host` explicite provoque des échecs de connexion à Redis au démarrage. |
| `execution_environment` | `'gen2'` | **Critical** | GCS Fuse requiert Gen2. Passer à `'gen1'` alors que des volumes GCS sont montés empêche le démarrage des révisions Cloud Run. Le volume GCS Fuse `paperless-media` est toujours monté lorsque `gcs_volumes = []`. |
| `gcs_volumes` | `[]` (monte automatiquement paperless-media) | **Critical** | Le bucket `paperless-media` est l'unique stockage persistant de tous les documents Paperless-ngx. Si le montage automatique est remplacé de manière incorrecte, les documents sont écrits sur le système de fichiers éphémère du conteneur et perdus au prochain déploiement de révision ou redémarrage d'instance. |
| `min_instance_count` | `0` (par défaut ; mise à l'échelle jusqu'à zéro) | **High** | Lorsque l'instance est à froid, les documents téléversés ne sont pas consommés avant que la requête suivante ne réveille le service. Pour les workflows de répertoire de consommation sans surveillance, des documents peuvent rester non traités pendant des heures — définissez `1` ou plus si cela importe. |
| `cpu_always_allocated` | `false` (par défaut ; facturation à la requête) | **High** | Même avec `min_instance_count >= 1`, la facturation à la requête réduit le CPU à presque zéro entre les requêtes, si bien que le consommateur de documents et le worker OCR sont de fait bloqués. Définissez `true` **conjointement avec** `min_instance_count >= 1` pour rétablir pleinement le traitement continu en arrière-plan. |
| `db_name` | `"paperless"` | **Critical** | Immuable après le premier déploiement — le modifier conduit Terraform à recréer la base de données, ce qui détruit toutes les métadonnées des documents, étiquettes, correspondants et paramètres. Les fichiers de documents physiques dans GCS subsistent mais ne sont plus référencés. |
| `db_user` | `"paperless"` | **Critical** | Immuable après le premier déploiement — le modifier recrée l'utilisateur Cloud SQL et invalide tous les identifiants stockés. |
| `application_version` | `"latest"` | **Medium** | Avec `latest`, chaque exécution de Cloud Build peut récupérer une nouvelle version de Paperless-ngx, susceptible d'inclure des migrations de base de données ou des changements incompatibles. Épinglez une version précise (par exemple `"2.13.5"`) pour les déploiements de production. |
| `ocr_language` | `"eng"` | **Medium** | À aligner sur la langue principale des documents numérisés. Des codes de langue incorrects entraînent une mauvaise qualité d'OCR et un échec de l'indexation en texte intégral. Plusieurs langues (`"eng+deu"`) allongent la durée de l'OCR. |
| `time_zone` | `"UTC"` | **Medium** | Un fuseau horaire incorrect provoque des erreurs d'analyse des dates lors de l'OCR — les dates des documents numérisés peuvent être attribuées au mauvais jour. Alignez-le sur le fuseau horaire de votre organisation. |
| `memory_limit` | `"2Gi"` | **High** | L'OCR de numérisations multipages à haute résolution exige beaucoup de mémoire. Descendre sous `1Gi` provoque des erreurs OOM Python pendant le traitement Tesseract. Pour les charges de travail OCR lourdes, `4Gi` est recommandé. |
| `timeout_seconds` | `300` | **Medium** | L'OCR de PDF volumineux et multipages peut dépasser 300 secondes. Cloud Run interrompt les requêtes qui dépassent `timeout_seconds`. Envisagez `600` ou plus pour les archives contenant de gros lots de documents. |
| `backup_retention_days` | `7` | **Medium** | Sept jours sont insuffisants pour une archive documentaire. Perdre plus de 7 jours de modifications de la base de données revient à perdre toutes les métadonnées des documents (étiquettes, correspondants, champs personnalisés, notes) ajoutées pendant cette période. Portez cette valeur à 30 jours ou plus en production. |
| `enable_cloud_armor` | `false` | **Medium** | Sans Cloud Armor, la page de connexion de Paperless-ngx est directement exposée à internet. Les systèmes de gestion documentaire contiennent souvent des documents financiers et personnels sensibles. Une protection WAF est fortement recommandée pour tout déploiement accessible depuis internet. |
| `enable_iap` | `false` | **Medium** | IAP ajoute une authentification par identité Google devant Paperless-ngx. Pour les archives documentaires internes, IAP empêche complètement les attaques par force brute contre la page de connexion de Paperless-ngx. |
| `startup_probe` failure_threshold | `60` | **High** | Paperless-ngx applique les migrations de base de données au démarrage. 60 × 10s = 600 secondes de tolérance totale au démarrage. Descendre `failure_threshold` sous 30 conduit Cloud Run à arrêter le conteneur avant la fin des migrations lors du premier déploiement, ce qui crée une boucle de redémarrage. |

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

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

- [Lab pratique : Paperless-ngx sur Cloud Run](../labs/Paperless_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Paperless-ngx GKE — Guide de configuration](Paperless_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Paperless-ngx Common](Paperless_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Odoo sur Cloud Run](Odoo_CloudRun.md), de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), d'[OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) et de [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Integrated ERP Platform**.
