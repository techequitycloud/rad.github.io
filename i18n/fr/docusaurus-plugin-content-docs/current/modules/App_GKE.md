---
title: "Module App GKE — Guide de configuration"
description: "Référence de configuration pour déployer App sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/App_GKE.md @ 3055034 sha256:f79c6946a516 -->

# Module App GKE — Guide de configuration {#app-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/App_GKE.png" alt="Module App GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `App GKE`, organisées en groupes fonctionnels. Pour chaque variable, il explique les options disponibles, les implications de chaque choix et la manière de valider la configuration obtenue dans la console Google Cloud ou à l'aide des commandes CLI `gcloud` et `kubectl`.

---

## Services GCP déployés {#deployed-gcp-services}

Un déploiement `App GKE` entièrement configuré provisionne et intègre les services GCP suivants :

- **GKE Autopilot** — cluster Kubernetes avec gestion automatique des nœuds, Horizontal Pod Autoscaler (HPA) et Vertical Pod Autoscaler (VPA) facultatif
- **Kubernetes Deployments / StatefulSets** — contrôleur de charge de travail de l'application, avec mise à l'échelle configurable des réplicas et stratégie de mise à jour progressive
- **Kubernetes Services** — exposition de l'application en ClusterIP interne, en LoadBalancer externe ou en NodePort
- **Cloud Build** — pipeline de build d'images de conteneur et déclencheur CI/CD connecté à GitHub
- **Artifact Registry** — dépôt d'images de conteneur avec règles de nettoyage configurables et chiffrement CMEK facultatif
- **Cloud SQL** — instance de base de données gérée PostgreSQL, MySQL ou SQL Server, avec un sidecar Cloud SQL Auth Proxy
- **Cloud Storage (GCS)** — buckets applicatifs avec montages facultatifs via le pilote GCS Fuse CSI à l'intérieur des pods
- **Cloud Filestore / VM GCE NFS** — stockage NFS persistant partagé, accessible simultanément par tous les réplicas de pods
- **Secret Manager** — stockage sécurisé des mots de passe de base de données, des jetons GitHub et des secrets applicatifs ; injectés dans les pods via le pilote Secrets Store CSI
- **Workload Identity** — authentification GCP sans clé pour les pods, à l'aide de jetons de compte de service projetés (aucun fichier de clé)
- **Cloud Monitoring** — tests de disponibilité, règles d'alerte et canaux de notification pour `support_users`
- **Cloud Deploy** *(facultatif)* — pipeline de livraison progressive en plusieurs étapes, avec contrôles de promotion et approbations manuelles facultatives
- **Cloud Armor** *(facultatif)* — règle de sécurité WAF associée au backend de la GKE Gateway
- **Identity-Aware Proxy** *(facultatif)* — authentification par identité Google appliquée au niveau de la Gateway
- **Certificate Manager** *(facultatif)* — certificats SSL gérés par Google pour les domaines personnalisés, via l'API GKE Gateway
- **VPC Service Controls** *(facultatif)* — périmètre d'API limitant l'accès aux services GCP à l'intérieur du VPC et aux identités approuvées

---

## Prérequis {#prerequisites}

Avant de déployer App GKE :

1. **Projet GCP** avec la facturation activée.
2. **Module Services GCP** (fournit les clusters partagés, le Cloud SQL partagé, le NFS partagé et l'Artifact Registry partagé). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme le provisionne automatiquement avant votre déploiement s'il n'existe pas déjà dans le projet cible. App GKE peut aussi fonctionner en mode entièrement autonome, sans Services GCP (`require_services_gcp_module = false`), mais chaque déploiement provisionne alors son propre VPC, son propre cluster GKE, sa propre VM NFS et sa propre instance Cloud SQL.
3. **Autorisations IAM** : le compte de service de déploiement a besoin d'autorisations étendues au niveau du projet (Éditeur du projet ou équivalent) pour créer des espaces de noms GKE, des utilisateurs Cloud SQL, des buckets GCS et des secrets Secret Manager.
4. Les **secrets Secret Manager** référencés dans `secret_environment_variables` doivent exister avant le déploiement — le déploiement échoue si un secret référencé est absent.
5. Pour la **CI/CD** (`enable_cicd_trigger = true`) : un dépôt GitHub et soit un Personal Access Token GitHub (scopes : `repo`, `admin:repo_hook`), soit un ID d'installation de GitHub App.
6. Pour **IAP** (`enable_iap = true`) : un client OAuth 2.0 créé au préalable (ID client et secret) depuis **APIs & Services → Credentials**, ainsi qu'un écran de consentement OAuth configuré.
7. Pour l'**import de sauvegarde** (`enable_backup_import = true`) : le fichier de sauvegarde doit être téléversé dans le bucket GCS de sauvegarde avant le déploiement.

---

## Groupe 0 — Métadonnées du module et câblage de la plateforme {#group-0--module-metadata--platform-wiring}

Ces variables sont consommées par la plateforme de déploiement plutôt que par les ressources Terraform elles-mêmes. `explicit_secret_values` et `scripts_dir` sont renseignées par un module Application (wrapper) — tel que `Ghost_GKE` — qui appelle `App_GKE` en tant que module enfant ; elles doivent rester à leurs valeurs vides par défaut lorsque vous déployez `App_GKE` de manière autonome.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `module_description` | `string` | *(présentation du module)* | Description lisible de l'objectif du module, affichée dans l'interface de la plateforme. Métadonnée uniquement — ne la modifiez pas, sauf si vous personnalisez le module pour un fork. |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/modules/App_GKE"` | Lien vers la documentation externe de ce module, affiché dans l'interface de la plateforme comme référence d'aide. Métadonnée uniquement. |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Autres modules de la plateforme qui doivent être déployés avant celui-ci. Utilisée par la plateforme pour imposer l'ordre des déploiements. Métadonnée uniquement. |
| `module_services` | `list(string)` | `["GKE Autopilot", …]` | Services GCP activés ou consommés par ce module. Utilisée pour la documentation et la visibilité des services dans la plateforme. Métadonnée uniquement. |
| `credit_cost` | `number` | `0` | Crédits de la plateforme consommés lors du déploiement de ce module. Utilisée par le système de facturation de la plateforme. Métadonnée uniquement. |
| `require_credit_purchases` | `bool` | `false` | Lorsqu'elle vaut `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts gratuits ou des crédits d'événement. |
| `enable_purge` | `bool` | `true` | Autorise la suppression complète de toutes les ressources gérées par le module lors de la destruction. Définissez `false` pour conserver les ressources après le retrait du module, afin de vous prémunir contre une perte de données accidentelle. Métadonnée uniquement. |
| `public_access` | `bool` | `true` | Détermine si ce module est listé publiquement dans le catalogue de la plateforme. Métadonnée uniquement. |
| `require_services_gcp_module` | `bool` | `true` | Lorsqu'elle vaut `true`, le déploiement échoue au moment du plan avec une erreur explicite si aucun réseau VPC géré par `Services_GCP` n'est détecté dans le projet. Définissez `false` pour autoriser un déploiement autonome avec des ressources prérequises créées en mode intégré (inline). |
| `shared_users` | `list(string)` | `[]` | Utilisateurs pouvant consulter et déployer ce module, quel que soit le paramètre `public_access`. |
| `technical_support_users` | `list(string)` | `[]` | Utilisateurs chargés d'assurer le support technique de ce module. Le portail de déploiement achemine les demandes de support vers ces adresses. Métadonnée uniquement. |
| `resource_creator_identity` | `string` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | Compte de service utilisé par Terraform pour créer et gérer les ressources. Remplacez-le par un compte de service propre au projet pour les déploiements de production. |
| `impersonation_service_account` | `string` | `""` | Compte de service à emprunter (emprunt d'identité) lorsque les scripts shell (découverte, mise en miroir d'images, configuration NFS) appellent les API GCP. Obligatoire pour les déploiements inter-projets ; laissez vide pour utiliser les identifiants propres de l'exécuteur. |
| `job_execution_wait_timeout` | `number` | `900` | Nombre maximal de secondes pendant lesquelles un déploiement attend la fin du job de configuration de la base de données (`db-create`) avant d'abandonner, afin qu'un job bloqué fasse échouer l'apply rapidement au lieu de rester suspendu jusqu'au délai d'expiration global du build. |
| `explicit_secret_values` | `map(string)` | `{}` | Valeurs brutes de secrets fournies directement par un module wrapper. Les clés doivent correspondre à des entrées de `secret_environment_variables`. Lorsqu'elles sont fournies, la recherche de la source de données Secret Manager au moment du plan est ignorée pour ces clés, ce qui permet au premier apply de réussir avant que les secrets n'existent. |
| `scripts_dir` | `string` | `""` | Répertoire contenant les scripts d'initialisation et utilitaires. Utilise par défaut le répertoire de scripts intégré au module lorsqu'il est laissé vide. À remplacer lorsqu'un module wrapper fournit des scripts personnalisés. |
| `requires_services` | `object` | `{ create_postgres = true, create_network_filesystem = true, create_google_kubernetes_engine = true, … }` | Carte explicite des ressources provisionnées par Services GCP dont ce module a besoin. La plateforme lit cette carte — et non `module_services`, qui est une liste lisible destinée à l'interface de confirmation du déploiement — pour décider quels interrupteurs `create_*` de Services GCP doivent être activés lors du provisionnement automatique ou de la mise à jour du déploiement Services GCP partagé du projet de destination. Les clés reprennent une à une les noms des variables booléennes de Services GCP : `create_postgres`, `create_mysql`, `create_redis`, `create_network_filesystem`, `create_filestore_nfs`, `create_google_kubernetes_engine`, `create_firestore`, `enable_alloydb`. `create_redis` et `create_filestore_nfs` valent `false` par défaut, car le chemin de déploiement automatisé utilise la VM NFS+Redis Compute Engine (`create_network_filesystem`) ; Memorystore/Filestore géré est une optimisation manuelle postérieure au déploiement. |

---

## Groupe 1 — Projet et identité {#group-1--project--identity}

Ces variables établissent le contexte du projet GCP. Elles doivent être correctement configurées pour qu'un déploiement puisse réussir.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | `string` | *(obligatoire)* | ID du projet GCP dans lequel toutes les ressources sont provisionnées. Tous les noms de ressources, liaisons IAM et appels d'API sont limités à ce projet. Doit comporter de 6 à 30 caractères minuscules et commencer par une lettre. |
| `region` | `string` | `"us-central1"` | Région GCP utilisée lorsqu'aucune correspondance de sous-réseau Services GCP ne peut être découverte automatiquement. À remplacer pour les déploiements en dehors de `us-central1`. |

### Explorer dans GCP — Groupe 1 {#exploring-in-gcp--group-1}

**Console Google Cloud :**
- **Confirmation du projet :** le nom et l'ID du projet s'affichent dans la barre de navigation supérieure. Accédez à **Home → Dashboard** pour confirmer que vous êtes dans le bon projet.
- **Région du cluster GKE :** accédez à **Kubernetes Engine → Clusters** pour confirmer que la région du cluster correspond à la région de déploiement attendue.

**CLI gcloud :**
```bash
# Confirm the project exists and is active
gcloud projects describe PROJECT_ID

# List GKE clusters in the project
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,status,currentNodeCount)"
```

---

## Groupe 2 — Identité du déploiement {#group-2--deployment-identity}

Ces variables définissent le suffixe d'environnement du déploiement et les paramètres de notification partagés, appliqués à toutes les ressources.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `tenant_id` | `string` | `"demo"` | Identifiant court ajouté aux noms des ressources (par exemple l'espace de noms Kubernetes, les secrets, l'instance SQL) pour distinguer ce déploiement des autres dans le même projet. Utilisez `prod`, `staging`, `dev` ou un identifiant de tenant. **Ne le modifiez jamais après le déploiement initial** — il est intégré au nom de chaque ressource. |
| `support_users` | `list(string)` | `[]` | Adresses e-mail des destinataires des notifications d'alerte Cloud Monitoring (échecs des tests de disponibilité, dépassements des règles d'alerte). L'ajout d'adresses ici n'accorde aucune autorisation IAM GCP. |
| `resource_labels` | `map(string)` | `{ env = "dev" }` | Libellés clé-valeur appliqués à toutes les ressources GCP créées par ce module. À utiliser pour l'imputation des coûts, le marquage des environnements et l'application des règles d'administration. |

### Explorer dans GCP — Groupe 2 {#exploring-in-gcp--group-2}

**Console Google Cloud :**
- **Espace de noms Kubernetes :** accédez à **Kubernetes Engine → Workloads** et filtrez par espace de noms pour confirmer que le nom de l'espace de noms correspond à `APPLICATION_NAME-TENANT_ID`.
- **Libellés :** accédez à n'importe quelle ressource (par exemple **Cloud Storage → Buckets → *votre bucket*** → **Configuration**) pour vérifier les libellés.
- **Canaux de notification Monitoring :** accédez à **Monitoring → Alerting → Notification channels** pour confirmer que les adresses e-mail des utilisateurs du support sont enregistrées.

**CLI gcloud :**
```bash
# List Kubernetes namespaces on the cluster
kubectl get namespaces --show-labels

# List Cloud Monitoring notification channels
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address)"
```

---

## Groupe 3 — Identité de l'application {#group-3--application-identity}

Ces variables définissent l'identité de l'application déployée. Elles déterminent la manière dont l'application est nommée dans les services GCP et les ressources Kubernetes.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"gkeapp"` | Identifiant interne de l'application. Sert de nom de base pour le Deployment Kubernetes, l'espace de noms, le dépôt Artifact Registry et les secrets Secret Manager. Doit commencer par une lettre minuscule, de 1 à 20 caractères. **Ne le modifiez jamais après le déploiement initial.** |
| `application_display_name` | `string` | `"App_GKE Application"` | Nom lisible affiché dans l'interface de la plateforme et les tableaux de bord de supervision. Peut être modifié librement à tout moment sans incidence sur les noms des ressources. |
| `application_description` | `string` | `"App_GKE Custom Application…"` | Brève description de l'objectif de l'application. Reportée dans les annotations du déploiement Kubernetes et dans la documentation de la plateforme. |
| `application_version` | `string` | `"1.0.0"` | Tag de version appliqué à l'image de conteneur et utilisé pour le suivi des déploiements. L'incrémentation de cette valeur déclenche un nouveau build d'image et un nouveau déploiement lorsque `container_image_source` vaut `custom`. |

### Explorer dans GCP — Groupe 3 {#exploring-in-gcp--group-3}

**Console Google Cloud :**
- **Nom du déploiement :** accédez à **Kubernetes Engine → Workloads** pour confirmer que le déploiement apparaît avec le nom attendu, dérivé de `application_name`.
- **Dépôt Artifact Registry :** accédez à **Artifact Registry → Repositories** pour confirmer qu'un dépôt nommé d'après `application_name` existe.
- **Versions d'image :** cliquez sur le dépôt pour afficher toutes les versions d'image taguées.

**CLI gcloud :**
```bash
# Confirm the Kubernetes Deployment exists
kubectl get deployment APPLICATION_NAME -n NAMESPACE

# List tagged images for the application in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags \
  --format="table(image,tags,createTime)"

# List Secret Manager secrets associated with the application
gcloud secrets list --project=PROJECT_ID \
  --filter="name:APPLICATION_NAME" \
  --format="table(name,createTime)"
```

---

## Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

> **Choisir l'exécution et la mise à l'échelle.** **Source de l'image :** `"custom"` effectue le build depuis votre dépôt via Cloud Build (nécessite la connexion GitHub) ; `"prebuilt"` déploie un URI d'image existant et *exige* `container_image` (vérifié au moment du plan). **Mise à l'échelle :** sur Autopilot, vous payez selon les ressources demandées par les pods, si bien que `min_instance_count`/`max_instance_count` (les bornes du HPA — le minimum ne doit pas dépasser le maximum, ce qui est vérifié) déterminent directement la disponibilité et le coût ; définissez `min` ≥ 1 pour les services sensibles à la latence, et dimensionnez `container_resources` selon l'utilisation réelle, car Autopilot facture la demande, pas le nœud. **La forme de la charge de travail** se décide dans les groupes 6 et 7 : un `Deployment` sans état se met à l'échelle horizontalement et librement ; un `StatefulSet` (sélectionné automatiquement par `stateful_pvc_enabled`) offre une identité stable et un stockage persistant par pod, mais contraint la mise à l'échelle — ne le choisissez que lorsque la charge de travail a réellement besoin d'un stockage ou d'une identité stables.

Ces variables déterminent la manière dont le conteneur de l'application est obtenu, construit, déployé et mis à l'échelle sur GKE Autopilot.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Lorsqu'elle vaut `true`, la charge de travail Kubernetes est déployée. Définissez `false` pour provisionner l'infrastructure de support (VPC, base de données, stockage, espace de noms GKE) sans déployer le conteneur de l'application. Utile pour les déploiements par étapes ou les workflows où l'infrastructure passe en premier. |
| `container_image_source` | `string` | `"custom"` | Détermine la provenance de l'image de conteneur. `prebuilt` déploie directement un URI d'image existant ; `custom` utilise Cloud Build pour construire l'image à partir des sources. |
| `container_image` | `string` | `""` | URI complet de l'image de conteneur à déployer. Obligatoire lorsque `container_image_source` vaut `prebuilt` ou que `enable_image_mirroring` vaut `true`. Exemples : `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:latest`. |
| `container_build_config` | `object` | `{ enabled = true }` | Configuration Cloud Build lorsque `container_image_source` vaut `custom`. Champs principaux : `enabled`, `dockerfile_path`, `dockerfile_content`, `context_path`, `build_args`, `artifact_repo_name`, `base_image`. |
| `enable_image_mirroring` | `bool` | `true` | Met en miroir l'image de conteneur depuis son registre source vers Artifact Registry avant le déploiement. Fortement recommandé pour les images publiques externes, afin d'éviter les limites de débit et de garantir la provenance. |
| `min_instance_count` | `number` | `1` | Nombre minimal de réplicas de pods à maintenir en permanence (`minReplicas` du HPA). Définissez `0` pour une mise à l'échelle jusqu'à zéro (déconseillé pour les charges de travail de production sensibles à la latence). |
| `max_instance_count` | `number` | `3` | Nombre maximal de réplicas de pods autorisés à s'exécuter simultanément (`maxReplicas` du HPA). Sert de plafond de coût. Assurez-vous que `max × connections_per_pod` ne dépasse pas le `max_connections` de Cloud SQL. |
| `container_port` | `number` | `8080` | Port TCP sur lequel l'application écoute à l'intérieur du conteneur. Le Service Kubernetes achemine tout le trafic vers ce port. Doit correspondre exactement au port auquel votre serveur applicatif se lie. |
| `container_protocol` | `string` | `"http1"` | Version du protocole HTTP pour le backend du Service Kubernetes. `http1` correspond au HTTP/1.1 standard ; `h2c` au HTTP/2 en clair (requis pour gRPC). Lorsque `h2c` est défini, le port du Service annonce `appProtocol: kubernetes.io/h2c`. |
| `container_resources` | `object` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Demandes et limites de ressources CPU et mémoire du conteneur. GKE Autopilot facture selon les ressources demandées — définissez des demandes précises. Accepte la notation de quantité Kubernetes (`1000m`, `512Mi`, `1Gi`). Champs facultatifs : `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. |
| `timeout_seconds` | `number` | `300` | Durée maximale, en secondes, pendant laquelle l'équilibreur de charge attend la réponse d'un pod backend avant de renvoyer un délai d'expiration 504. Plage valide : 0–3600. |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Active le Vertical Pod Autoscaling (VPA), qui ajuste automatiquement les demandes de CPU et de mémoire en fonction de l'utilisation observée. Recommandé pour GKE Autopilot, où des demandes précises réduisent le coût. Ne le combinez pas avec le HPA sur la même métrique CPU/mémoire. |
| `enable_cloudsql_volume` | `bool` | `true` | Injecte un conteneur sidecar Cloud SQL Auth Proxy dans le pod GKE, exposant la base de données sur `127.0.0.1` via un socket Unix. C'est la voie sécurisée recommandée pour la connectivité à Cloud SQL. |
| `cloud_sql_proxy_version` | `string` | `"2-alpine"` | Tag de version de l'image sidecar Cloud SQL Auth Proxy. Épinglez-la sur un digest pour des déploiements immuables. L'image du proxy est automatiquement mise en miroir dans Artifact Registry. |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Chemin du système de fichiers, à l'intérieur du conteneur, où le socket Unix du Cloud SQL Auth Proxy est monté. La chaîne de connexion à la base de données de votre application doit référencer ce chemin. |
| `service_annotations` | `map(string)` | `{}` | Annotations personnalisées appliquées à la ressource Service Kubernetes. À utiliser pour une configuration avancée de GKE ou de l'équilibreur de charge non exposée sous forme de paramètres dédiés. |
| `service_labels` | `map(string)` | `{ env = "dev" }` | Libellés personnalisés appliqués spécifiquement à la ressource Service Kubernetes, en plus de `resource_labels`. |
| `deployment_timeout` | `number` | `1800` | Nombre maximal de secondes pendant lesquelles la plateforme attend la fin du déploiement progressif du Deployment ou du StatefulSet Kubernetes. À augmenter pour les clusters qui récupèrent des images volumineuses ou pour les pods dont le démarrage est long. |

### Explorer dans GCP — Groupe 4 {#exploring-in-gcp--group-4}

**Console Google Cloud :**
- **Déploiement et mise à l'échelle :** accédez à **Kubernetes Engine → Workloads → *votre déploiement*** pour afficher le déploiement, son nombre de réplicas et la configuration du HPA.
- **Image de conteneur :** dans les détails de la charge de travail, sélectionnez l'onglet **YAML** pour afficher la spécification du conteneur, y compris l'URI de l'image et les limites de ressources.
- **Images Artifact Registry :** accédez à **Artifact Registry → Repositories → *application_name*** pour afficher les tags d'image disponibles.
- **État du HPA :** accédez à **Kubernetes Engine → Workloads** et recherchez les ressources `HorizontalPodAutoscaler` dans le même espace de noms.

**CLI gcloud / kubectl :**
```bash
# Describe the Kubernetes Deployment
kubectl describe deployment APPLICATION_NAME -n NAMESPACE

# View HPA configuration and current replica counts
kubectl get hpa -n NAMESPACE

# Describe the HPA for scaling details
kubectl describe hpa APPLICATION_NAME -n NAMESPACE

# List pod resource requests/limits
kubectl get pods -n NAMESPACE -o custom-columns=\
"NAME:.metadata.name,CPU_REQ:.spec.containers[*].resources.requests.cpu,\
MEM_REQ:.spec.containers[*].resources.requests.memory,\
CPU_LIM:.spec.containers[*].resources.limits.cpu,\
MEM_LIM:.spec.containers[*].resources.limits.memory"

# List container images in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags --format="table(image,tags,createTime)"
```

---

## Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

Ces variables déterminent la manière dont la configuration et les identifiants sensibles sont transmis aux pods en cours d'exécution.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement en clair injectées dans le pod GKE à l'exécution. À utiliser pour une configuration non sensible, comme des feature flags, des niveaux de journalisation ou des points de terminaison d'API. N'y stockez jamais de mots de passe ni de jetons. |
| `secret_environment_variables` | `map(string)` | `{}` | Références à des secrets Secret Manager injectées comme variables d'environnement dans le pod via `valueFrom` de Kubernetes. La clé de la carte est le nom de la variable d'environnement ; la valeur est le nom du secret Secret Manager. La valeur en clair n'est jamais stockée dans la configuration ni dans l'état. |
| `secret_rotation_period` | `string` | `"2592000s"` | Fréquence à laquelle Secret Manager publie une notification de rotation via Pub/Sub. Exprimée en secondes avec le suffixe `s` (par exemple `"2592000s"` pour 30 jours). Ne fait pas tourner automatiquement le secret — un gestionnaire de rotation doit être implémenté séparément. |
| `secret_propagation_delay` | `number` | `30` | Nombre de secondes d'attente après la création ou la mise à jour d'un secret avant de poursuivre. Laisse à la réplication mondiale de Secret Manager le temps de se terminer avant que les pods ne tentent de lire la valeur du secret. À augmenter si les déploiements échouent avec des erreurs de secret introuvable. |

### Explorer dans GCP — Groupe 5 {#exploring-in-gcp--group-5}

**Console Google Cloud :**
- **Contenu des Secrets Kubernetes (CSI) :** accédez à **Kubernetes Engine → Workloads → *votre déploiement* → YAML** pour afficher les blocs `env` et `envFrom` contenant les références aux secrets.
- **Secrets Secret Manager :** accédez à **Security → Secret Manager** pour afficher tous les secrets, leurs versions, leurs calendriers de rotation et leurs règles d'accès.
- **Accès IAM aux secrets :** dans Secret Manager, cliquez sur un secret → **Permissions** pour confirmer que le compte de service de la charge de travail GKE dispose des autorisations `Secret Accessor`.

**CLI gcloud / kubectl :**
```bash
# View environment variables on a running pod
kubectl exec -n NAMESPACE POD_NAME -- env | sort

# List Kubernetes Secrets in the namespace
kubectl get secrets -n NAMESPACE

# List Secret Manager secrets for the application
gcloud secrets list --project=PROJECT_ID \
  --filter="name:APPLICATION_NAME" \
  --format="table(name,createTime)"

# View the rotation config for a specific secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID --format="yaml(rotation,labels)"

# Confirm the GKE workload SA has Secret Accessor access
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-config}

Ces variables déterminent la manière dont l'application est exposée au sein du cluster Kubernetes et dont elle est raccordée au cluster GKE et au réseau.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `gke_cluster_name` | `string` | `""` | Nom du cluster GKE dans lequel déployer. Laissez vide pour découvrir automatiquement un cluster géré par Services GCP à l'aide de `gke_cluster_selection_mode`. |
| `gke_cluster_selection_mode` | `string` | `"primary"` | Stratégie de sélection du cluster GKE cible lorsque `gke_cluster_name` n'est pas défini. `primary` cible le premier cluster géré par Services GCP découvert ; `round-robin` répartit entre plusieurs clusters ; `explicit` exige que `gke_cluster_name` soit défini. |
| `namespace_name` | `string` | `""` | Espace de noms Kubernetes dans lequel déployer les ressources de l'application. Laissez vide pour le générer automatiquement à partir de `application_name` et `tenant_id`. |
| `workload_type` | `string` | `null` | Contrôleur de charge de travail Kubernetes. `Deployment` pour les applications sans état ; `StatefulSet` pour les applications qui nécessitent des identités réseau stables ou un stockage persistant par pod. Vaut `Deployment` par défaut lorsqu'elle est null. Définir `stateful_pvc_enabled = true` la résout automatiquement en `StatefulSet`. |
| `service_type` | `string` | `"LoadBalancer"` | Type de Service Kubernetes. `LoadBalancer` provisionne un équilibreur de charge GCP avec une IP externe ; `ClusterIP` pour un accès uniquement interne ; `NodePort` expose sur un port statique sur tous les nœuds. |
| `service_port` | `number` | `80` | Port exposé sur le Service Kubernetes (le port auquel les clients se connectent). À aligner sur le port natif de l'application lorsque les clients doivent se connecter sur ce port précis. |
| `extra_service_ports` | `list(object)` | `[]` | Ports supplémentaires à exposer sur le Service Kubernetes, pour une charge de travail qui parle plusieurs protocoles sur le même pod (par exemple ClickHouse, qui sert le HTTP sur `8123` alors que son protocole natif est sur `9000`). Chaque entrée définit `name`, `port`, un `target_port` facultatif (vaut `port` par défaut) et un `protocol` facultatif (vaut `TCP` par défaut). Les noms doivent être uniques — Kubernetes exige un nom distinct pour chaque port d'un Service multiport, ce qui est vérifié au moment du plan. Purement additif : la valeur vide par défaut produit exactement le même Service qu'auparavant. |
| `session_affinity` | `string` | `"ClientIP"` | Mode d'affinité de session du Service Kubernetes. `ClientIP` achemine toutes les requêtes d'une même IP client vers le même pod (utile pour les applications avec état). `None` répartit les requêtes entre tous les pods. |
| `enable_network_segmentation` | `bool` | `false` | Crée des ressources NetworkPolicy Kubernetes pour restreindre le trafic entrant et sortant entre pods. Limite le rayon d'impact d'une charge de travail compromise. Nécessite que l'application des règles réseau soit activée sur le cluster GKE. À n'activer qu'après avoir cartographié tous les flux de trafic entre espaces de noms. |
| `configure_service_mesh` | `bool` | `false` | Active l'injection du service mesh Istio pour l'espace de noms de l'application en ajoutant le libellé `istio-injection: enabled`. Nécessite que Cloud Service Mesh ou Anthos Service Mesh soit installé sur le cluster. |
| `enable_multi_cluster_service` | `bool` | `false` | Destinée à activer GKE Multi-Cluster Services (MCS) pour la découverte de services entre clusters au sein d'une GKE Fleet. Remarque : la ressource ServiceExport n'est actuellement pas créée par ce module — cette variable n'a aucun effet sur le déploiement dans la version actuelle. |
| `termination_grace_period_seconds` | `number` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend après l'envoi de SIGTERM avant de terminer de force le conteneur avec SIGKILL. À augmenter pour les applications qui ont besoin de temps pour terminer les requêtes en cours ou vider leurs données. Plage valide : 0–3600. |
| `prereq_gke_subnet_cidr` | `string` | `"10.201.0.0/24"` | Plage CIDR du sous-réseau GKE intégré créé lorsqu'un VPC Services GCP existe mais qu'aucun cluster GKE n'est présent. Ne doit pas chevaucher d'autres sous-réseaux. Chaque déploiement App GKE dans le même VPC doit utiliser un CIDR distinct. **Ne la modifiez jamais après la création du cluster GKE intégré.** |
| `prereq_subnet_cidr_override` | `string` | `""` | Remplacement du CIDR du sous-réseau principal du VPC intégré. Lorsqu'il est vide, un `/24` unique est dérivé pour chaque déploiement. Épinglez-le sur la valeur précédemment appliquée pour les déploiements existants afin d'éviter le remplacement du sous-réseau. |
| `prereq_gke_pod_cidr_override` | `string` | `""` | Remplacement du CIDR de la plage secondaire des pods du cluster GKE intégré. Épinglez-le sur la valeur précédemment appliquée pour les déploiements existants afin d'éviter le remplacement du cluster GKE. |
| `prereq_gke_service_cidr_override` | `string` | `""` | Remplacement du CIDR de la plage secondaire des services du cluster GKE intégré. Épinglez-le sur la valeur précédemment appliquée pour les déploiements existants afin d'éviter le remplacement du cluster GKE. |
| `prereq_gke_master_cidr_override` | `string` | `""` | Remplacement du `/28` privé du plan de contrôle du cluster GKE intégré. Lorsqu'il est vide, le socle dérive un `/28` unique par déploiement à partir de l'ID de déploiement aléatoire, à l'intérieur de `172.16.0.0/12` — un bloc RFC1918 différent de celui des plages de sous-réseau, de pods et de services ci-dessus, de sorte qu'il ne peut jamais entrer en collision avec elles. Épinglez-le sur la valeur précédemment appliquée pour les déploiements existants afin d'éviter le remplacement du cluster GKE. |

#### Les clusters GKE intégré utilisent toujours des nœuds privés {#inline-gke-clusters-always-run-private-nodes}

Le cluster GKE Autopilot intégré est créé avec `private_cluster_config { enable_private_nodes = true }`, ce qui n'est **pas** facultatif et ne dispose d'aucune variable pour le désactiver. Les projets gérés par RAD appliquent une règle d'administration DENY `constraints/compute.vmExternalIpAccess` ; sans nœuds privés, GKE tente d'attribuer des IP externes à ses nœuds, la création des nœuds échoue avec `Constraint constraints/compute.vmExternalIpAccess violated`, et le cluster reste bloqué à l'état `ERROR`.

Seuls les **nœuds** sont privés. `enable_private_endpoint` est délibérément laissé à sa valeur par défaut (`false`), si bien que le plan de contrôle conserve son point de terminaison public — Cloud Build et les autres outils situés hors du VPC s'y connectent directement. La plage privée propre au plan de contrôle provient de `prereq_gke_master_cidr_override` (ou du `/28` dérivé ci-dessus).

### Explorer dans GCP — Groupe 6 {#exploring-in-gcp--group-6}

**Console Google Cloud :**
- **Cluster GKE :** accédez à **Kubernetes Engine → Clusters** pour confirmer le cluster cible et sa configuration.
- **Espace de noms Kubernetes :** accédez à **Kubernetes Engine → Workloads** et filtrez par espace de noms.
- **Service Kubernetes :** accédez à **Kubernetes Engine → Services & Ingress** pour afficher le type de Service, l'IP externe et le mappage des ports.
- **NetworkPolicies :** accédez à **Kubernetes Engine → Workloads** et recherchez les ressources NetworkPolicy dans l'espace de noms.

**kubectl :**
```bash
# Confirm the namespace exists with correct labels
kubectl get namespace NAMESPACE --show-labels

# Describe the Kubernetes Service (type, IP, ports)
kubectl describe service APPLICATION_NAME -n NAMESPACE

# List all Services in the namespace
kubectl get services -n NAMESPACE

# Check for NetworkPolicies
kubectl get networkpolicies -n NAMESPACE

# Describe a NetworkPolicy to review ingress/egress rules
kubectl describe networkpolicy -n NAMESPACE

# Check service mesh injection label
kubectl get namespace NAMESPACE -o jsonpath='{.metadata.labels}'
```

---

## Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

> **Choisir entre StatefulSet et Deployment.** Définir `stateful_pvc_enabled = true` est l'unique interrupteur : il **résout automatiquement la charge de travail en `StatefulSet`** (vous ne définissez pas aussi `workload_type` — l'associer à `workload_type = "Deployment"` est rejeté au moment du plan) et donne à chaque réplica une identité réseau stable ainsi que son propre PersistentVolumeClaim, qui survit aux replanifications. Utilisez-le pour les bases de données dans le cluster, les brokers ou tout ce qui nécessite un stockage stable par pod. Pour les charges de travail web/API sans état, laissez-le désactivé — un `Deployment` se met à l'échelle plus librement et n'a pas de cycle de vie de PVC à gérer. Lorsqu'il est activé, `stateful_pvc_size` et `stateful_pvc_mount_path` sont obligatoires (vérifié). Notez qu'un stockage partagé entre les pods répond à un besoin *différent* — utilisez NFS (groupe 13), et non des PVC par pod.

Ces variables configurent le stockage persistant des charges de travail StatefulSet. Chaque réplica de pod reçoit son propre PersistentVolumeClaim (PVC) isolé, pour un stockage stable par pod.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `null` | Active les modèles de PersistentVolumeClaim dans la spécification du StatefulSet, afin que chaque réplica de pod reçoive son propre PVC isolé. La définir sur `true` résout automatiquement `workload_type` en `StatefulSet`. Définir `workload_type = "Deployment"` en même temps échoue au moment du plan. |
| `stateful_pvc_size` | `string` | `null` | Taille de stockage de chaque PVC provisionné par le StatefulSet. Chaque pod reçoit un PVC de cette taille. Exemple : `"20Gi"`. |
| `stateful_pvc_mount_path` | `string` | `null` | Chemin du système de fichiers, à l'intérieur de chaque conteneur de pod, où le PVC du pod est monté. L'application lit et écrit ses données persistantes dans ce chemin. Exemple : `"/var/lib/data"`. |
| `stateful_pvc_storage_class` | `string` | `null` | StorageClass Kubernetes des PVC du StatefulSet. Laissez null pour utiliser la StorageClass par défaut du cluster. Pour GKE Autopilot, `standard-rwo` (Balanced PD, ReadWriteOnce) est la valeur par défaut. |
| `stateful_headless_service` | `bool` | `null` | Crée un Service Kubernetes headless (`clusterIP: None`) à côté du StatefulSet, donnant à chaque pod une entrée DNS stable (par exemple `pod-0.service.namespace.svc.cluster.local`). Obligatoire pour les applications leader-follower ou à découverte de pairs. |
| `stateful_pod_management_policy` | `string` | `null` | Détermine l'ordre de création et de suppression des pods. `OrderedReady` démarre et arrête les pods séquentiellement (requis pour le mode leader-follower). `Parallel` démarre tous les pods simultanément pour une mise à l'échelle plus rapide. Vaut `OrderedReady` par défaut. |
| `stateful_update_strategy` | `string` | `null` | Stratégie de mise à jour du StatefulSet. `RollingUpdate` remplace les pods un par un lorsque le modèle change. `OnDelete` ne met à jour les pods que lorsqu'ils sont supprimés manuellement. Vaut `RollingUpdate` par défaut. |
| `stateful_fs_group` | `number` | `0` | GID défini comme `fsGroup` au niveau du pod dans le contexte de sécurité du StatefulSet. Kubernetes attribue la propriété du montage du PVC à ce GID lors de l'attachement, ce qui donne au processus applicatif un accès en écriture lorsqu'il s'exécute sous un UID non root. Définissez `0` pour laisser `fsGroup` non défini. |

### Explorer dans GCP — Groupe 7 {#exploring-in-gcp--group-7}

**Console Google Cloud :**
- **StatefulSet :** accédez à **Kubernetes Engine → Workloads** et confirmez que le type de charge de travail est `StatefulSet`.
- **PersistentVolumeClaims :** accédez à **Kubernetes Engine → Storage → PersistentVolumeClaims** pour afficher les PVC par pod et leur état de liaison.
- **Persistent Volumes :** accédez à **Kubernetes Engine → Storage → PersistentVolumes** pour afficher les ressources de disque sous-jacentes.

**kubectl :**
```bash
# View the StatefulSet configuration
kubectl describe statefulset APPLICATION_NAME -n NAMESPACE

# List PersistentVolumeClaims created by the StatefulSet
kubectl get pvc -n NAMESPACE

# Describe a specific PVC to confirm StorageClass and binding status
kubectl describe pvc PVC_NAME -n NAMESPACE

# Verify headless Service exists (clusterIP should be None)
kubectl get service APPLICATION_NAME-headless -n NAMESPACE \
  -o jsonpath='{.spec.clusterIP}'

# Check pod ordinal DNS resolution (from within the cluster)
# nslookup pod-0.APPLICATION_NAME-headless.NAMESPACE.svc.cluster.local
```

---

## Groupe 8 — Quota de ressources {#group-8--resource-quota}

Ces variables créent un ResourceQuota Kubernetes dans l'espace de noms de l'application, empêchant une seule charge de travail de monopoliser les ressources partagées du cluster GKE Autopilot.

> **Important :** `quota_memory_requests` et `quota_memory_limits` **doivent** utiliser des suffixes d'unité binaires (`Gi`, `Mi`) — des entiers nus comme `"4"` sont interprétés par Kubernetes comme 4 octets et bloqueront toute planification de pods dans l'espace de noms.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_resource_quota` | `bool` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. Recommandé pour les clusters partagés multitenants, afin d'empêcher une application de consommer des ressources sans limite. |
| `quota_cpu_requests` | `string` | `"4"` | Total des demandes de CPU autorisées pour l'ensemble des pods de l'espace de noms. Laissez vide pour n'appliquer aucun quota de demandes de CPU. Accepte la notation CPU de Kubernetes (`"4"`, `"4000m"`). |
| `quota_cpu_limits` | `string` | `"4"` | Total des limites de CPU autorisées pour l'ensemble des pods de l'espace de noms. Doit être ≥ `quota_cpu_requests`. |
| `quota_memory_requests` | `string` | `"4Gi"` | Total des demandes de mémoire autorisées pour l'ensemble des pods de l'espace de noms. **Doit utiliser un suffixe d'unité binaire** (`Gi`, `Mi`). |
| `quota_memory_limits` | `string` | `"8Gi"` | Total des limites de mémoire autorisées pour l'ensemble des pods de l'espace de noms. Doit être ≥ `quota_memory_requests`. **Doit utiliser un suffixe d'unité binaire** (`Gi`, `Mi`). |
| `quota_max_pods` | `string` | `"20"` | Nombre maximal de pods autorisés dans l'espace de noms. Laissez vide pour n'appliquer aucun quota de nombre de pods. |
| `quota_max_services` | `string` | `"10"` | Nombre maximal de Services Kubernetes autorisés dans l'espace de noms. |
| `quota_max_pvcs` | `string` | `"5"` | Nombre maximal de PersistentVolumeClaims autorisés dans l'espace de noms. Pertinent lorsque `workload_type` vaut `StatefulSet`. |

### Explorer dans GCP — Groupe 8 {#exploring-in-gcp--group-8}

**Console Google Cloud :**
- **ResourceQuota :** accédez à **Kubernetes Engine → Workloads** et filtrez sur les ressources `ResourceQuota` de l'espace de noms pour comparer l'utilisation actuelle aux limites.

**kubectl :**
```bash
# View the ResourceQuota and current usage
kubectl describe resourcequota -n NAMESPACE

# List all ResourceQuotas in the namespace
kubectl get resourcequota -n NAMESPACE -o yaml

# Check if pods are being rejected due to quota exhaustion
kubectl describe pod PENDING_POD_NAME -n NAMESPACE \
  | grep -A5 "Events:"
```

---

## Groupe 9 — Fiabilité {#group-9--reliability}

Ces variables configurent les PodDisruptionBudgets et les TopologySpreadConstraints afin de maintenir la disponibilité lors des interruptions volontaires et de répartir les pods entre les domaines de défaillance.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Crée un PodDisruptionBudget (PDB) Kubernetes qui limite le nombre de pods pouvant être indisponibles simultanément lors d'interruptions volontaires, comme les mises à niveau des nœuds GKE Autopilot. Fortement recommandé pour les déploiements de production. |
| `pdb_min_available` | `string` | `"1"` | Nombre ou pourcentage minimal de pods qui doivent rester disponibles lors des interruptions volontaires. Accepte un entier (`"1"`, `"2"`) ou un pourcentage (`"50%"`). **Attention :** définir `"1"` avec un déploiement à réplica unique bloque les mises à niveau des nœuds GKE — utilisez `"0"` pour les charges de travail à réplica unique pour lesquelles une brève indisponibilité pendant les mises à niveau est acceptable. |
| `enable_topology_spread` | `bool` | `false` | Ajoute des TopologySpreadConstraints Kubernetes à la spécification du pod, répartissant uniformément les pods entre les zones des nœuds GKE et les nœuds individuels. Améliore la disponibilité en évitant que tous les réplicas soient regroupés dans un seul domaine de défaillance. Recommandé pour les déploiements de production avec `min_instance_count > 1`. |
| `topology_spread_strict` | `bool` | `false` | Détermine le comportement `whenUnsatisfiable` de la contrainte de répartition topologique. Lorsqu'elle vaut `true`, les pods sont rejetés avec `DoNotSchedule` si la contrainte de répartition ne peut pas être satisfaite (nécessite ≥ 3 réplicas sur ≥ 3 zones). Lorsqu'elle vaut `false`, `ScheduleAnyway` est utilisé — plus sûr pour les déploiements de petite taille. |

### Explorer dans GCP — Groupe 9 {#exploring-in-gcp--group-9}

**Console Google Cloud :**
- **PodDisruptionBudget :** accédez à **Kubernetes Engine → Workloads** et filtrez sur les ressources `PodDisruptionBudget` de l'espace de noms.
- **Répartition des pods par zone :** accédez à **Kubernetes Engine → Workloads → *votre déploiement* → Managed pods** pour voir sur quels nœuds et dans quelles zones chaque pod s'exécute.

**kubectl :**
```bash
# View the PodDisruptionBudget
kubectl describe pdb -n NAMESPACE

# Check pod distribution across zones and nodes
kubectl get pods -n NAMESPACE -o wide

# Describe a pod to view TopologySpreadConstraints in the spec
kubectl describe pod POD_NAME -n NAMESPACE | grep -A10 "Topology"

# Check for scheduling failures due to topology constraints
kubectl get events -n NAMESPACE \
  --field-selector reason=FailedScheduling
```

---

## Groupe 10 — Observabilité {#group-10--observability}

Ces variables configurent les sondes de santé Kubernetes, les tests de disponibilité Cloud Monitoring et les règles d'alerte.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe_config` | `object` | `{ enabled = true, path = "/healthz" }` | Sonde de démarrage Kubernetes — Kubernetes n'achemine aucune requête vers le pod tant que cette sonde n'a pas réussi. Sous-champs : `enabled`, `type` (`HTTP` / `TCP`), `path`, `initial_delay_seconds` (défaut : 10), `timeout_seconds` (défaut : 5), `period_seconds` (défaut : 10), `failure_threshold` (défaut : 3). Pour les applications au démarrage lent, augmentez `failure_threshold` ou `period_seconds`. |
| `health_check_config` | `object` | `{ enabled = true, path = "/healthz" }` | Sondes Kubernetes de liveness **et** de readiness — une configuration unique produit les deux, sur les charges de travail Deployment **et** StatefulSet. (À l'origine, les StatefulSets ne produisaient aucune readinessProbe et tombaient donc sur le repli `GET /` de la Gateway décrit ci-dessous ; `statefulset.tf` émet désormais une readinessProbe identique sur ses deux spécifications de conteneur, si bien que ce repli ne s'applique plus. Notez que cela ne modifie pas rétroactivement la vérification d'état d'un Backend Service déjà créé.) La sonde de liveness vérifie périodiquement si le conteneur en cours d'exécution est en bonne santé ; si elle échoue `failure_threshold` fois consécutives, Kubernetes redémarre le conteneur. La sonde de readiness détermine en outre si le pod reçoit du trafic, et l'API Gateway de GKE (Container-Native Load Balancing) en dérive la vérification d'état de son Backend Service au niveau GCP — sans sonde de readiness, la Gateway se replie silencieusement sur un `GET /` non configurable attendant un `200`, ce qui marque définitivement le backend `UNHEALTHY` pour toute application dont le chemin racine ne renvoie pas `200`. Les sous-champs reprennent ceux de `startup_probe_config` (`initial_delay_seconds` défaut : 15, `timeout_seconds` défaut : 5, `period_seconds` défaut : 30, `failure_threshold` défaut : 3). Le point de terminaison de santé doit répondre rapidement et ne pas effectuer d'opérations coûteuses. |
| `uptime_check_config` | `object` | `{ enabled = false, path = "/" }` | Test de disponibilité Google Cloud Monitoring qui envoie des requêtes HTTP à l'application depuis plusieurs emplacements dans le monde. Déclenche une alerte vers `support_users` si le point de terminaison devient injoignable. Désactivé par défaut — définissez `enabled = true` pour provisionner le test. Sous-champs : `enabled`, `path`, `check_interval` (défaut : `"60s"`), `timeout` (défaut : `"10s"`). Actif uniquement lorsque le point de terminaison de l'application dispose d'un hôte stable et résolvable. Pour un service `LoadBalancer` doté d'une IP statique réservée (le comportement par défaut — voir `reserve_static_ip`), le test sonde automatiquement un **nom d'hôte `<reserved-ip>.nip.io` par défaut** ; définissez `application_domains` pour sonder plutôt votre propre domaine. Un simple `LoadBalancer` à IP éphémère (c'est-à-dire `reserve_static_ip = false` sans `application_domains`) n'a pas d'hôte stable ; le test est donc ignoré. |
| `alert_policies` | `list(object)` | `[]` | Règles d'alerte Cloud Monitoring qui déclenchent des notifications vers `support_users` lorsque des métriques Kubernetes dépassent des seuils définis. Chaque règle requiert : `name`, `metric_type`, `comparison` (`COMPARISON_GT` / `COMPARISON_LT`), `threshold_value`, `duration_seconds`, `aggregation_period` (défaut : `"60s"`). Types de métriques GKE courants : `kubernetes.io/container/cpu/usage_time`, `kubernetes.io/container/memory/used_bytes`. |

### Explorer dans GCP — Groupe 10 {#exploring-in-gcp--group-10}

**Console Google Cloud :**
- **Sondes de santé :** accédez à **Kubernetes Engine → Workloads → *votre déploiement* → YAML** et recherchez les champs `livenessProbe`, `readinessProbe` et `startupProbe` dans la spécification du conteneur.
- **Tests de disponibilité :** accédez à **Monitoring → Uptime checks** pour afficher les tests actifs, leur état actuel et les résultats par emplacement dans le monde.
- **Règles d'alerte :** accédez à **Monitoring → Alerting** pour afficher les règles d'alerte configurées, leur état et leurs canaux de notification.

**kubectl / CLI gcloud :**
```bash
# Describe the deployment to view probe configuration
kubectl describe deployment APPLICATION_NAME -n NAMESPACE \
  | grep -A20 "Liveness\|Readiness\|Startup"

# Check pod events for probe failures
kubectl describe pod POD_NAME -n NAMESPACE | tail -20

# List all uptime checks in the project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"

# List all Cloud Monitoring alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"
```

---

## Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

Ces variables définissent les jobs d'initialisation, les tâches planifiées récurrentes et les services complémentaires qui s'exécutent à côté de la charge de travail principale de l'application.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[{ name = "db-init", … }]` | Jobs Kubernetes exécutés une seule fois pendant ou après le déploiement pour initialiser l'application. Usages courants : migrations de schéma de base de données, chargement de données initiales, préparation des répertoires NFS. Sous-champs principaux : `name`, `description`, `image`, `command`, `args`, `script_path`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `needs_db`, `needs_secrets`. Sur GKE, `execute_on_apply` détermine uniquement si Terraform **attend** la fin du job avant de poursuivre — le Job Kubernetes est créé et planifié dans tous les cas, si bien qu'un job dont la justesse dépend de la fin du démarrage de la charge de travail principale peut tout de même entrer en concurrence avec elle. |
| `cron_jobs` | `list(object)` | `[]` | Tâches planifiées récurrentes déployées sous forme de CronJobs Kubernetes. Chaque entrée définit : `name`, `schedule` (expression cron en UTC), `image`, `command`, `args`, `env_vars`, `cpu_limit`, `memory_limit`, `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`, `mount_nfs`, `mount_gcs_volumes`, `script_path`. |
| `additional_services` | `list(object)` | `[]` | Deployments Kubernetes complémentaires déployés à côté de l'application principale dans le même espace de noms. À utiliser pour des schémas de type sidecar : workers dédiés, services proxy, consommateurs de files d'attente en arrière-plan. Chacun crée son propre Deployment, son propre Service et un HPA facultatif. Sous-champs principaux : `name`, `image`, `port`, `command`, `args`, `env_vars`, `secret_env_vars` (associe un nom de variable d'environnement à une clé du Secret applicatif matérialisé, afin qu'un sidecar puisse lire les mêmes secrets que le conteneur principal), `cpu_limit`, `memory_limit`, `ephemeral_storage_limit`, `ephemeral_storage_request`, `min_instance_count`, `max_instance_count`, `ingress`, `service_port`, `loadbalancer_ip` (épingle un service supplémentaire `LoadBalancer` sur une IP externe statique réservée, ce qui donne une URL stable connue au moment du plan), `extra_ports` (ports de Service supplémentaires pour un conteneur qui écoute sur plusieurs ports sous un même nom de Service), `output_env_var_name` (injecte automatiquement l'URL du service dans l'application principale sous forme de variable d'environnement), `volume_mounts`, `persistent_volume` (un PVC de stockage en mode bloc dédié — `size`, `mount_path`, `storage_class`, par défaut `standard-rwo` — pour un sidecar avec état ; en `ReadWriteOnce`, le service doit donc rester à un seul réplica, et le PVC n'est **pas** supprimé avec le Deployment), `wait_for_rollout` (`true` par défaut ; ne définissez `false` que lorsque le service ne peut pas devenir sain avant l'exécution d'une étape ultérieure, ce qui bloquerait sinon l'apply — cela transforme un échec au moment de l'apply en échec silencieux), `startup_probe`, `liveness_probe`. |

### Explorer dans GCP — Groupe 11 {#exploring-in-gcp--group-11}

**Console Google Cloud :**
- **Jobs Kubernetes :** accédez à **Kubernetes Engine → Workloads** et filtrez sur le type de ressource `Job` pour afficher les jobs d'initialisation, leur état d'achèvement et leur durée.
- **CronJobs :** accédez à **Kubernetes Engine → Workloads** et filtrez sur le type de ressource `CronJob` pour afficher les calendriers et l'état de la dernière exécution.
- **Services supplémentaires :** accédez à **Kubernetes Engine → Services & Ingress** pour afficher les points de terminaison des services supplémentaires.

**kubectl :**
```bash
# List all Kubernetes Jobs in the namespace
kubectl get jobs -n NAMESPACE

# View the logs of a specific initialization job
kubectl logs -n NAMESPACE job/JOB_NAME

# List all CronJobs and their schedules
kubectl get cronjobs -n NAMESPACE

# View the last few runs of a CronJob
kubectl get jobs -n NAMESPACE \
  --selector=app=CRONJOB_NAME \
  --sort-by=.metadata.creationTimestamp

# Check pod logs for a CronJob execution
kubectl logs -n NAMESPACE -l job-name=JOB_NAME

# List all Deployments (includes additional services)
kubectl get deployments -n NAMESPACE
```

---

## Groupe 12 — CI/CD {#group-12--cicd}

Ces variables configurent les pipelines automatisés de build et de déploiement à l'aide de Cloud Build et, facultativement, de Cloud Deploy.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Interrupteur principal du pipeline CI/CD. Lorsqu'elle vaut `true`, un déclencheur Cloud Build est créé ; il surveille le dépôt GitHub connecté et construit puis déploie automatiquement l'application lors des push de code éligibles. |
| `github_repository_url` | `string` | `""` | URL HTTPS complète du dépôt GitHub à connecter à Cloud Build. Obligatoire lorsque `enable_cicd_trigger` vaut `true`. Format : `https://github.com/ORG/REPO`. |
| `github_token` | `string` | `""` | Personal Access Token GitHub utilisé pour autoriser la connexion GitHub de Cloud Build. Obligatoire lors du premier déploiement lorsque `enable_cicd_trigger` vaut `true`. Scopes requis : `repo` et `admin:repo_hook`. Stocké dans Secret Manager après le premier déploiement, puis réutilisé automatiquement. |
| `github_app_installation_id` | `string` | `""` | ID d'installation de la GitHub App Cloud Build. À privilégier pour les dépôts d'organisation. Lorsqu'il est fourni en même temps que `github_token`, la connexion s'authentifie via la GitHub App. |
| `cicd_trigger_config` | `object` | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. Sous-champs : `branch_pattern` (expression régulière correspondant aux noms de branches), `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `bool` | `false` | Fait passer le pipeline CI/CD de déploiements Cloud Build directs à un pipeline Google Cloud Deploy géré, avec des étapes de promotion. Nécessite que `enable_cicd_trigger` vaille `true`. |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod]` | Liste ordonnée des étapes de promotion du pipeline de livraison Cloud Deploy. Chaque étape crée une cible Cloud Deploy et l'espace de noms GKE associé. Sous-champs : `name`, `target_name`, `namespace`, `cluster`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `gateway_backend_stage` | `string` | `"dev"` | Étape Cloud Deploy dont le Service est ciblé par la HTTPRoute de la Gateway. Passez à `"staging"` ou `"prod"` une fois que Cloud Deploy a effectué la promotion vers cette étape. Ignorée lorsque `enable_cloud_deploy` vaut `false`. |
| `enable_binary_authorization` | `bool` | `false` | Applique une règle Binary Authorization sur le cluster GKE, exigeant que les images de conteneur portent une attestation valide avant de pouvoir être déployées. |
| `binauthz_evaluation_mode` | `string` | `"ALWAYS_ALLOW"` | Mode d'application de la règle Binary Authorization. `ALWAYS_ALLOW` autorise n'importe quelle image (à utiliser pendant la configuration initiale). `REQUIRE_ATTESTATION` impose des images signées. `ALWAYS_DENY` bloque tous les déploiements (verrouillage). Utilisée uniquement lorsque `enable_binary_authorization` vaut `true`. |

### Explorer dans GCP — Groupe 12 {#exploring-in-gcp--group-12}

**Console Google Cloud :**
- **Déclencheurs Cloud Build :** accédez à **Cloud Build → Triggers** pour afficher le déclencheur, le dépôt connecté et l'état du dernier build.
- **Historique des builds :** accédez à **Cloud Build → History** pour afficher les builds passés, leur état et leurs journaux.
- **Pipelines Cloud Deploy :** accédez à **Cloud Deploy → Delivery Pipelines** pour afficher les étapes du pipeline, la release actuelle et l'historique des promotions.
- **Règle Binary Authorization :** accédez à **Security → Binary Authorization** pour afficher la règle d'application actuelle.

**CLI gcloud / kubectl :**
```bash
# List Cloud Build triggers
gcloud builds triggers list \
  --project=PROJECT_ID --region=REGION \
  --format="table(name,github.name,github.push.branch,disabled)"

# View recent Cloud Build history
gcloud builds list --project=PROJECT_ID --region=REGION \
  --limit=10 \
  --format="table(id,status,source.repoSource.branchName,createTime)"

# List Cloud Deploy delivery pipelines
gcloud deploy delivery-pipelines list \
  --region=REGION --project=PROJECT_ID \
  --format="table(name,condition.pipelineReadyCondition.status)"

# List Cloud Deploy releases for a pipeline
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --region=REGION --project=PROJECT_ID \
  --format="table(name,buildArtifacts[0].tag,renderState,createTime)"

# View Binary Authorization policy
gcloud container binauthz policy export --project=PROJECT_ID
```

---

## Groupe 13 — Stockage NFS {#group-13--nfs-storage}

Ces variables configurent le stockage partagé Cloud Filestore (NFS) monté dans le pod GKE en tant que volume persistant. NFS fournit un système de fichiers partagé conforme POSIX, accessible simultanément par tous les réplicas de pods.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | `bool` | `true` | Lorsqu'elle vaut `true`, un volume NFS est monté dans le pod GKE à l'emplacement `nfs_mount_path`. Le module découvre automatiquement une instance Filestore ou une VM GCE NFS existante dans le projet, ou provisionne une VM GCE NFS intégrée si aucune n'est trouvée. Indispensable pour les applications qui gèrent des téléversements de fichiers partagés ou des données qui doivent persister au-delà des redémarrages de pods. |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Chemin du système de fichiers, à l'intérieur du conteneur, où le volume NFS est monté. Utilisée uniquement lorsque `enable_nfs` vaut `true`. Les fichiers écrits hors de ce chemin dans le système de fichiers du conteneur sont éphémères et perdus au redémarrage du pod. |
| `nfs_volume_name` | `string` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. À ne modifier que pour monter un second partage NFS avec un nom de volume distinct. |
| `nfs_instance_name` | `string` | `""` | Nom d'une VM GCE NFS existante à laquelle se connecter directement. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou pour provisionner une VM NFS intégrée. |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Nom de base de la VM GCE NFS intégrée créée lorsqu'aucun serveur NFS existant n'est trouvé. L'ID de déploiement est ajouté automatiquement pour garantir l'unicité. |

### Explorer dans GCP — Groupe 13 {#exploring-in-gcp--group-13}

**Console Google Cloud :**
- **Instance NFS (Filestore) :** accédez à **Filestore → Instances** pour confirmer que l'instance existe, ainsi que son niveau, sa capacité et son adresse IP.
- **Instance NFS (VM GCE) :** accédez à **Compute Engine → VM Instances** et filtrez par nom d'instance pour confirmer qu'elle est en cours d'exécution.
- **Montage du volume NFS :** dans le YAML de la charge de travail Kubernetes, recherchez le volume `nfs` et son `mountPath` dans la spécification du conteneur.

**kubectl / CLI gcloud :**
```bash
# Verify NFS volume is mounted in the pod spec
kubectl describe pod POD_NAME -n NAMESPACE | grep -A5 "Mounts:"

# List Filestore instances
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,networks[0].ipAddresses[0],fileShares[0].capacityGb,state)"

# List GCE VM instances (for inline NFS VMs)
gcloud compute instances list --project=PROJECT_ID \
  --filter="name:nfs" \
  --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# Check pod logs for NFS mount errors at startup
kubectl logs POD_NAME -n NAMESPACE --previous | grep -i nfs
```

---

## Groupe 14 — Cloud Storage {#group-14--cloud-storage}

Ces variables configurent les buckets Google Cloud Storage (GCS) et les montages GCS Fuse de l'application.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `true` | Interrupteur principal du provisionnement des buckets GCS. Définissez `false` lorsque les buckets sont gérés en externe ou doivent être partagés entre déploiements. |
| `storage_buckets` | `list(object)` | `[]` | Buckets GCS à provisionner pour l'application. Le nom de chaque bucket est automatiquement préfixé par l'ID du projet et le nom de l'application. Sous-champs par entrée : `name_suffix`, `location`, `storage_class` (`STANDARD`, `NEARLINE`, `COLDLINE`, `ARCHIVE`), `force_destroy`, `versioning_enabled`, `lifecycle_rules`, `public_access_prevention` (`"enforced"` recommandé), `uniform_bucket_level_access`, `cors`. |
| `gcs_volumes` | `list(object)` | `[]` | Buckets GCS à monter comme volumes de système de fichiers à l'intérieur des pods à l'aide du pilote GCS Fuse CSI. Sous-champs : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options` (défaut : `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). Nécessite que le pilote GCS Fuse CSI soit activé sur le cluster (activé par défaut sur GKE Autopilot). |
| `manage_storage_kms_iam` | `bool` | `false` | Lorsqu'elle vaut `true`, crée un trousseau KMS CMEK et une clé de chiffrement du stockage, accorde au compte de service GCS le rôle de chiffreur/déchiffreur et active CMEK sur tous les buckets de stockage. Peut être activée sans risque dès le premier déploiement — la clé est créée automatiquement. |
| `enable_artifact_registry_cmek` | `bool` | `false` | Lorsqu'elle vaut `true`, crée une clé KMS Artifact Registry et active le chiffrement au repos des images de conteneur avec une clé gérée par le client. Peut être activée sans risque dès le premier déploiement. |
| `max_images_to_retain` | `number` | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. Sert de garde-fou de rétention. Définissez `0` pour la désactiver. |
| `delete_untagged_images` | `bool` | `true` | Supprime automatiquement les images de conteneur non taguées (couches orphelines) du dépôt Artifact Registry. Ne concerne que les images associées au nom d'application de ce déploiement. |
| `image_retention_days` | `number` | `30` | Nombre de jours au-delà duquel les images de conteneur deviennent éligibles à la suppression. Les images comprises dans `max_images_to_retain` sont toujours conservées. Définissez `0` pour désactiver la suppression selon l'ancienneté. |

### Explorer dans GCP — Groupe 14 {#exploring-in-gcp--group-14}

**Console Google Cloud :**
- **Buckets GCS :** accédez à **Cloud Storage → Buckets** pour confirmer que les buckets sont créés avec les noms et configurations attendus.
- **Montages GCS Fuse :** dans le YAML de la charge de travail Kubernetes, recherchez les volumes CSI du pilote `gcsfuse.csi.storage.gke.io`.
- **Règles de nettoyage Artifact Registry :** accédez à **Artifact Registry → Repositories → *dépôt* → Cleanup Policies**.

**kubectl / CLI gcloud :**
```bash
# List all GCS buckets in the project
gcloud storage buckets list --project=PROJECT_ID \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"

# Describe a specific bucket (versioning, lifecycle, encryption)
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="yaml(versioning,lifecycle,encryption)"

# Verify GCS Fuse volumes in pod spec
kubectl describe pod POD_NAME -n NAMESPACE | grep -A10 "gcsfuse"

# List objects in a bucket (validate application writes)
gcloud storage ls gs://BUCKET_NAME/ --recursive

# View Artifact Registry cleanup policies
gcloud artifacts repositories describe REPO_NAME \
  --location=REGION --project=PROJECT_ID \
  --format="yaml(cleanupPolicies)"

# List container images to confirm cleanup is working
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags --format="table(image,tags,createTime)"
```

---

## Groupe 15 — Cache Redis {#group-15--redis-cache}

Ces variables configurent la connectivité Redis de l'application en injectant les informations de connexion sous forme de variables d'environnement dans le pod GKE.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | Lorsqu'elle vaut `true`, injecte les variables d'environnement `REDIS_HOST` et `REDIS_PORT` dans le pod GKE. Lorsqu'elle vaut `false`, aucune variable d'environnement Redis n'est injectée. **Définissez explicitement `false` pour les applications qui n'utilisent pas Redis** — la valeur par défaut `true` avec un `redis_host` vide se replie sur l'IP du serveur NFS, ce qui peut journaliser des erreurs de connexion inattendues. |
| `redis_host` | `string` | `""` | Nom d'hôte ou adresse IP du serveur Redis, injecté en tant que `REDIS_HOST`. Laissez vide pour utiliser par défaut l'adresse IP du serveur NFS (adapté aux environnements partagés à VM unique). Définissez-le explicitement pour vous connecter à Google Cloud Memorystore — utilisez l'IP privée de l'instance. |
| `redis_port` | `string` | `"6379"` | Port TCP du serveur Redis, injecté en tant que `REDIS_PORT`. Le port Redis standard est `6379`. |
| `redis_auth` | `string` | `""` | Mot de passe d'authentification du serveur Redis. Stocké dans Secret Manager et injecté de manière sécurisée — jamais stocké en clair. Laissez vide si l'instance Redis ne requiert pas d'authentification. Pour Memorystore avec AUTH activé, définissez-le sur la chaîne d'authentification de l'instance. |

### Explorer dans GCP — Groupe 15 {#exploring-in-gcp--group-15}

**Console Google Cloud :**
- **Instance Memorystore Redis :** accédez à **Memorystore → Redis** pour confirmer que l'instance existe, ainsi que son adresse IP, son port et l'état d'AUTH.
- **Variables d'environnement Redis :** dans la spécification du pod Kubernetes (ou via `kubectl exec`), confirmez la présence de `REDIS_HOST` et `REDIS_PORT`.

**kubectl / CLI gcloud :**
```bash
# Confirm REDIS_HOST and REDIS_PORT are set on a running pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# List Cloud Memorystore Redis instances
gcloud redis instances list --region=REGION --project=PROJECT_ID \
  --format="table(name,host,port,tier,memorySizeGb,state,authEnabled)"

# Describe a specific Memorystore instance (includes IP and AUTH info)
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION --project=PROJECT_ID \
  --format="yaml(host,port,authEnabled,state)"
```

---

## Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

> **Choisir le backend de base de données.** Décidez d'abord *si* vous en avez besoin : `database_type = "NONE"` ignore tout provisionnement de base de données (ainsi que les fonctionnalités qui en dépendent — import de sauvegarde, SQL personnalisé, rotation automatique, volume Cloud SQL — chacune étant rejetée au moment du plan si elle reste activée avec `NONE`). Si vous en avez besoin, choisissez le moteur requis par votre application (`POSTGRES`/`MYSQL`, ou une variante épinglée comme `POSTGRES_15`/`MYSQL_8_0`). **Épinglez la version en production** — `database_type` est de fait immuable : le modifier après le premier déploiement remplace l'instance Cloud SQL et détruit ses données. Avec un socle `Services_GCP`, le module crée uniquement une base de données et un utilisateur dans l'instance partagée (aucun coût d'instance par déploiement) ; en mode autonome, il provisionne une instance dédiée. L'application accède à la base de données via le Cloud SQL Auth Proxy (`enable_cloudsql_volume`) — laissez-le activé pour les connexions par socket. Les interrupteurs propres à chaque famille de moteurs (`enable_postgres_extensions`, `enable_mysql_plugins`) doivent correspondre au moteur (vérifié).

Ces variables configurent le backend de base de données Cloud SQL. Le module prend en charge PostgreSQL, MySQL et SQL Server, et peut provisionner une nouvelle instance, se connecter à une instance existante ou ignorer entièrement le provisionnement de la base de données.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | `string` | `"POSTGRES"` | Moteur de base de données Cloud SQL. `NONE` ignore le provisionnement de la base de données. Les alias génériques (`POSTGRES`, `MYSQL`) déploient la dernière version prise en charge. Les valeurs à version épinglée (par exemple `POSTGRES_17`, `MYSQL_8_4`) sont recommandées en production. **La modifier après le déploiement initial remplace l'instance Cloud SQL et entraîne une perte de données.** |
| `sql_instance_name` | `string` | `""` | Nom d'une instance Cloud SQL existante à utiliser directement. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou pour provisionner une instance intégrée. |
| `sql_instance_base_name` | `string` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée créée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté automatiquement. |
| `application_database_name` | `string` | `"gkeappdb"` | Nom de la base de données créée dans l'instance Cloud SQL. Injecté dans le pod en tant que `DB_NAME`. **Ne le modifiez jamais après le déploiement initial.** |
| `application_database_user` | `string` | `"gkeappuser"` | Nom de l'utilisateur de base de données créé pour l'application. Injecté en tant que `DB_USER`. |
| `database_password_length` | `number` | `32` | Longueur du mot de passe généré aléatoirement pour l'utilisateur de la base de données. Plage valide : 16–64. Des mots de passe plus longs offrent une entropie plus élevée. |
| `db_password_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire exposant le mot de passe de la base de données, en plus du `DB_PASSWORD` standard. Défini par les modules wrapper pour les applications qui attendent un nom non standard (par exemple `WORDPRESS_DB_PASSWORD`). |
| `enable_postgres_extensions` | `bool` | `false` | Active l'installation des extensions PostgreSQL listées dans `postgres_extensions` après le provisionnement de la base de données. Ne s'applique qu'aux types de base de données PostgreSQL. Remarque : utilisée uniquement pour la validation des entrées lors d'un déploiement autonome — les extensions sont injectées depuis la configuration du module applicatif lorsqu'il est appelé depuis un wrapper. |
| `postgres_extensions` | `list(string)` | `[]` | Extensions PostgreSQL à installer. Nécessite `enable_postgres_extensions = true` et un `database_type` PostgreSQL. Valeurs courantes : `postgis`, `uuid-ossp`, `pg_trgm`, `pgcrypto`. |
| `enable_mysql_plugins` | `bool` | `false` | Active l'installation des plugins MySQL. Ne s'applique qu'aux types de base de données MySQL. Remarque : utilisée uniquement pour la validation des entrées lors d'un déploiement autonome. |
| `mysql_plugins` | `list(string)` | `[]` | Plugins MySQL à installer. Nécessite `enable_mysql_plugins = true` et un `database_type` MySQL. Valeurs courantes : `audit_log`, `validate_password`. |
| `enable_auto_password_rotation` | `bool` | `false` | Active la rotation automatique du mot de passe de l'utilisateur de la base de données via un CronJob Kubernetes et un déclencheur Eventarc. La fréquence de rotation est régie par `secret_rotation_period`. Ne s'applique que lorsque `database_type` ne vaut pas `NONE`. |
| `rotation_propagation_delay_sec` | `number` | `90` | Nombre de secondes d'attente après l'écriture d'un nouveau mot de passe de base de données dans Secret Manager avant de redémarrer les pods GKE. Laisse à la réplication mondiale de Secret Manager le temps de se terminer. À augmenter pour les applications à forte concurrence. Utilisée uniquement lorsque `enable_auto_password_rotation` vaut `true`. |
| `db_host_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire exposant l'hôte de la base de données, en plus du `DB_HOST` standard. Défini par les modules wrapper pour les applications qui attendent un nom non standard (par exemple `DB_HOSTNAME`). |
| `db_user_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire exposant l'utilisateur de la base de données, en plus du `DB_USER` standard. (par exemple `DB_USERNAME`) |
| `db_name_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire exposant le nom de la base de données, en plus du `DB_NAME` standard. (par exemple `DB_DATABASE`) |
| `db_port_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire exposant le port de la base de données, en plus du `DB_PORT` standard. (par exemple `DB_PORT_NUMBER`) |

### Explorer dans GCP — Groupe 16 {#exploring-in-gcp--group-16}

**Console Google Cloud :**
- **Instance Cloud SQL :** accédez à **SQL** pour confirmer que l'instance existe, ainsi que sa version de moteur, sa région et son nom de connexion.
- **Bases de données et utilisateurs :** cliquez sur l'instance, puis sélectionnez les onglets **Databases** et **Users**.
- **Identifiants de base de données dans Secret Manager :** accédez à **Security → Secret Manager** et filtrez par nom d'application pour trouver le secret `DB_PASSWORD`.
- **Variables d'environnement de base de données sur les pods :** utilisez `kubectl exec` pour inspecter les variables d'environnement `DB_HOST`, `DB_NAME`, `DB_USER` du pod.

**kubectl / CLI gcloud :**
```bash
# List Cloud SQL instances in the project
gcloud sql instances list --project=PROJECT_ID \
  --format="table(name,databaseVersion,region,settings.tier,state)"

# List databases on a Cloud SQL instance
gcloud sql databases list --instance=INSTANCE_NAME \
  --project=PROJECT_ID --format="table(name,charset)"

# List users on a Cloud SQL instance
gcloud sql users list --instance=INSTANCE_NAME \
  --project=PROJECT_ID --format="table(name,host,type)"

# Verify DB environment variables in a pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep DB_

# List Secret Manager secrets related to the database
gcloud secrets list --project=PROJECT_ID \
  --filter="name:db" --format="table(name,createTime)"
```

---

## Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

Ces variables configurent la planification automatisée des sauvegardes de la base de données et l'import ponctuel d'une sauvegarde.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Expression cron définissant le moment où s'exécute le Job Kubernetes de sauvegarde automatisée de la base de données. Utilise le format cron Unix standard, en UTC. Exemple : `"0 2 * * *"` pour une exécution quotidienne à 02:00 UTC. Ne s'applique que lorsque `database_type` ne vaut pas `NONE`. |
| `backup_retention_days` | `number` | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans le bucket GCS de sauvegarde avant leur suppression automatique. Utilisez 7 pour le développement, 30–90 pour la production selon les exigences de conformité. |
| `enable_backup_import` | `bool` | `false` | Déclenche un Job Kubernetes ponctuel d'import de base de données pendant le déploiement, restaurant le fichier de sauvegarde indiqué par `backup_file`. **Repassez-la à `false` immédiatement après une restauration réussie** — la laisser à `true` écrasera la base de données en service avec la sauvegarde obsolète à chaque déploiement ultérieur. |
| `backup_source` | `string` | `"gcs"` | Source à partir de laquelle le fichier de sauvegarde est récupéré. `gcs` importe depuis le bucket GCS de sauvegarde provisionné par le module ; `gdrive` importe depuis Google Drive. |
| `backup_file` | `string` | `"backup.sql"` | Nom du fichier de sauvegarde à importer. Doit exister dans la source configurée avant le déploiement. Exemple : `"backup-2024-01-15.sql.gz"`. |
| `backup_format` | `string` | `"sql"` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. Utilisez `auto` pour une détection à partir de l'extension du fichier. |

### Explorer dans GCP — Groupe 17 {#exploring-in-gcp--group-17}

**Console Google Cloud :**
- **CronJob de sauvegarde :** accédez à **Kubernetes Engine → Workloads** et filtrez sur les ressources `CronJob` pour trouver le job de sauvegarde et son calendrier.
- **Fichiers de sauvegarde (bucket GCS) :** accédez à **Cloud Storage → Buckets** et recherchez le bucket de sauvegarde. Confirmez que les fichiers de sauvegarde sont bien écrits et que les règles de cycle de vie sont appliquées.
- **Job d'import :** accédez à **Kubernetes Engine → Workloads → Jobs** pour confirmer que le job d'import s'est terminé avec succès après l'activation de `enable_backup_import`.

**kubectl / CLI gcloud :**
```bash
# List CronJobs in the namespace (includes backup job)
kubectl get cronjobs -n NAMESPACE

# View recent backup job runs
kubectl get jobs -n NAMESPACE --selector=app=BACKUP_JOB_NAME \
  --sort-by=.metadata.creationTimestamp

# Check backup job logs
kubectl logs -n NAMESPACE job/BACKUP_JOB_NAME

# List backup files in the GCS backup bucket
gcloud storage ls gs://BACKUP_BUCKET_NAME/ \
  --recursive --format="table(name,size,timeCreated)"

# View the lifecycle rules on the backup bucket
gcloud storage buckets describe gs://BACKUP_BUCKET_NAME \
  --format="yaml(lifecycle)"
```

---

## Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Ces variables permettent d'exécuter des scripts SQL personnalisés sur la base de données de l'application pendant le déploiement.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | `bool` | `false` | Lorsqu'elle vaut `true`, récupère les fichiers de scripts SQL depuis le bucket GCS et le chemin configurés, puis les exécute sur la base de données de l'application dans l'ordre lexicographique. Destinée aux migrations de schéma, à l'installation de procédures stockées ou au chargement de données initiales que le framework de migration de l'application ne peut pas gérer. Concevez des scripts idempotents (pouvant être exécutés plusieurs fois sans risque). |
| `custom_sql_scripts_bucket` | `string` | `""` | Nom du bucket GCS contenant les scripts SQL. Le compte de service de la charge de travail GKE doit disposer d'un accès en lecture à ce bucket. Obligatoire lorsque `enable_custom_sql_scripts` vaut `true`. |
| `custom_sql_scripts_path` | `string` | `""` | Préfixe de chemin, dans le bucket GCS, à partir duquel les scripts SQL sont récupérés. Tous les fichiers `.sql` situés sous ce préfixe sont exécutés dans l'ordre lexicographique. Utilisez une convention de nommage comme `001_create_tables.sql` pour contrôler l'ordre d'exécution. |
| `custom_sql_scripts_use_root` | `bool` | `false` | Exécute les scripts SQL personnalisés en tant qu'utilisateur root de la base de données plutôt qu'en tant qu'utilisateur de l'application. À n'activer que lorsque les scripts nécessitent des privilèges élevés (par exemple `CREATE EXTENSION`, `CREATE ROLE`). |

### Explorer dans GCP — Groupe 18 {#exploring-in-gcp--group-18}

**Console Google Cloud :**
- **Job des scripts SQL :** accédez à **Kubernetes Engine → Workloads → Jobs** pour trouver le job des scripts SQL et afficher son historique d'exécution.
- **Fichiers de scripts dans GCS :** accédez à **Cloud Storage → Buckets → *bucket des scripts*** pour confirmer que des fichiers `.sql` existent sous le préfixe de chemin configuré.

**kubectl / CLI gcloud :**
```bash
# Check SQL scripts job completion
kubectl get job SQL_SCRIPTS_JOB_NAME -n NAMESPACE

# View SQL scripts job logs
kubectl logs -n NAMESPACE job/SQL_SCRIPTS_JOB_NAME

# Confirm script files exist in the GCS bucket
gcloud storage ls gs://BUCKET_NAME/SCRIPTS_PATH --recursive

# Check the GKE workload SA has access to the scripts bucket
gcloud storage buckets get-iam-policy gs://BUCKET_NAME \
  --format="table(bindings.role,bindings.members)"
```

---

> **Choisir le mode d'exposition de la charge de travail.** Le chemin d'exposition est la décision clé et s'étend sur les groupes 19 à 21. Un `service_type` `ClusterIP`/`LoadBalancer` simple vous donne une IP brute ; un **domaine personnalisé** (groupe 19) provisionne un certificat géré par Google via la Gateway/l'Ingress et nécessite un enregistrement DNS après le déploiement. **Cloud Armor (groupe 21)** — la couche WAF/DDoS — exige soit un domaine personnalisé, soit un service `LoadBalancer` (vérifié au moment du plan), car il a besoin d'un point d'entrée externe auquel associer la règle, et **`enable_cdn` n'exige *pas* de domaine personnalisé** — la Gateway se replie sur un certificat HTTPS `<ip>.nip.io` dérivé. Pour les outils uniquement internes, privilégiez **IAP (groupe 20)** — mais IAP sur GKE nécessite un ID client et un secret OAuth ainsi qu'un e-mail de support (tous vérifiés) ; configurez-les donc avant de l'activer. Choisissez d'abord le modèle d'exposition, puis la couche de sécurité qui lui correspond.

## Groupe 19 — Accès et réseau {#group-19--access--networking}

Ces variables déterminent la configuration des domaines personnalisés, la réservation d'IP statique, les tags réseau et la sélection du réseau VPC.

> **Nom d'hôte `nip.io` par défaut.** Avec le `service_type` `LoadBalancer` par défaut et `reserve_static_ip = true`, le déploiement dérive un nom d'hôte `<reserved-ip>.nip.io` par défaut (nip.io est un DNS générique qui résout `<ip>.nip.io` → cette IP). Chaque déploiement GKE par défaut dispose ainsi d'emblée d'un nom d'hôte fonctionnel — utilisé comme hôte du test de disponibilité Cloud Monitoring et comme URL pratique pour le navigateur — sans aucune configuration DNS. Fournissez `application_domains` (avec `enable_custom_domain = true` pour le SSL de la Gateway) pour utiliser plutôt votre propre domaine ; le test de disponibilité sonde alors ce domaine.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_domain` | `bool` | `false` | Provisionne une ressource Ingress de l'API Gateway Kubernetes pour acheminer le trafic à l'aide des noms d'hôte personnalisés indiqués dans `application_domains`. Obligatoire pour la terminaison SSL des domaines personnalisés via Certificate Manager. |
| `application_domains` | `list(string)` | `[]` | Noms de domaine personnalisés à associer à la Gateway de l'application. Le DNS doit être configuré pour faire pointer chaque domaine vers l'IP de l'équilibreur de charge après le déploiement. Utilisée uniquement lorsque `enable_custom_domain` vaut `true`. |
| `reserve_static_ip` | `bool` | `true` | Provisionne une adresse IP externe statique pour l'équilibreur de charge. Fortement recommandé en production — garantit une IP stable vers laquelle les enregistrements DNS peuvent pointer de manière fiable. Lorsqu'elle vaut `false`, l'équilibreur de charge reçoit une IP éphémère susceptible de changer lors d'un redéploiement. |
| `static_ip_name` | `string` | `""` | Nom personnalisé de la ressource d'adresse IP statique. Laissez vide pour le générer automatiquement. |
| `network_name` | `string` | `""` | Nom du réseau VPC à utiliser pour ce déploiement. Laissez vide pour découvrir automatiquement un réseau unique géré par Services GCP. Obligatoire lorsque plusieurs réseaux gérés par Services GCP existent dans le projet. |
| `network_tags` | `list(string)` | `["nfsserver"]` | Tags réseau appliqués aux nœuds et aux pods GKE. Utilisés pour cibler les règles de pare-feu VPC. Le tag `nfsserver` par défaut est requis pour la connectivité NFS lorsque `enable_nfs` vaut `true`. |

### Explorer dans GCP — Groupe 19 {#exploring-in-gcp--group-19}

**Console Google Cloud :**
- **Gateway et Ingress :** accédez à **Kubernetes Engine → Services & Ingress → Gateways, Ingresses & Routes** pour afficher la ressource Gateway et ses HTTPRoutes.
- **IP statique :** accédez à **VPC Network → IP addresses** pour confirmer que l'IP statique est réservée et connaître son adresse.
- **Certificats SSL :** accédez à **Certificate Manager → Certificates** pour afficher les certificats SSL gérés et leur état de provisionnement.
- **Configuration DNS :** utilisez votre registraire de domaine ou Cloud DNS pour vérifier que les enregistrements `A` pointent vers l'IP de l'équilibreur de charge.

**kubectl / CLI gcloud :**
```bash
# View the Gateway resource
kubectl get gateway -n NAMESPACE

# Describe the Gateway to see IP address and routes
kubectl describe gateway APPLICATION_NAME-gateway -n NAMESPACE

# Check certificate provisioning status
gcloud certificate-manager certificates list --project=PROJECT_ID \
  --format="table(name,managed.domains,managed.state)"

# View reserved static IP addresses
gcloud compute addresses list --project=PROJECT_ID \
  --format="table(name,address,addressType,status,region)"

# Verify DNS resolution to the load balancer IP
dig +short DOMAIN_NAME
```

---

## Groupe 20 — Identity-Aware Proxy {#group-20--identity-aware-proxy}

Ces variables configurent Identity-Aware Proxy (IAP) devant l'application à l'aide du `GCPBackendPolicy` de l'API GKE Gateway. IAP exige une authentification par identité Google avant que les utilisateurs puissent accéder à l'application — aucune modification du code de l'application n'est nécessaire.

> **Remarque :** IAP sur GKE nécessite des identifiants OAuth 2.0 créés au préalable. Contrairement à Cloud Run, ils ne peuvent pas être générés automatiquement par le module. `iap_oauth_client_id` et `iap_oauth_client_secret` doivent tous deux être créés manuellement dans **APIs & Services → Credentials** avant d'activer IAP.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | `bool` | `false` | Active Identity-Aware Proxy pour l'application via un `GCPBackendPolicy` sur la Gateway. Si vous la définissez sur `true`, configurez `iap_authorized_users` et `iap_authorized_groups` avant l'activation — une liste d'autorisation vide signifie que 100 % des requêtes renvoient une erreur HTTP 403. |
| `iap_authorized_users` | `list(string)` | `[]` | Utilisateurs individuels ou comptes de service autorisés à accéder via IAP. Format : `"user:email@example.com"` ou `"serviceAccount:sa@project.iam.gserviceaccount.com"`. Active uniquement lorsque `enable_iap` vaut `true`. |
| `iap_authorized_groups` | `list(string)` | `[]` | Groupes Google autorisés à accéder via IAP. Format : `"group:name@example.com"`. À privilégier par rapport aux utilisateurs individuels pour gérer l'accès au niveau des équipes. Active uniquement lorsque `enable_iap` vaut `true`. |
| `iap_oauth_client_id` | `string` | `""` | ID client OAuth 2.0 du service backend IAP. Doit être créé au préalable dans la console GCP. Obligatoire lorsque `enable_iap` vaut `true`. |
| `iap_oauth_client_secret` | `string` | `""` | Secret client OAuth 2.0 correspondant à `iap_oauth_client_id`. Obligatoire lorsque `enable_iap` vaut `true`. Traité comme sensible. |
| `iap_support_email` | `string` | `""` | Adresse e-mail de support affichée sur l'écran de consentement OAuth. Obligatoire lorsque `enable_iap` vaut `true`. Doit être une adresse e-mail ou une adresse de groupe Google valide. |

### Explorer dans GCP — Groupe 20 {#exploring-in-gcp--group-20}

**Console Google Cloud :**
- **État d'IAP :** accédez à **Security → Identity-Aware Proxy** pour confirmer que le backend est listé avec IAP activé.
- **Membres autorisés :** cliquez sur l'entrée du backend et consultez l'onglet **Principals** pour vérifier que les utilisateurs et groupes attendus disposent de l'accès `IAP-secured Web App User`.
- **GCPBackendPolicy :** accédez à **Kubernetes Engine → Workloads** et recherchez la ressource `GCPBackendPolicy` dans l'espace de noms.

**kubectl / CLI gcloud :**
```bash
# View the GCPBackendPolicy to confirm IAP configuration
kubectl get gcpbackendpolicy -n NAMESPACE -o yaml

# Check IAM bindings for IAP on the backend service
gcloud compute backend-services list --project=PROJECT_ID \
  --format="table(name,iap.enabled,iap.oauth2ClientId)"

# List IAP-enabled resources
gcloud iap web get-iam-policy \
  --resource-type=backend-services \
  --service=BACKEND_SERVICE_NAME \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

Ces variables configurent une règle de sécurité WAF Cloud Armor associée au backend de la GKE Gateway, ainsi que Cloud CDN, facultatif, via l'équilibreur de charge de l'API Gateway.

> **Remarque :** sur GKE, seul **Cloud CDN** est mutuellement exclusif avec IAP sur un même backend de Gateway (`iap.tf` exige `enable_cdn = false`). Ce n'est *pas* le cas de Cloud Armor — c'est même la méthode recommandée pour satisfaire l'exigence d'IAP d'une Gateway HTTPS sans posséder de domaine, car il active la Gateway et obtient un certificat `nip.io` sans aucune configuration.

> **Remarque sur le CDN :** le CRD `GCPBackendPolicy` n'expose aucun champ de configuration du CDN. Après un déploiement avec `enable_cdn = true`, Cloud CDN doit être activé sur le service backend en dehors du module, via `gcloud compute backend-services update --enable-cdn` ou en associant un `GCPHTTPFilter` sur les versions de GKE compatibles.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | `bool` | `false` | Associe une règle de sécurité Cloud Armor au backend de la GKE Gateway, activant les règles WAF, la protection DDoS et les contrôles d'accès basés sur l'IP. Nécessite `enable_custom_domain = true` ou `service_type = "LoadBalancer"`. |
| `admin_ip_ranges` | `list(string)` | `[]` | Plages d'adresses IP CIDR exemptées des règles WAF de Cloud Armor. Généralement utilisées pour des réseaux d'exploitation de confiance ou des systèmes CI/CD. Effective uniquement lorsque `enable_cloud_armor` vaut `true`. Également utilisée comme niveau d'accès administrateur dans les périmètres VPC-SC — une liste vide entraîne l'omission du provisionnement VPC-SC, avec un avertissement. |
| `cloud_armor_policy_name` | `string` | `"default-waf-policy"` | Nom de la règle de sécurité Cloud Armor à associer. À remplacer pour référencer une règle personnalisée. La règle intégrée comprend des règles contre les injections SQL (SQLi), XSS, LFI, RCE, ainsi qu'une limitation de débit (500 req/min par IP). |
| `enable_cdn` | `bool` | `false` | Fait passer l'application par l'équilibreur de charge de l'API Gateway en vue de Cloud CDN. Un domaine personnalisé n'est **pas** requis — la validation qui en exigeait un autrefois a été assouplie (commentaire 20 de `validation.tf`), car la Gateway provisionne HTTPS d'emblée via un certificat `<ip>.nip.io` dérivé. Voir la remarque ci-dessus concernant l'activation du CDN en dehors du module. |

### Explorer dans GCP — Groupe 21 {#exploring-in-gcp--group-21}

**Console Google Cloud :**
- **Règle Cloud Armor :** accédez à **Network security → Cloud Armor policies** pour afficher la règle, ses règles et les services backend associés.
- **Backend de l'équilibreur de charge :** accédez à **Network services → Load balancing** pour confirmer que la règle Cloud Armor est associée au backend.
- **État du CDN :** dans les détails du backend de l'équilibreur de charge, confirmez que Cloud CDN apparaît comme activé.

**CLI gcloud :**
```bash
# List Cloud Armor security policies
gcloud compute security-policies list --project=PROJECT_ID \
  --format="table(name,description)"

# Describe a Cloud Armor policy and view its rules
gcloud compute security-policies describe POLICY_NAME \
  --project=PROJECT_ID --format="yaml(rules)"

# Check if Cloud CDN is enabled on a backend service
gcloud compute backend-services describe BACKEND_SERVICE_NAME \
  --global --format="yaml(enableCDN,securityPolicy)"

# Enable Cloud CDN on a backend service (out-of-band activation)
# gcloud compute backend-services update BACKEND_SERVICE_NAME \
#   --global --enable-cdn
```

---

## Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Ces variables déterminent l'application du périmètre VPC Service Controls (VPC-SC) et la journalisation d'audit au niveau du projet.

> **Remarque :** déployez d'abord VPC-SC en mode simulation (dry-run) (`vpc_sc_dry_run = true`, la valeur par défaut). Examinez les journaux de violations du mode simulation avant de passer à l'application stricte. VPC-SC nécessite une organisation GCP — les projets autonomes n'ont pas d'organisation, et le périmètre est alors ignoré silencieusement, avec un avertissement.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | `bool` | `false` | Lorsqu'elle vaut `true`, provisionne un périmètre VPC-SC autour des API GCP utilisées par ce module. Limite l'accès aux API à l'intérieur du VPC et aux identités approuvées, empêchant l'exfiltration de données. Est ignorée automatiquement, avec un avertissement, pour les projets autonomes, les projets imbriqués dans un dossier sans `organization_id` et les déploiements dont `admin_ip_ranges` est vide. |
| `vpc_cidr_ranges` | `list(string)` | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. Lorsqu'elle est vide, les sous-réseaux sont découverts automatiquement à partir du réseau VPC. |
| `vpc_sc_dry_run` | `bool` | `true` | Lorsqu'elle vaut `true`, les violations VPC-SC sont journalisées mais pas bloquées. Ne la définissez sur `false` qu'après avoir vérifié que les journaux du mode simulation ne contiennent aucun refus involontaire. |
| `organization_id` | `string` | `""` | ID de l'organisation GCP pour la règle Access Context Manager de VPC-SC. Découvert automatiquement à partir du projet lorsqu'il est vide. Doit être défini explicitement lorsque le projet est imbriqué dans un dossier. |
| `enable_audit_logging` | `bool` | `false` | Active les journaux d'audit Cloud détaillés (`DATA_READ`, `DATA_WRITE`, `ADMIN_READ`) pour tous les services GCP du projet, avec des remplacements par service pour Secret Manager et Cloud KMS. Recommandé pour les environnements soumis à des exigences de conformité (PCI-DSS, HIPAA, SOC 2). Augmente les coûts de Cloud Logging. |

### Explorer dans GCP — Groupe 22 {#exploring-in-gcp--group-22}

**Console Google Cloud :**
- **Périmètre VPC-SC :** accédez à **Security → VPC Service Controls** pour confirmer que le périmètre existe et consulter sa liste de services restreints.
- **Violations en mode simulation :** accédez à **Logging → Logs Explorer** et filtrez sur `VpcServiceControlAuditMetadata` pour identifier les appels d'API refusés.
- **Journalisation d'audit :** accédez à **IAM & Admin → Audit Logs** pour confirmer que `Admin Read`, `Data Read` et `Data Write` sont activés.

**CLI gcloud :**
```bash
# List VPC-SC access policies in the organization
gcloud access-context-manager policies list \
  --organization=ORGANIZATION_ID

# List VPC-SC perimeters under the access policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"

# Check VPC-SC dry-run violation logs
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=PROJECT_ID --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName,protoPayload.metadata.dryRun)"

# Confirm project-level audit config
gcloud projects get-iam-policy PROJECT_ID \
  --format="yaml(auditConfigs)"
```

---

## Prérequis du déploiement et analyse des dépendances {#deployment-prerequisites--dependency-analysis}

Cette section récapitule toutes les dépendances externes nécessaires au déploiement de `App GKE`. Les dépendances sont regroupées par mode de défaillance.

> **Notation :** *Auto-provisionné* signifie que le module crée la ressource automatiquement lors du premier déploiement — aucun prérequis manuel n'est nécessaire.

---

### Niveau 1 — Prérequis bloquants {#tier-1--hard-prerequisites}

Ces configurations empêcheront le déploiement de réussir, ou empêcheront la charge de travail GKE d'atteindre un état sain, si le prérequis indiqué n'est pas satisfait.

| Fonctionnalité | Variable(s) | Exigence |
|---|---|---|
| **Références Secret Manager** | `secret_environment_variables` | Chaque secret nommé dans la carte doit exister dans Secret Manager avant le déploiement. Créez d'abord le secret, puis déployez. |
| **Scripts SQL personnalisés** | `enable_custom_sql_scripts = true` | Le bucket GCS indiqué dans `custom_sql_scripts_bucket` doit exister et tous les fichiers `.sql` doivent être téléversés dans `custom_sql_scripts_path` avant le déploiement. |
| **Import de sauvegarde de base de données** | `enable_backup_import = true` | Le fichier de sauvegarde nommé dans `backup_file` doit exister dans la source configurée (bucket GCS de sauvegarde ou Google Drive) avant le déploiement. Un fichier manquant fait échouer immédiatement le Job Kubernetes d'import. |
| **Pipeline CI/CD** | `enable_cicd_trigger = true` | Un dépôt GitHub doit être accessible, et un Personal Access Token GitHub (scopes : `repo`, `admin:repo_hook`) ou un ID d'installation de GitHub App doit être fourni. |
| **Build de conteneur personnalisé** | `container_image_source = "custom"` | Nécessite la même connexion au dépôt GitHub et les mêmes identifiants que `enable_cicd_trigger`. Cloud Build échoue si le dépôt est injoignable. |
| **IAP** | `enable_iap = true` | ID client et secret OAuth 2.0 créés au préalable depuis **APIs & Services → Credentials**. Contrairement à Cloud Run, ils ne peuvent pas être générés automatiquement. Un écran de consentement OAuth doit exister avant que le GCPBackendPolicy puisse être créé. |
| **VPC Service Controls (projets imbriqués dans un dossier)** | `enable_vpc_sc = true` + projet imbriqué dans un dossier | `organization_id` doit être fourni explicitement pour les projets imbriqués dans un dossier — la découverte automatique est désactivée. Sans lui, le périmètre est ignoré, avec un avertissement. |
| **VPC Service Controls (protection contre le verrouillage des administrateurs)** | `enable_vpc_sc = true` | `admin_ip_ranges` doit contenir au moins une plage CIDR. Une liste vide entraîne l'omission du périmètre, afin d'éviter de verrouiller l'accès des administrateurs. |
| **GKE intégré — second apply requis** | Provisionnement d'un cluster GKE intégré | Lors du premier déploiement d'un cluster GKE intégré, la sortie `kubernetes_ready` vaut `false` — le cluster est créé mais son point de terminaison n'est pas encore lisible, si bien que toutes les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit détecter cette valeur et lancer un second déploiement pour achever le déploiement de l'application. |

---

### Niveau 2 — Défaillances silencieuses {#tier-2--silent-failures}

Ces configurations se déploient avec succès mais ne fonctionneront pas correctement à l'exécution.

| Fonctionnalité | Variable(s) | Mode de défaillance | Résolution |
|---|---|---|---|
| **Cache Redis** | `enable_redis = true` + `redis_host` explicite | `REDIS_HOST` et `REDIS_PORT` sont injectées dans le pod, mais l'application ne peut pas se connecter si aucun service Redis n'existe à l'adresse indiquée. Le déploiement réussit sans erreur. | Provisionnez une instance Cloud Memorystore ou déployez Services GCP, qui fournit une instance partagée découverte automatiquement lorsque `redis_host` est vide. |
| **Rotation des secrets** | `secret_rotation_period` | La notification de rotation Pub/Sub est émise à l'intervalle configuré, mais **aucune valeur de secret n'est réellement renouvelée**. La notification n'est qu'un déclencheur — un gestionnaire doit être implémenté séparément. | Utilisez `enable_auto_password_rotation = true` pour le mot de passe de la base de données (géré automatiquement), ou implémentez une Cloud Function ou un CronJob Kubernetes distinct pour renouveler les autres secrets. |
| **Service mesh** | `configure_service_mesh = true` (cluster externe) | Le libellé d'espace de noms `istio-injection: enabled` est appliqué, mais aucun plan de contrôle Istio ne le prend en charge si ASM ne s'exécute pas sur le cluster. Les pods démarrent, mais les conteneurs sidecar restent à l'état `ContainerCreating`. | Confirmez que Cloud Service Mesh ou Anthos Service Mesh est installé et opérationnel sur le cluster cible avant l'activation. |

---

### Niveau 3 — Prérequis non bloquants {#tier-3--soft-prerequisites}

Ces fonctionnalités se déploient avec succès mais nécessitent une étape manuelle avant d'être pleinement opérationnelles.

| Fonctionnalité | Variable(s) | Action requise |
|---|---|---|
| **Domaine personnalisé** | `application_domains` (avec `enable_custom_domain = true`) | Après le déploiement, créez des **enregistrements DNS A** pour chaque domaine, pointant vers l'IP externe de l'équilibreur de charge (indiquée dans les sorties du déploiement). Le provisionnement du certificat SSL géré par Google commence automatiquement après la propagation DNS et se termine généralement en 10 à 60 minutes. |
| **Cloud CDN** | `enable_cdn = true` | Après le déploiement, activez Cloud CDN sur le service backend de la Gateway en dehors du module : `gcloud compute backend-services update BACKEND_NAME --global --enable-cdn`. Le module ne peut pas activer lui-même le CDN en raison d'une limitation du CRD `GCPBackendPolicy`. |
| **Préparation du fichier de sauvegarde** | `enable_backup_import = true` | Le fichier de sauvegarde doit être téléversé dans le bucket GCS de sauvegarde (ou dans Google Drive) avant le déploiement qui active cet indicateur. |

---

### Auparavant manuel — désormais auto-provisionné {#previously-manual--now-self-provisioned}

| Fonctionnalité | Variable(s) | Prise en charge actuelle |
|---|---|---|
| **Attestateur, règle et clé KMS Binary Authorization** | `enable_binary_authorization = true` | `App_Common/modules/app_security` crée de manière idempotente le trousseau de signature KMS, la clé `binauthz-signer`, la note `pipeline-attestor`, l'attestateur et la règle Binary Authorization. Si Services GCP a provisionné ces ressources en premier, les scripts les détectent et les réutilisent. |
| **Trousseau CMEK pour le chiffrement du stockage** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` crée de manière idempotente le trousseau `${project_id}-cmek-keyring` et la CryptoKey `storage-key` avant l'application de la liaison IAM du stockage. Peut être activé sans risque dès le premier déploiement. |
| **Périmètre VPC Service Controls** | `enable_vpc_sc = true` | `App_Common/modules/app_vpc_sc` découvre automatiquement l'ID de l'organisation, réutilise toute règle Access Context Manager existante, provisionne quatre niveaux d'accès par déploiement (VPC, IP d'administration, IAP, CI/CD) et crée un périmètre de service `PERIMETER_TYPE_REGULAR`. Utilise par défaut `vpc_sc_dry_run = true`. |

---

### Dépendance à Services GCP pour les ressources partagées {#dependency-on-services-gcp-for-shared-resources}

Services GCP est déclaré comme dépendance du module, mais n'est **pas obligatoire** pour un déploiement autonome. Le module provisionne lui-même, en mode intégré, toute l'infrastructure nécessaire lorsque Services GCP n'a pas été déployé. Il est toutefois fortement recommandé de déployer Services GCP en premier lorsque plusieurs modules applicatifs partagent le même projet GCP.

| Ressource | Sans Services GCP | Avec Services GCP |
|---|---|---|
| **Réseau VPC** | Le module provisionne automatiquement un VPC intégré, un sous-réseau, Cloud NAT et Cloud Router. | Le module se rattache au VPC partagé géré de manière centralisée. Simplifie la gestion du pare-feu et évite de consommer le quota de VPC du projet. |
| **Cluster GKE** | Le module provisionne automatiquement un cluster GKE Autopilot intégré à l'aide de `prereq_gke_subnet_cidr`. Une seconde exécution du déploiement est nécessaire pour déployer les ressources de l'application une fois le cluster prêt. | Le module découvre automatiquement et cible le cluster GKE partagé. Aucune création de cluster ni seconde exécution n'est nécessaire. |
| **Instance Cloud SQL** | Le module provisionne automatiquement une instance Cloud SQL dédiée par déploiement. Chaque déploiement supporte le coût complet d'une instance. | Le module découvre automatiquement l'instance Cloud SQL partagée et s'y connecte, en ne provisionnant qu'une base de données et un utilisateur distincts à l'intérieur. Supprime le coût d'instance par déploiement. |
| **NFS / Filestore** | Le module provisionne automatiquement une VM GCE NFS intégrée. Point de défaillance unique, sans sauvegardes gérées. | Le module découvre automatiquement l'instance Filestore gérée de manière centralisée. NFS de niveau entreprise, avec débit garanti et instantanés gérés. |
| **Redis / Memorystore** | `enable_redis = true` avec un `redis_host` vide se replie sur l'IP de la VM NFS. Nécessite un service compatible Redis en cours d'exécution sur cette VM. | Le module découvre automatiquement l'instance Memorystore partagée. `redis_host` peut rester vide. |
| **Artifact Registry** | Le module crée automatiquement un dépôt Artifact Registry par déploiement. | Le module découvre automatiquement et utilise le registre partagé, ce qui permet la réutilisation des images et une analyse des vulnérabilités cohérente entre les déploiements. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale ou faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

> **De nombreuses combinaisons invalides sont détectées au moment du plan.** Le module comporte 34 préconditions croisées entre variables dans `validation.tf`, ainsi que des blocs `validation` par variable et 3 préconditions supplémentaires situées à côté des ressources qu'elles protègent (`deployment.tf`, `iap.tf`, `prerequisites.tf`). Une large catégorie d'erreurs de configuration fait donc échouer le **plan** avec une erreur claire et nommée avant la création de la moindre ressource. Les lignes ci-dessous marquées **🛡 au moment du plan** sont rejetées d'emblée — vous n'atteignez jamais la conséquence. Les lignes non marquées sont des risques *d'exécution* ou *opérationnels* (un mauvais port, une modification de CIDR, un renommage destructeur) que le module ne peut pas trancher à votre place. Un plan sans erreur confirme que les règles portant sur les valeurs et les combinaisons sont respectées ; il ne valide pas qu'un port correspond à votre application ni qu'un renommage est intentionnel.

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `container_image_source` + `container_image` | `"custom"` (build depuis les sources), ou `"prebuilt"` **avec** un `container_image` non vide | **Élevé** 🛡 au moment du plan | `"prebuilt"` avec un `container_image` vide n'a aucun URI d'image à déployer — désormais rejeté au moment du plan. |
| `mount_nfs` (jobs) + `enable_nfs` | Activez NFS dès qu'un job le monte | **Élevé** 🛡 au moment du plan | Un job avec `mount_nfs = true` alors que `enable_nfs = false` (et sans serveur NFS détectable) référence un volume qui n'existe pas — désormais rejeté au moment du plan. |
| `enable_postgres_extensions` / `enable_mysql_plugins` + `database_type` | Faites correspondre l'interrupteur à la famille de moteurs | **Moyen** 🛡 au moment du plan | L'activation d'extensions Postgres sur un moteur MySQL (ou l'inverse) est rejetée au moment du plan. *(Défaut corrigé : la liste d'autorisation MySQL inclut désormais correctement `MYSQL_8_0`, auparavant rejeté par erreur.)* |
| `redis_port` | `"6379"` | **Faible** 🛡 au moment du plan | Un port non numérique ou hors plage est rejeté au moment du plan au lieu de produire un `REDIS_PORT` injoignable. |
| `application_name` | Court, en minuscules, compatible avec les tirets (par exemple `"myapp"`, `"payments-api"`) | **Critique** | Intégré au nom de chaque ressource GCP et Kubernetes (espace de noms, services, secrets, instance SQL, buckets GCS). **Ne le modifiez jamais après le premier déploiement** — toutes les ressources nommées sont détruites puis recréées, ce qui entraîne une perte totale des données et une nouvelle base de données vide. |
| `tenant_id` | Selon l'environnement : `"prod"`, `"staging"`, `"dev"` | **Critique** | Intégré à tous les noms de ressources, avec `application_name`. **Ne le modifiez jamais après le premier déploiement** — même conséquence qu'une modification de `application_name` : recréation complète des ressources, perte de données et nouveau déploiement vide s'exécutant à côté de l'ancien, devenu orphelin. |
| `quota_memory_requests` / `quota_memory_limits` | Suffixe d'unité binaire obligatoire : `"4Gi"`, `"8192Mi"` — jamais un entier nu | **Critique** | Un entier nu comme `"4"` est interprété par Kubernetes comme **4 octets**. Le ResourceQuota est créé, mais chaque pod est rejeté lors de la planification avec `exceeded quota: requests.memory`. L'espace de noms est de fait inutilisable jusqu'à la correction du quota. |
| `stateful_pvc_enabled` + `workload_type` | `stateful_pvc_enabled = true` se résout automatiquement en `StatefulSet` — ne définissez pas aussi `workload_type = "Deployment"` | **Critique** | `stateful_pvc_enabled = true` avec `workload_type = "Deployment"` échoue à la validation au moment du plan. Terraform refuse d'appliquer. |
| `container_port` | Doit correspondre exactement au port auquel le serveur applicatif se lie (par exemple `8080`, `3000`, `5000`) | **Critique** | Ports incohérents : les sondes de liveness et de readiness Kubernetes échouent sur chaque pod. Tous les pods entrent dans une boucle de redémarrage `CrashLoopBackOff`. Le Deployment n'atteint jamais l'état `Ready`. Le service est hors ligne. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` — **épinglez-la sur la valeur appliquée et ne la modifiez jamais** | **Critique** | Une modification après la création du cluster GKE intégré détruit et recrée le sous-réseau, ce qui force le remplacement du cluster GKE. Toutes les charges de travail du cluster sont perdues. Les CIDR doivent être uniques pour l'ensemble des déploiements GKE du projet — des CIDR qui se chevauchent provoquent des échecs d'appairage VPC. |
| `prereq_subnet_cidr_override` | `""` au départ ; **épinglez-la sur la valeur CIDR de sortie du premier déploiement** pour tous les déploiements suivants | **Critique** | Laissée vide lors des déploiements suivants alors que le sous-réseau du VPC intégré existe déjà : Terraform peut attribuer automatiquement un nouveau CIDR, déclenchant un remplacement du sous-réseau qui force la recréation du cluster GKE et une perte totale des données. |
| `enable_iap` + `iap_oauth_client_id` / `iap_oauth_client_secret` | Les deux identifiants OAuth doivent être créés au préalable avant d'activer IAP | **Critique** | `enable_iap = true` sans `iap_oauth_client_id` ni `iap_oauth_client_secret` valides : le déploiement du `GCPBackendPolicy` échoue. Aucun trafic n'est acheminé. IAP sur GKE nécessite des identifiants OAuth créés au préalable — contrairement à IAP sur Cloud Run, ils ne peuvent pas être générés automatiquement. |
| `enable_iap` + `iap_authorized_users` / `iap_authorized_groups` | Renseignez toujours au moins un utilisateur ou un groupe avant d'activer IAP | **Critique** | `enable_iap = true` avec des listes d'utilisateurs et de groupes vides : **100 % des requêtes renvoient une erreur HTTP 403**. Le service est déployé et joignable, mais aucune identité n'y a accès. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` jusqu'à ce que le pipeline CI produise des attestations valides ; ensuite `"REQUIRE_ATTESTATION"` | **Critique** | `"REQUIRE_ATTESTATION"` avant l'existence d'attestations : **tous les déploiements de pods sont bloqués**, avec `Image is not attested` dans les événements des pods. Les retours arrière d'urgence sont également bloqués. `"ALWAYS_DENY"` bloque tous les déploiements, y compris les correctifs urgents. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | Activez toujours d'abord avec `vpc_sc_dry_run = true` ; examinez les journaux d'audit avant l'application stricte | **Critique** | `vpc_sc_dry_run = false` dès la première activation, sans validation : les récupérations d'images depuis Artifact Registry par les nœuds GKE, les appels du Cloud SQL Auth Proxy et les lectures dans Secret Manager peuvent tous échouer simultanément. |
| Étape prod de `cloud_deploy_stages` | `require_approval = true` sur l'étape de production | **Critique** | `require_approval = false` avec `auto_promote = true` sur la prod : un déploiement réussi en staging est automatiquement promu en production sans revue humaine. Une migration défectueuse ou une mauvaise image atteint automatiquement la production. |
| `enable_backup_import` | `false` (par défaut) — ne la définissez sur `true` que pour le seul déploiement où vous souhaitez effectuer une restauration | **Critique** | Laisser `enable_backup_import = true` après une restauration réussie : le Job Kubernetes d'import s'exécute à nouveau à chaque déploiement, écrasant la base de données en service avec le fichier de sauvegarde obsolète. **Repassez-la à `false` immédiatement après une restauration réussie.** |
| `session_affinity` | `"ClientIP"` pour les applications avec état nécessitant des sessions persistantes | **Élevé** | `"None"` pour une application avec état : les requêtes sont réparties aléatoirement entre les pods, ce qui entraîne des pertes de session — les utilisateurs sont déconnectés ou voient leurs parcours en plusieurs étapes interrompus. |
| `enable_pod_disruption_budget` | `true` — à toujours laisser activé en production | **Élevé** | `false` : lors des mises à niveau des nœuds GKE Autopilot, tous les pods peuvent être évincés simultanément. Avec `min_instance_count = 1`, l'unique pod est évincé et l'application est totalement indisponible pendant la mise à niveau. |
| `pdb_min_available` | `"1"` pour plusieurs réplicas ; `"0"` pour les charges de travail à réplica unique | **Élevé** | `"1"` avec un déploiement à réplica unique : GKE ne peut pas vider le nœud pour les mises à niveau — le budget ne peut jamais être satisfait avec un seul pod. Les mises à niveau des nœuds sont bloquées en permanence et le cluster prend du retard sur les correctifs de sécurité. |
| `max_instance_count` | À dimensionner à `≤ Cloud SQL max_connections / connections_per_pod` | **Élevé** | Trop élevé : épuise le pool de connexions Cloud SQL, provoquant `FATAL: sorry, too many clients already` pour tous les pods. Trop bas : limite le débit sous charge, entraînant une mise en file d'attente des requêtes et des pics de latence. |
| `enable_network_segmentation` | `false` au départ ; à n'activer qu'après avoir cartographié tous les flux de trafic entre espaces de noms | **Élevé** | L'activer sans comprendre les schémas de trafic bloque des communications légitimes entre pods. Symptômes : expiration des connexions à la base de données, jobs d'initialisation bloqués, échec des sondes de santé. Diagnostiquez avec `kubectl describe networkpolicy -n NAMESPACE`. |
| `enable_image_mirroring` | `true` (par défaut ; fortement recommandé) | **Élevé** | `false` : les nœuds GKE récupèrent les images depuis des registres externes. Les limites de débit de Docker Hub provoquent des `ErrImagePull` lors des pics de déploiement. Dans les environnements VPC-SC, l'accès aux registres externes est bloqué — tous les démarrages de pods échouent. |
| `enable_resource_quota` + `quota_memory_*` / `quota_cpu_*` | Définissez des valeurs de quota ≥ à la somme des demandes de tous les conteneurs de l'espace de noms | **Élevé** | Valeurs inférieures au total des demandes de ressources de la charge de travail : les pods ne parviennent pas à être planifiés, avec des événements `exceeded quota`. Les jobs d'initialisation et les CronJobs échouent également. L'espace de noms est inutilisable jusqu'au relèvement des quotas. |
| `enable_auto_password_rotation` + `rotation_propagation_delay_sec` | À n'activer qu'après validation du pipeline de rotation ; gardez `rotation_propagation_delay_sec` ≥ `90` | **Élevé** | Trop court : l'ancien identifiant est révoqué avant que tous les pods aient redémarré avec la nouvelle version. L'épuisement du pool de connexions provoque des erreurs HTTP 500 jusqu'à ce que tous les pods aient terminé un cycle de redémarrage. |
| `workload_type` | `"Deployment"` pour les applications sans état ; `"StatefulSet"` pour les applications nécessitant une identité de pod stable | **Élevé** | `"Deployment"` pour une charge de travail nécessitant une identité de volume persistant : les pods reçoivent des PVC différents au redémarrage, ce qui provoque des incohérences de données. `"StatefulSet"` pour une application sans état : surcharge de planification inutile et mises à jour progressives plus lentes. |
| Sortie `kubernetes_ready` | Vérifiez cette sortie avant de dépendre de ressources Kubernetes dans un pipeline | **Élevé** | Lors du premier déploiement d'un cluster intégré, `kubernetes_ready = false` — toutes les ressources Kubernetes sont exclues. Une **seconde exécution du déploiement** est nécessaire pour déployer les ressources de l'application. L'omettre laisse l'infrastructure provisionnée sans aucune application déployée. |
| `enable_topology_spread` + `topology_spread_strict` | `topology_spread_strict = false`, sauf si vous disposez de ≥ 3 réplicas sur ≥ 3 zones | **Moyen** | `topology_spread_strict = true` avec moins de 3 réplicas ou zones : les nouveaux pods restent indéfiniment à l'état `Pending`, avec des événements `FailedScheduling` faisant référence aux contraintes topologiques. |
| `enable_redis` | `false` pour les applications qui n'utilisent pas Redis | **Moyen** | Laisser `true` pour une application sans Redis : `REDIS_HOST` prend par défaut l'IP du serveur NFS. Si aucun service Redis ne s'y exécute, l'application journalise des erreurs de connexion à chaque démarrage. |
| `secret_rotation_period` | `"2592000s"` (30 jours) — doit inclure le suffixe `s` | **Moyen** | Omission du suffixe `s` (par exemple `"2592000"`) : Secret Manager rejette la configuration au moment de l'apply. Les notifications de rotation ne sont jamais enregistrées et la rotation automatique ne se déclenche jamais. |
| `backup_retention_days` | `7` pour le développement ; `30` pour la production | **Moyen** | `1` ou `0` : fenêtre de récupération quasi inexistante — une erreur n'est réversible que dans les 24 heures. Trop élevé : les coûts de stockage augmentent sans limite. Trouvez l'équilibre en fonction de vos exigences de RPO. |
| `configure_service_mesh` | `false` jusqu'à ce qu'ASM soit confirmé opérationnel sur le cluster | **Moyen** | L'activer sans que les API Fleet/ASM requises soient activées : le déploiement échoue avec `API not enabled`. L'activer sur un cluster partagé sans plan de contrôle ASM en cours d'exécution : les pods démarrent, mais les conteneurs sidecar restent indéfiniment à l'état `ContainerCreating`. |

---

## Sorties {#outputs}

Le module expose les sorties suivantes après un déploiement réussi.

### Informations sur le service {#service-information}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes |
| `namespace` | Espace de noms Kubernetes dans lequel l'application est déployée |
| `service_url` | URL du service — URL externe s'il s'agit d'un LoadBalancer avec IP statique, sinon URL interne au cluster |
| `service_external_ip` | IP externe du LoadBalancer (si une IP statique est réservée) ; `null` si aucune n'est réservée |
| `service_cluster_ip` | ClusterIP du Service Kubernetes de base ; `null` lorsque Cloud Deploy est actif |
| `stage_service_cluster_ips` | Carte nom d'étape → ClusterIP pour les Services propres à chaque étape lorsque `enable_cloud_deploy = true` ; carte vide sinon |
| `additional_service_urls` | Carte des noms de services supplémentaires vers leurs URL (IP externe du LoadBalancer si disponible, sinon URL interne au cluster) |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est disponible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier déploiement d'un cluster intégré — une seconde exécution du déploiement est nécessaire. |

### Base de données {#database}

| Sortie | Description |
|---|---|
| `database_instance_name` | Nom de l'instance Cloud SQL ; `null` lorsque `database_type = "NONE"` |
| `database_name` | Nom de la base de données de l'application dans l'instance |
| `database_user` | Nom de l'utilisateur de base de données de l'application |
| `database_host` | Hôte de la base de données (`127.0.0.1` via le Cloud SQL Auth Proxy) |
| `database_port` | Port de la base de données |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |

### Stockage {#storage}

| Sortie | Description |
|---|---|
| `storage_buckets` | Carte nom logique du bucket → nom du bucket pour tous les buckets GCS provisionnés ; carte vide lorsque `create_cloud_storage` vaut `false` |

### Réseau {#network}

| Sortie | Description |
|---|---|
| `network_name` | Nom du réseau VPC utilisé par le déploiement |
| `network_exists` | Indique si le réseau VPC a été trouvé (`true`/`false`) |
| `regions` | Régions GCP disponibles dans le VPC |
| `region` | Région GCP dans laquelle l'application est déployée |

### NFS {#nfs}

| Sortie | Description |
|---|---|
| `nfs_server_ip` | IP interne du serveur NFS *(sensible)* ; `null` lorsque NFS est désactivé ou qu'aucun serveur n'existe |
| `nfs_mount_path` | Chemin du système de fichiers du conteneur où le volume NFS est monté |
| `nfs_share_path` | Chemin d'export sur le serveur NFS |

### Conteneur et registre {#container--registry}

| Sortie | Description |
|---|---|
| `container_image` | URI complet de l'image de conteneur utilisée par la charge de travail déployée |
| `container_registry` | Nom du dépôt Artifact Registry ; `null` lorsqu'aucun build personnalisé n'est configuré |

### Supervision {#monitoring}

| Sortie | Description |
|---|---|
| `monitoring_enabled` | Indique si Cloud Monitoring est configuré (`true`/`false`) |
| `monitoring_notification_channels` | Liste des noms des canaux de notification Cloud Monitoring |
| `uptime_check_names` | Liste des noms de configuration des tests de disponibilité |

### Métadonnées du déploiement {#deployment-metadata}

| Sortie | Description |
|---|---|
| `deployment_id` | Identifiant unique du déploiement (suffixe hexadécimal aléatoire généré automatiquement) |
| `tenant_id` | Identifiant du tenant, dérivé de `tenant_id` |
| `resource_prefix` | Préfixe de nommage appliqué aux ressources GCP de ce déploiement |
| `project_id` | ID du projet GCP |
| `project_number` | Numéro du projet GCP |

### Jobs {#jobs}

| Sortie | Description |
|---|---|
| `initialization_jobs` | Carte clé de job → nom du Job Kubernetes pour tous les jobs d'initialisation provisionnés |
| `cron_jobs` | Carte clé de job → nom du CronJob Kubernetes pour tous les cron jobs provisionnés |
| `statefulset_name` | Nom du StatefulSet lorsque `workload_type = "StatefulSet"` (ou `stateful_pvc_enabled = true`) ; `null` sinon |
| `nfs_setup_job` | Nom du Job Kubernetes de configuration NFS ; `null` s'il n'est pas créé |
| `db_import_job` | Nom du Job Kubernetes d'import de la base de données ; `null` s'il n'est pas créé |

### CI/CD {#cicd}

| Sortie | Description |
|---|---|
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté à Cloud Build |
| `github_repository_owner` | Propriétaire / organisation du dépôt GitHub |
| `github_repository_name` | Nom du dépôt GitHub |
| `artifact_registry_repository` | Objet contenant `name`, `location` et `url` du dépôt Artifact Registry ; `null` lorsque ni le build personnalisé ni la CI/CD ne sont activés |
| `cloudbuild_trigger_name` | Nom du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` vaut `false` |
| `cloudbuild_trigger_id` | ID du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` vaut `false` |
| `cicd_configuration` | Objet contenant tous les détails de la CI/CD (nom/ID du déclencheur, informations sur le dépôt, motif de branche, URL du registre, e-mail du compte de service) ; `null` lorsqu'aucun déclencheur n'existe |

### VPC Service Controls {#vpc-service-controls}

| Sortie | Description |
|---|---|
| `vpc_sc_enabled` | Indique si le périmètre VPC-SC a bien été créé |
| `vpc_sc_perimeter_name` | Nom de ressource du périmètre de service VPC-SC ; `null` s'il n'est pas activé |
| `vpc_sc_dry_run_mode` | `true` si VPC-SC est en mode simulation (dry-run, journalisation uniquement) ; `false` s'il est appliqué de manière active |
| `audit_logging_enabled` | Indique si les journaux d'audit Cloud au niveau du projet sont activés |
| `artifact_registry_cmek_enabled` | Indique si le chiffrement CMEK d'Artifact Registry est configuré |

---

## Destruction des ressources {#destroying-resources}

Lors de la suppression d'un déploiement App GKE, la plateforme déclenche le démantèlement complet de toutes les ressources Kubernetes, de l'infrastructure GCP et des liaisons de comptes de service gérées par ce module.

**Avant de lancer la destruction :**

1. **Comprenez le comportement de purge** — un paramètre géré par la plateforme détermine si la destruction supprime entièrement les ressources gérées par le module ou les conserve pour se prémunir contre une perte de données accidentelle. Vérifiez quel mode s'applique avant la destruction.
2. **Vérifiez les sauvegardes** — confirmez qu'une sauvegarde récente de la base de données existe dans le bucket GCS de sauvegarde avant de supprimer le déploiement, en particulier pour les environnements de production.
3. **Enregistrements DNS** — si des domaines personnalisés sont configurés, supprimez les enregistrements DNS A pointant vers l'IP de l'équilibreur de charge après la suppression du déploiement, afin d'éviter des entrées DNS obsolètes.
4. **PVC orphelins** — pour les charges de travail StatefulSet, Kubernetes ne supprime pas automatiquement les PersistentVolumeClaims lorsqu'un StatefulSet est supprimé. La plateforme prend en charge la suppression des PVC dans le cadre du démantèlement, mais vérifiez dans **Kubernetes Engine → Storage → PersistentVolumeClaims** qu'il ne reste aucun PVC après la destruction.
5. **Cluster GKE intégré** — si un cluster intégré a été provisionné par ce déploiement (sans dépendance à Services GCP), le cluster, son VPC et toutes les ressources de sous-réseau sont supprimés. Tous les autres espaces de noms et charges de travail de ce cluster seront également détruits. Assurez-vous qu'aucune autre charge de travail ne partage le cluster intégré avant de lancer la suppression.

**Délai connu — libération de l'IP statique :**
Après la suppression du Service Kubernetes LoadBalancer, GCP peut conserver l'adresse IP externe sur le sous-réseau VPC pendant 20 à 30 minutes. Si cela se produit pendant le nettoyage, attendez 20 à 30 minutes et réessayez. La seconde tentative réussira une fois que GCP aura libéré l'adresse réservée.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : App GKE](../labs/App_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module App CloudRun — Guide de configuration](App_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [App Common — Guide de configuration](App_Common.md) — la configuration commune aux deux cibles de déploiement.
