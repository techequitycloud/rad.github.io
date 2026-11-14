---
title: "Module App GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement d'applications sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/App_GKE.md @ 40c83c3f sha256:c550ae53d937 -->

# Module App GKE — Guide de configuration {#app-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/App_GKE.png" alt="Module App GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `App GKE`, organisée en groupes fonctionnels. Pour chaque variable, il explique les options disponibles, les implications de chaque choix et comment valider la configuration résultante dans la console Google Cloud ou à l'aide des commandes CLI `gcloud` et `kubectl`.

---

## Services GCP déployés {#deployed-gcp-services}

Un déploiement `App GKE` entièrement configuré provisionne et intègre les services GCP suivants :

- **GKE Autopilot** — Cluster Kubernetes avec gestion automatique des nœuds, Horizontal Pod Autoscaler (HPA) et Vertical Pod Autoscaler (VPA) facultatif
- **Kubernetes Deployments / StatefulSets** — Contrôleur de charge de travail d'application avec mise à l'échelle configurable des réplicas et stratégie de mise à jour progressive
- **Kubernetes Services** — Exposition interne ClusterIP, externe LoadBalancer ou NodePort pour l'application
- **Cloud Build** — Pipeline de build d'images conteneur et déclencheur CI/CD connecté à GitHub
- **Artifact Registry** — Dépôt d'images conteneur avec politiques de nettoyage configurables et chiffrement CMEK facultatif
- **Cloud SQL** — Instance de base de données gérée PostgreSQL, MySQL ou SQL Server avec sidecar Cloud SQL Auth Proxy
- **Cloud Storage (GCS)** — Buckets d'application avec montages facultatifs du pilote CSI GCS Fuse à l'intérieur des pods
- **Cloud Filestore / VM NFS GCE** — Stockage NFS persistant partagé accessible simultanément par tous les réplicas de pods
- **Secret Manager** — Stockage sécurisé pour les mots de passe de base de données, les jetons GitHub et les secrets d'application ; injecté dans les pods via le pilote CSI Secrets Store
- **Workload Identity** — Authentification GCP sans clé pour les pods utilisant des jetons de compte de service projetés (pas de fichiers de clés)
- **Cloud Monitoring** — Tests de disponibilité, politiques d'alerte et canaux de notification pour `support_users`
- **Cloud Deploy** *(facultatif)* — Pipeline de livraison progressive multi-étapes avec portes de promotion et approbations manuelles facultatives
- **Cloud Armor** *(facultatif)* — Politique de sécurité WAF attachée au backend GKE Gateway
- **Identity-Aware Proxy** *(facultatif)* — Authentification par identité Google appliquée au niveau de la passerelle
- **Certificate Manager** *(facultatif)* — Certificats SSL gérés par Google pour les domaines personnalisés via l'API GKE Gateway
- **VPC Service Controls** *(facultatif)* — Périmètre d'API restreignant l'accès aux services GCP aux identités au sein du VPC et approuvées

---

## Prérequis {#prerequisites}

Avant de déployer App GKE :

1. **Projet GCP** avec facturation activée.
2. **Module Services GCP** (fournit des clusters partagés, Cloud SQL partagé, NFS partagé et Artifact Registry partagé). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme le provisionne automatiquement avant votre déploiement s'il n'existe pas déjà dans le projet cible. App GKE peut également fonctionner en mode autonome entièrement intégré sans Services GCP (`require_services_gcp_module = false`), mais chaque déploiement provisionne alors son propre VPC, cluster GKE, VM NFS et instance Cloud SQL.
3. **Autorisations IAM** : Le compte de service de déploiement nécessite des autorisations étendues au niveau du projet (Project Editor ou équivalent) pour créer des espaces de noms GKE, des utilisateurs Cloud SQL, des buckets GCS et des secrets Secret Manager.
4. Les **secrets Secret Manager** référencés dans `secret_environment_variables` doivent exister avant le déploiement — le déploiement échoue si un secret référencé est absent.
5. Pour le **CI/CD** (`enable_cicd_trigger = true`) : un dépôt GitHub et soit un jeton d'accès personnel GitHub (scopes : `repo`, `admin:repo_hook`) soit un ID d'installation d'application GitHub.
6. Pour **IAP** (`enable_iap = true`) : un client OAuth 2.0 pré-créé (ID client et secret) depuis **APIs & Services → Credentials** et un écran de consentement OAuth configuré.
7. Pour l'**importation de sauvegarde** (`enable_backup_import = true`) : le fichier de sauvegarde doit être téléchargé dans le bucket de sauvegarde GCS avant le déploiement.

---

## Groupe 0 — Métadonnées du module et câblage de la plateforme {#group-0--module-metadata--platform-wiring}

Ces variables sont consommées par la plateforme de déploiement plutôt que par les ressources Terraform elles-mêmes. `explicit_secret_values` et `scripts_dir` sont renseignées par un module Application (wrapper) — tel que `Ghost_GKE` — qui appelle `App_GKE` comme module enfant ; elles doivent être laissées à leurs valeurs par défaut vides lors du déploiement de `App_GKE` de manière autonome.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `module_description` | `string` | *(module blurb)* | Description lisible par l'homme de l'objectif du module, affichée dans l'interface utilisateur de la plateforme. Métadonnées uniquement — ne pas modifier sauf si vous personnalisez le module pour un fork. |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/modules/App_GKE"` | Lien vers la documentation externe de ce module, affiché dans l'interface utilisateur de la plateforme comme référence d'aide. Métadonnées uniquement. |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Autres modules de plateforme qui doivent être déployés avant celui-ci. Utilisé par la plateforme pour appliquer l'ordre de déploiement. Métadonnées uniquement. |
| `module_services` | `list(string)` | `["GKE Autopilot", …]` | Services GCP activés ou consommés par ce module. Utilisé pour la documentation et la visibilité des services de la plateforme. Métadonnées uniquement. |
| `credit_cost` | `number` | `0` | Crédits de plateforme consommés lors du déploiement de ce module. Utilisé par le système de facturation de la plateforme. Métadonnées uniquement. |
| `require_credit_purchases` | `bool` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts ou d'événement. |
| `enable_purge` | `bool` | `true` | Permet la suppression complète de toutes les ressources gérées par le module lors de la destruction. Définissez `false` pour conserver les ressources après la suppression du module, protégeant ainsi contre la perte accidentelle de données. Métadonnées uniquement. |
| `public_access` | `bool` | `true` | Contrôle si ce module est publiquement listé dans le catalogue de la plateforme. Métadonnées uniquement. |
| `require_services_gcp_module` | `bool` | `true` | Lorsque `true`, le déploiement échoue au moment de la planification avec une erreur claire si aucun réseau VPC géré par `Services_GCP` n'est détecté dans le projet. Définissez `false` pour autoriser un déploiement autonome avec des ressources prérequises intégrées. |
| `shared_users` | `list(string)` | `[]` | Utilisateurs qui peuvent afficher et déployer ce module quelle que soit la valeur du paramètre `public_access`. |
| `technical_support_users` | `list(string)` | `[]` | Utilisateurs responsables de la fourniture du support technique pour ce module. Le portail de déploiement achemine les demandes de support vers ces adresses. Métadonnées uniquement. |
| `resource_creator_identity` | `string` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | Compte de service utilisé par Terraform pour créer et gérer les ressources. À remplacer par un compte de service spécifique au projet pour les déploiements de production. |
| `impersonation_service_account` | `string` | `""` | Compte de service à emprunter lorsque les scripts shell (découverte, mise en miroir d'images, configuration NFS) appellent les API GCP. Requis pour les déploiements inter-projets ; laisser vide pour utiliser les propres identifiants de l'exécuteur. |
| `job_execution_wait_timeout` | `number` | `900` | Nombre maximal de secondes pendant lesquelles un déploiement attend que le job de configuration de la base de données (`db-create`) se termine avant d'avorter, de sorte qu'un job bloqué échoue rapidement l'apply au lieu de rester bloqué jusqu'au délai d'expiration externe du build. |
| `explicit_secret_values` | `map(string)` | `{}` | Valeurs de secrets brutes fournies directement par un module wrapper. Les clés doivent correspondre aux entrées de `secret_environment_variables`. Lorsqu'elles sont fournies, la recherche de la source de données Secret Manager au moment de la planification est ignorée pour ces clés, ce qui permet au premier apply de réussir avant que les secrets n'existent. |
| `scripts_dir` | `string` | `""` | Répertoire contenant les scripts d'initialisation et utilitaires. Par défaut, le répertoire des scripts intégrés du module lorsqu'il est laissé vide. À remplacer lorsqu'un module wrapper fournit des scripts personnalisés. |
| `requires_services` | `object` | `{ create_postgres = true, create_network_filesystem = true, create_google_kubernetes_engine = true, … }` | Mappage explicite des ressources provisionnées par Services GCP dont ce module a besoin. La plateforme lit ce mappage — et non `module_services`, qui est une liste lisible par l'homme pour l'interface utilisateur de confirmation de déploiement — pour décider quels commutateurs `create_*` de Services GCP doivent être activés lors du provisionnement automatique ou de la mise à jour du déploiement Services GCP partagé pour le projet de destination. Les clés reflètent les noms de variables booléennes de Services GCP 1:1 : `create_postgres`, `create_mysql`, `create_redis`, `create_network_filesystem`, `create_filestore_nfs`, `create_google_kubernetes_engine`, `create_firestore`, `enable_alloydb`. `create_redis` et `create_filestore_nfs` sont par défaut à `false` car le chemin de déploiement automatisé utilise la VM Compute Engine NFS+Redis (`create_network_filesystem`) ; Memorystore/Filestore géré est une optimisation manuelle post-déploiement. |

---

## Groupe 1 — Projet et identité {#group-1--project--identity}

Ces variables établissent le contexte du projet GCP. Elles doivent être configurées correctement avant que tout déploiement puisse réussir.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | `string` | *(obligatoire)* | L'ID du projet GCP où toutes les ressources sont provisionnées. Tous les noms de ressources, les liaisons IAM et les appels d'API sont limités à ce projet. Doit comporter 6 à 30 caractères minuscules commençant par une lettre. |
| `region` | `string` | `"us-central1"` | Région GCP utilisée lorsqu'aucun mappage de sous-réseau Services GCP ne peut être auto-découvert. À remplacer pour les déploiements en dehors de `us-central1`. |

### Exploration dans GCP — Groupe 1 {#exploring-in-gcp--group-1}

**Console Google Cloud :**
- **Confirmation du projet :** Le nom et l'ID du projet sont affichés dans la barre de navigation supérieure. Accédez à **Accueil → Tableau de bord** pour confirmer que vous êtes dans le bon projet.
- **Région du cluster GKE :** Accédez à **Kubernetes Engine → Clusters** pour confirmer que la région du cluster correspond à la région de déploiement attendue.

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

Ces variables définissent le suffixe de l'environnement de déploiement et les paramètres de notification partagés appliqués à toutes les ressources.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `tenant_id` | `string` | `"demo"` | Identifiant court ajouté aux noms de ressources (par exemple, espace de noms Kubernetes, secrets, instance SQL) pour distinguer ce déploiement des autres dans le même projet. Utilisez `prod`, `staging`, `dev` ou un identifiant de locataire. **Ne jamais modifier après le déploiement initial** — il est intégré à chaque nom de ressource. |
| `support_users` | `list(string)` | `[]` | Adresses e-mail des destinataires des notifications d'alerte Cloud Monitoring (échecs de disponibilité, violations de politique d'alerte). L'ajout d'adresses ici n'accorde aucune autorisation IAM GCP. |
| `resource_labels` | `map(string)` | `{ env = "dev" }` | Libellés clé-valeur appliqués à toutes les ressources GCP créées par ce module. Utilisez-les pour l'attribution des coûts, le marquage de l'environnement et l'application des politiques organisationnelles. |

### Exploration dans GCP — Groupe 2 {#exploring-in-gcp--group-2}

**Console Google Cloud :**
- **Espace de noms Kubernetes :** Accédez à **Kubernetes Engine → Charges de travail** et filtrez par espace de noms pour confirmer que le nom de l'espace de noms correspond à `APPLICATION_NAME-TENANT_ID`.
- **Libellés :** Accédez à n'importe quelle ressource (par exemple, **Cloud Storage → Buckets → *votre bucket*** → **Configuration**) pour vérifier les libellés.
- **Canaux de notification de surveillance :** Accédez à **Monitoring → Alertes → Canaux de notification** pour confirmer que les adresses e-mail des utilisateurs du support sont enregistrées.

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

Ces variables définissent l'identité de l'application déployée. Elles contrôlent la façon dont l'application est nommée dans les services GCP et les ressources Kubernetes.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"gkeapp"` | Identifiant interne de l'application. Utilisé comme nom de base pour le déploiement Kubernetes, l'espace de noms, le dépôt Artifact Registry et les secrets Secret Manager. Doit commencer par une lettre minuscule, 1 à 20 caractères. **Ne jamais modifier après le déploiement initial.** |
| `application_display_name` | `string` | `"App_GKE Application"` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme et les tableaux de bord de surveillance. Peut être mis à jour librement à tout moment sans affecter les noms de ressources. |
| `application_description` | `string` | `"App_GKE Custom Application…"` | Brève description de l'objectif de l'application. Renseignée dans les annotations de déploiement Kubernetes et la documentation de la plateforme. |
| `application_version` | `string` | `"1.0.0"` | Étiquette de version appliquée à l'image du conteneur et utilisée pour le suivi du déploiement. L'incrémentation de cette valeur déclenche un nouveau build d'image et un nouveau déploiement lorsque `container_image_source` est `custom`. |

### Exploration dans GCP — Groupe 3 {#exploring-in-gcp--group-3}

**Console Google Cloud :**
- **Nom du déploiement :** Accédez à **Kubernetes Engine → Charges de travail** pour confirmer que le déploiement est listé avec le nom attendu dérivé de `application_name`.
- **Dépôt Artifact Registry :** Accédez à **Artifact Registry → Dépôts** pour confirmer qu'un dépôt nommé d'après `application_name` existe.
- **Versions d'images :** Cliquez sur le dépôt pour afficher toutes les versions d'images étiquetées.

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

> **Choix de l'exécution et de la mise à l'échelle.** **Source de l'image :** `"custom"` construit à partir de votre dépôt via Cloud Build (nécessite la connexion GitHub) ; `"prebuilt"` déploie une URI d'image existante et *nécessite* `container_image` (appliqué au moment de la planification). **Mise à l'échelle :** sur Autopilot, vous payez par demande de ressource de pod, donc `min_instance_count`/`max_instance_count` (les limites HPA — min ne doit pas dépasser max, appliqué) déterminent directement la disponibilité et le coût ; définissez `min` ≥ 1 pour les services sensibles à la latence, et dimensionnez `container_resources` à l'utilisation réelle car Autopilot facture la demande, pas le nœud. La **forme de la charge de travail** est décidée dans les groupes 6-7 : un `Deployment` sans état s'adapte horizontalement et librement ; un `StatefulSet` (sélectionné automatiquement par `stateful_pvc_enabled`) donne une identité stable + un stockage persistant par pod mais contraint la mise à l'échelle — choisissez-le uniquement lorsque la charge de travail a réellement besoin d'un stockage ou d'une identité stable.

Ces variables contrôlent la manière dont le conteneur d'application est sourcé, construit, déployé et mis à l'échelle sur GKE Autopilot.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Lorsque `true`, la charge de travail Kubernetes est déployée. Définissez sur `false` pour provisionner l'infrastructure de support (VPC, base de données, stockage, espace de noms GKE) sans déployer le conteneur d'application. Utile pour les déploiements échelonnés ou les flux de travail axés sur l'infrastructure. |
| `container_image_source` | `string` | `"custom"` | Détermine comment l'image du conteneur est sourcée. `prebuilt` déploie directement une URI d'image existante ; `custom` utilise Cloud Build pour construire l'image à partir de la source. |
| `container_image` | `string` | `""` | URI complète de l'image du conteneur à déployer. Obligatoire lorsque `container_image_source` est `prebuilt` ou `enable_image_mirroring` est `true`. Exemples : `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:latest`. |
| `container_build_config` | `object` | `{ enabled = true }` | Configuration Cloud Build lorsque `container_image_source` est `custom`. Champs clés : `enabled`, `dockerfile_path`, `dockerfile_content`, `context_path`, `build_args`, `artifact_repo_name`, `base_image`. |
| `enable_image_mirroring` | `bool` | `true` | Met en miroir l'image du conteneur de son registre source vers Artifact Registry avant le déploiement. Fortement recommandé pour les images publiques externes afin d'éviter les limites de débit et d'appliquer la provenance. |
| `min_instance_count` | `number` | `1` | Nombre minimum de réplicas de pods à maintenir en cours d'exécution en permanence (HPA `minReplicas`). Définissez sur `0` pour une mise à l'échelle à zéro (non recommandé pour les charges de travail de production sensibles à la latence). |
| `max_instance_count` | `number` | `3` | Nombre maximal de réplicas de pods autorisés à s'exécuter simultanément (HPA `maxReplicas`). Sert de plafond de coût. Assurez-vous que `max × connections_per_pod` ne dépasse pas `max_connections` de Cloud SQL. |
| `container_port` | `number` | `8080` | Port TCP sur lequel l'application écoute à l'intérieur du conteneur. Le service Kubernetes achemine tout le trafic vers ce port. Doit correspondre exactement au port auquel votre serveur d'applications est lié. |
| `container_protocol` | `string` | `"http1"` | Version du protocole HTTP pour le backend du service Kubernetes. `http1` est HTTP/1.1 standard ; `h2c` est HTTP/2 en texte clair (requis pour gRPC). Lorsque `h2c` est défini, le port du service annonce `appProtocol: kubernetes.io/h2c`. |
| `container_resources` | `object` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Demandes et limites de ressources CPU et mémoire pour le conteneur. GKE Autopilot facture les ressources demandées — définissez des demandes précises. Accepte la notation de quantité Kubernetes (`1000m`, `512Mi`, `1Gi`). Champs facultatifs : `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. |
| `timeout_seconds` | `number` | `300` | Durée maximale en secondes pendant laquelle l'équilibreur de charge attend une réponse du pod backend avant de renvoyer une erreur 504. Plage valide : 0–3600. |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Active l'autoscaling vertical des pods (VPA), qui ajuste automatiquement les demandes de CPU et de mémoire en fonction de l'utilisation observée. Recommandé pour GKE Autopilot où des demandes précises réduisent les coûts. Ne pas combiner avec HPA sur la même métrique CPU/mémoire. |
| `enable_cloudsql_volume` | `bool` | `true` | Injecte un conteneur sidecar Cloud SQL Auth Proxy dans le pod GKE, exposant la base de données sur `127.0.0.1` via un socket Unix. Le chemin sécurisé recommandé pour la connectivité Cloud SQL. |
| `cloud_sql_proxy_version` | `string` | `"2-alpine"` | Étiquette de version pour l'image sidecar Cloud SQL Auth Proxy. Épinglez à un digest pour des déploiements immuables. L'image du proxy est automatiquement mise en miroir dans Artifact Registry. |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Chemin du système de fichiers à l'intérieur du conteneur où le socket Unix du Cloud SQL Auth Proxy est monté. La chaîne de connexion de la base de données de votre application doit référencer ce chemin. |
| `service_annotations` | `map(string)` | `{}` | Annotations personnalisées appliquées à la ressource Kubernetes Service. Utilisez-les pour une configuration avancée de GKE ou de l'équilibreur de charge non exposée en tant que paramètres de première classe. |
| `service_labels` | `map(string)` | `{ env = "dev" }` | Libellés personnalisés appliqués spécifiquement à la ressource Kubernetes Service, en plus de `resource_labels`. |
| `deployment_timeout` | `number` | `1800` | Nombre maximal de secondes pendant lesquelles la plateforme attend que le déploiement Kubernetes ou le StatefulSet se termine pendant le déploiement. Augmentez pour les clusters qui tirent de grandes images ou des pods avec de longs temps de démarrage. |

### Exploration dans GCP — Groupe 4 {#exploring-in-gcp--group-4}

**Console Google Cloud :**
- **Déploiement et mise à l'échelle :** Accédez à **Kubernetes Engine → Charges de travail → *votre déploiement*** pour afficher le déploiement, son nombre de réplicas et la configuration HPA.
- **Image du conteneur :** Dans les détails de la charge de travail, sélectionnez l'onglet **YAML** pour afficher la spécification du conteneur, y compris l'URI de l'image et les limites de ressources.
- **Images Artifact Registry :** Accédez à **Artifact Registry → Dépôts → *nom_application*** pour afficher les étiquettes d'image disponibles.
- **État HPA :** Accédez à **Kubernetes Engine → Charges de travail** et recherchez les ressources `HorizontalPodAutoscaler` dans le même espace de noms.

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

Ces variables contrôlent la manière dont la configuration et les identifiants sensibles sont livrés aux pods en cours d'exécution.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement en texte clair injectées dans le pod GKE au moment de l'exécution. Utilisez-les pour une configuration non sensible telle que les indicateurs de fonctionnalités, les niveaux de journalisation ou les points de terminaison d'API. Ne stockez jamais de mots de passe ou de jetons ici. |
| `secret_environment_variables` | `map(string)` | `{}` | Références de secrets Secret Manager injectées en tant que variables d'environnement dans le pod via Kubernetes `valueFrom`. La clé de la carte est le nom de la variable d'environnement ; la valeur de la carte est le nom du secret Secret Manager. La valeur en texte clair n'est jamais stockée dans la configuration ou l'état. |
| `secret_rotation_period` | `string` | `"2592000s"` | Fréquence à laquelle Secret Manager publie une notification de rotation via Pub/Sub. Spécifiée en secondes avec un suffixe `s` (par exemple, `"2592000s"` pour 30 jours). Ne fait pas pivoter automatiquement le secret — un gestionnaire de rotation doit être implémenté séparément. |
| `secret_propagation_delay` | `number` | `30` | Secondes à attendre après la création ou la mise à jour d'un secret avant de continuer. Permet à la réplication globale de Secret Manager de se terminer avant que les pods ne tentent de lire la valeur du secret. Augmentez si les déploiements échouent avec des erreurs de secret introuvable. |

### Exploration dans GCP — Groupe 5 {#exploring-in-gcp--group-5}

**Console Google Cloud :**
- **Contenu du secret Kubernetes (CSI) :** Accédez à **Kubernetes Engine → Charges de travail → *votre déploiement* → YAML** pour afficher les blocs `env` et `envFrom` montrant les références de secrets.
- **Secrets Secret Manager :** Accédez à **Sécurité → Secret Manager** pour afficher tous les secrets, leurs versions, leurs calendriers de rotation et leurs politiques d'accès.
- **Accès IAM aux secrets :** Dans Secret Manager, cliquez sur un secret → **Autorisations** pour confirmer que le compte de service de la charge de travail GKE dispose des autorisations `Secret Accessor`. Le compte n'a pas de rôle Secret Manager au niveau du projet : ce module lui accorde chaque secret que SecretSync lit (les secrets de l'application, les secrets nommés uniquement dans `secret_env_vars` d'un job d'initialisation, et le mot de passe de la base de données de chaque étape Cloud Deploy), et `Services GCP` accorde le mot de passe root de Cloud SQL.

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

Ces variables contrôlent la manière dont l'application est exposée au sein du cluster Kubernetes et comment elle est connectée au cluster et au réseau GKE.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `gke_cluster_name` | `string` | `""` | Nom du cluster GKE dans lequel déployer. Laissez vide pour découvrir automatiquement un cluster géré par Services GCP à l'aide de `gke_cluster_selection_mode`. |
| `gke_cluster_selection_mode` | `string` | `"primary"` | Stratégie de sélection du cluster GKE cible lorsque `gke_cluster_name` n'est pas défini. `primary` cible le premier cluster géré par Services GCP découvert ; `round-robin` distribue sur plusieurs clusters ; `explicit` nécessite que `gke_cluster_name` soit défini. |
| `namespace_name` | `string` | `""` | Espace de noms Kubernetes dans lequel déployer les ressources de l'application. Laissez vide pour générer automatiquement à partir de `application_name` et `tenant_id`. |
| `workload_type` | `string` | `null` | Contrôleur de charge de travail Kubernetes. `Deployment` pour les applications sans état ; `StatefulSet` pour les applications nécessitant des identités réseau stables ou un stockage persistant par pod. Par défaut à `Deployment` lorsque nul. La définition de `stateful_pvc_enabled = true` se résout automatiquement en `StatefulSet`. |
| `service_type` | `string` | `"LoadBalancer"` | Type de service Kubernetes. `LoadBalancer` provisionne un équilibreur de charge GCP avec une IP externe ; `ClusterIP` pour un accès interne uniquement ; `NodePort` expose sur un port statique sur tous les nœuds. |
| `service_port` | `number` | `80` | Port exposé sur le service Kubernetes (le port auquel les clients se connectent). Définissez-le pour qu'il corresponde au port natif de l'application lorsque les clients doivent se connecter sur ce port spécifique. |
| `extra_service_ports` | `list(object)` | `[]` | Ports supplémentaires à exposer sur le service Kubernetes, pour une charge de travail qui parle plus d'un protocole sur le même pod (par exemple ClickHouse, qui sert HTTP sur `8123` tandis que son protocole natif est sur `9000`). Chaque entrée définit `name`, `port`, `target_port` facultatif (par défaut `port`), et `protocol` facultatif (par défaut `TCP`). Les noms doivent être uniques — Kubernetes exige un nom distinct pour chaque port dans un service multi-ports, et cela est appliqué au moment de la planification. Purement additif : la valeur par défaut vide rend exactement le même service qu'auparavant. |
| `session_affinity` | `string` | `"ClientIP"` | Mode d'affinité de session pour le service Kubernetes. `ClientIP` achemine toutes les requêtes de la même IP client vers le même pod (utile pour les applications avec état). `None` distribue les requêtes sur tous les pods. |
| `enable_network_segmentation` | `bool` | `false` | Crée des ressources Kubernetes NetworkPolicy pour restreindre l'entrée et la sortie de pod à pod. Limite le rayon d'explosion pour les charges de travail compromises. Nécessite que le cluster GKE ait l'application de la politique réseau activée. Activez uniquement après avoir mappé tous les flux de trafic inter-espaces de noms. |
| `configure_service_mesh` | `bool` | `false` | Active l'injection de maillage de services Istio pour l'espace de noms de l'application en ajoutant le libellé `istio-injection: enabled`. Nécessite que Cloud Service Mesh ou Anthos Service Mesh soit installé sur le cluster. |
| `enable_multi_cluster_service` | `bool` | `false` | Destiné à activer les services multi-clusters GKE (MCS) pour la découverte de services inter-clusters au sein d'une flotte GKE. Remarque : la ressource ServiceExport n'est pas actuellement créée par ce module — cette variable n'a aucun effet sur le déploiement dans la version actuelle. |
| `termination_grace_period_seconds` | `number` | `60` | Secondes pendant lesquelles Kubernetes attend après l'envoi de SIGTERM avant de terminer de force le conteneur avec SIGKILL. Augmentez pour les applications qui ont besoin de temps pour terminer les requêtes en cours ou vider les données. Plage valide : 0–3600. |
| `prereq_gke_subnet_cidr` | `string` | `"10.201.0.0/24"` | Plage CIDR pour le sous-réseau GKE intégré créé lorsqu'un VPC Services GCP existe mais qu'aucun cluster GKE n'est présent. Ne doit pas chevaucher d'autres sous-réseaux. Chaque déploiement App GKE dans le même VPC doit utiliser un CIDR distinct. **Ne jamais modifier après la création du cluster GKE intégré.** |
| `prereq_subnet_cidr_override` | `string` | `""` | Remplacement pour le CIDR du sous-réseau primaire du VPC intégré. Lorsqu'il est vide, un `/24` unique est dérivé par déploiement. Épinglez à la valeur précédemment appliquée sur les déploiements existants pour éviter le remplacement du sous-réseau. |
| `prereq_gke_pod_cidr_override` | `string` | `""` | Remplacement pour le CIDR de la plage secondaire de pods du cluster GKE intégré. Épinglez à la valeur précédemment appliquée sur les déploiements existants pour éviter le remplacement du cluster GKE. |
| `prereq_gke_service_cidr_override` | `string` | `""` | Remplacement pour le CIDR de la plage secondaire de services du cluster GKE intégré. Épinglez à la valeur précédemment appliquée sur les déploiements existants pour éviter le remplacement du cluster GKE. |
| `prereq_gke_master_cidr_override` | `string` | `""` | Remplacement pour le `/28` privé du plan de contrôle du cluster GKE intégré. Lorsqu'il est vide, la fondation dérive un `/28` unique par déploiement à partir de l'ID de déploiement aléatoire à l'intérieur de `172.16.0.0/12` — un bloc RFC1918 différent des plages de sous-réseau/pod/service ci-dessus, de sorte qu'il ne peut jamais entrer en collision avec elles. Épinglez à la valeur précédemment appliquée sur les déploiements existants pour éviter le remplacement du cluster GKE. |

#### Les clusters GKE intégrés exécutent toujours des nœuds privés {#inline-gke-clusters-always-run-private-nodes}

Le cluster GKE Autopilot intégré est créé avec `private_cluster_config { enable_private_nodes = true }`, ce qui n'est **pas** facultatif et n'a pas de variable pour le désactiver. Les projets gérés par RAD appliquent une politique d'organisation DENY `constraints/compute.vmExternalIpAccess` ; sans nœuds privés, GKE tente d'attribuer des IP externes à ses nœuds, la création de nœuds échoue avec `Constraint constraints/compute.vmExternalIpAccess violated`, et le cluster reste bloqué dans `ERROR`.

Seuls les **nœuds** sont privés. `enable_private_endpoint` est délibérément laissé à sa valeur par défaut (`false`), de sorte que le plan de contrôle conserve son point de terminaison public — Cloud Build et d'autres outils hors VPC s'y connectent directement. La propre plage privée du plan de contrôle provient de `prereq_gke_master_cidr_override` (ou du `/28` dérivé ci-dessus).

### Exploration dans GCP — Groupe 6 {#exploring-in-gcp--group-6}

**Console Google Cloud :**
- **Cluster GKE :** Accédez à **Kubernetes Engine → Clusters** pour confirmer le cluster cible et sa configuration.
- **Espace de noms Kubernetes :** Accédez à **Kubernetes Engine → Charges de travail** et filtrez par espace de noms.
- **Service Kubernetes :** Accédez à **Kubernetes Engine → Services et Ingress** pour afficher le type de service, l'IP externe et le mappage de ports.
- **NetworkPolicies :** Accédez à **Kubernetes Engine → Charges de travail** et recherchez les ressources NetworkPolicy dans l'espace de noms.

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

> **Choisir StatefulSet ou Deployment.** La définition de `stateful_pvc_enabled = true` est le seul interrupteur : elle **résout automatiquement la charge de travail en un `StatefulSet`** (vous ne définissez pas également `workload_type` — le jumelage avec `workload_type = "Deployment"` est rejeté au moment de la planification) et donne à chaque réplica une identité réseau stable ainsi que sa propre PersistentVolumeClaim qui survit aux replanifications. Utilisez-le pour les bases de données dans le cluster, les brokers ou tout ce qui nécessite un stockage stable par pod. Pour les charges de travail web/API sans état, laissez-le désactivé — un `Deployment` s'adapte plus librement et n'a pas de cycle de vie PVC à gérer. Lorsqu'il est activé, `stateful_pvc_size` et `stateful_pvc_mount_path` sont requis (appliqué). Notez que le stockage partagé entre les pods est un besoin *différent* — utilisez NFS (Groupe 13), pas les PVC par pod.

Ces variables configurent le stockage persistant pour les charges de travail StatefulSet. Chaque réplica de pod reçoit sa propre PersistentVolumeClaim (PVC) isolée pour un stockage stable par pod.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `null` | Active les modèles PersistentVolumeClaim dans la spécification StatefulSet afin que chaque réplica de pod reçoive sa propre PVC isolée. La définition de cette valeur sur `true` résout automatiquement `workload_type` en `StatefulSet`. La définition de `workload_type = "Deployment"` en même temps échoue au moment de la planification. |
| `stateful_pvc_size` | `string` | `null` | Taille de stockage pour chaque PVC provisionnée par le StatefulSet. Chaque pod reçoit une PVC de cette taille. Exemple : `"20Gi"`. |
| `stateful_pvc_mount_path` | `string` | `null` | Chemin du système de fichiers à l'intérieur de chaque conteneur de pod où la PVC par pod est montée. L'application lit et écrit des données persistantes à ce chemin. Exemple : `"/var/lib/data"`. |
| `stateful_pvc_storage_class` | `string` | `null` | Kubernetes StorageClass pour les PVC StatefulSet. Laissez nul pour utiliser la StorageClass par défaut du cluster. Pour GKE Autopilot, `standard-rwo` (PD équilibré, ReadWriteOnce) est la valeur par défaut. |
| `stateful_headless_service` | `bool` | `null` | Crée un service Kubernetes sans tête (`clusterIP: None`) à côté du StatefulSet, donnant à chaque pod une entrée DNS stable (par exemple, `pod-0.service.namespace.svc.cluster.local`). Requis pour les applications leader-follower ou de découverte de pairs. |
| `stateful_pod_management_policy` | `string` | `null` | Contrôle l'ordre de création et de suppression des pods. `OrderedReady` démarre/arrête les pods séquentiellement (requis pour leader-follower). `Parallel` démarre tous les pods simultanément pour une mise à l'échelle plus rapide. Par défaut à `OrderedReady`. |
| `stateful_update_strategy` | `string` | `null` | Stratégie de mise à jour pour le StatefulSet. `RollingUpdate` remplace les pods un par un lorsque le modèle change. `OnDelete` met à jour les pods uniquement lorsqu'ils sont supprimés manuellement. Par défaut à `RollingUpdate`. |
| `stateful_fs_group` | `number` | `0` | GID défini comme `fsGroup` au niveau du pod dans le contexte de sécurité du StatefulSet. Kubernetes change le propriétaire du montage PVC à ce GID lors de l'attachement, accordant au processus de l'application un accès en écriture lorsqu'il s'exécute en tant qu'UID non root. Définissez sur `0` pour laisser `fsGroup` non défini. |

### Exploration dans GCP — Groupe 7 {#exploring-in-gcp--group-7}

**Console Google Cloud :**
- **StatefulSet :** Accédez à **Kubernetes Engine → Charges de travail** et confirmez que le type de charge de travail est `StatefulSet`.
- **PersistentVolumeClaims :** Accédez à **Kubernetes Engine → Stockage → PersistentVolumeClaims** pour afficher les PVC par pod et leur état de liaison.
- **Persistent Volumes :** Accédez à **Kubernetes Engine → Stockage → PersistentVolumes** pour afficher les ressources de disque sous-jacentes.

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

> **Important :** `quota_memory_requests` et `quota_memory_limits` **doivent** utiliser des suffixes d'unité binaire (`Gi`, `Mi`) — des entiers bruts comme `"4"` sont interprétés par Kubernetes comme 4 octets et bloqueront toute planification de pod dans l'espace de noms.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_resource_quota` | `bool` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. Recommandé pour les clusters multi-locataires partagés afin d'empêcher une application de consommer des ressources illimitées. |
| `quota_cpu_requests` | `string` | `"4"` | Requêtes CPU totales autorisées pour tous les pods de l'espace de noms. Laissez vide pour ne pas appliquer de quota de requêtes CPU. Accepte la notation CPU de Kubernetes (`"4"`, `"4000m"`). |
| `quota_cpu_limits` | `string` | `"4"` | Limites CPU totales autorisées pour tous les pods de l'espace de noms. Doit être ≥ `quota_cpu_requests`. |
| `quota_memory_requests` | `string` | `"4Gi"` | Requêtes mémoire totales autorisées pour tous les pods de l'espace de noms. **Doit utiliser un suffixe d'unité binaire** (`Gi`, `Mi`). |
| `quota_memory_limits` | `string` | `"8Gi"` | Limites mémoire totales autorisées pour tous les pods de l'espace de noms. Doit être ≥ `quota_memory_requests`. **Doit utiliser un suffixe d'unité binaire** (`Gi`, `Mi`). |
| `quota_max_pods` | `string` | `"20"` | Nombre maximal de pods autorisés dans l'espace de noms. Laissez vide pour ne pas appliquer de quota de nombre de pods. |
| `quota_max_services` | `string` | `"10"` | Nombre maximal de Services Kubernetes autorisés dans l'espace de noms. |
| `quota_max_pvcs` | `string` | `"5"` | Nombre maximal de PersistentVolumeClaims autorisés dans l'espace de noms. Pertinent lorsque `workload_type` est `StatefulSet`. |

### Exploration dans GCP — Groupe 8 {#exploring-in-gcp--group-8}

**Console Google Cloud :**
- **ResourceQuota :** Accédez à **Kubernetes Engine → Workloads** et filtrez les ressources `ResourceQuota` dans l'espace de noms pour afficher l'utilisation actuelle par rapport aux limites.

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

Ces variables configurent les PodDisruptionBudgets et les TopologySpreadConstraints pour maintenir la disponibilité pendant les interruptions volontaires et distribuer les pods sur les domaines de défaillance.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Crée un PodDisruptionBudget (PDB) Kubernetes qui limite le nombre de pods pouvant être simultanément indisponibles lors d'interruptions volontaires telles que les mises à niveau de nœuds GKE Autopilot. Fortement recommandé pour les déploiements de production. |
| `pdb_min_available` | `string` | `"1"` | Nombre minimal ou pourcentage de pods qui doivent rester disponibles pendant les interruptions volontaires. Accepte un entier (`"1"`, `"2"`) ou un pourcentage (`"50%"`). **Attention :** définir `"1"` avec un déploiement à réplica unique bloque les mises à niveau de nœuds GKE — utilisez `"0"` pour les charges de travail à réplica unique où un bref temps d'arrêt pendant les mises à niveau est acceptable. |
| `enable_topology_spread` | `bool` | `false` | Ajoute des TopologySpreadConstraints Kubernetes à la spécification du pod, distribuant les pods uniformément sur les zones de nœuds GKE et les nœuds individuels. Améliore la disponibilité en empêchant tous les réplicas d'être colocalisés dans un seul domaine de défaillance. Recommandé pour les déploiements de production avec `min_instance_count > 1`. |
| `topology_spread_strict` | `bool` | `false` | Contrôle le comportement `whenUnsatisfiable` de la contrainte de répartition topologique. Lorsque `true`, les pods sont rejetés avec `DoNotSchedule` si la contrainte de répartition ne peut pas être satisfaite (nécessite ≥ 3 réplicas sur ≥ 3 zones). Lorsque `false`, utilise `ScheduleAnyway` — plus sûr pour les petits déploiements. |

### Exploration dans GCP — Groupe 9 {#exploring-in-gcp--group-9}

**Console Google Cloud :**
- **PodDisruptionBudget :** Accédez à **Kubernetes Engine → Workloads** et filtrez les ressources `PodDisruptionBudget` dans l'espace de noms.
- **Distribution des zones de pods :** Accédez à **Kubernetes Engine → Workloads → *votre déploiement* → Managed pods** pour voir sur quels nœuds/zones chaque pod s'exécute.

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

Ces variables configurent les sondes de santé Kubernetes, les tests de disponibilité Cloud Monitoring et les stratégies d'alerte.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe_config` | `object` | `{ enabled = true, path = "/healthz" }` | Sonde de démarrage Kubernetes — Kubernetes ne routra pas les requêtes vers le pod tant que cette sonde n'aura pas réussi. Sous-champs : `enabled`, `type` (`HTTP` / `TCP`), `path`, `initial_delay_seconds` (par défaut : 10), `timeout_seconds` (par défaut : 5), `period_seconds` (par défaut : 10), `failure_threshold` (par défaut : 3). Pour les applications à démarrage lent, augmentez `failure_threshold` ou `period_seconds`. |
| `health_check_config` | `object` | `{ enabled = true, path = "/healthz" }` | Sondes de vivacité **et** de disponibilité Kubernetes — une seule configuration rend les deux, sur les charges de travail Deployment **et** StatefulSet. (Les StatefulSets ne rendaient initialement aucune readinessProbe et atteignaient donc le repli Gateway `GET /` décrit ci-dessous ; `statefulset.tf` émet maintenant une readinessProbe identique sur les deux spécifications de conteneur, de sorte que ce repli ne s'applique plus. Notez que cela ne modifie pas rétroactivement la vérification de santé d'un Backend Service déjà créé.) La sonde de vivacité vérifie périodiquement si le conteneur en cours d'exécution est sain ; si elle échoue `failure_threshold` fois consécutives, Kubernetes redémarre le conteneur. La sonde de disponibilité détermine en outre si le pod reçoit du trafic, et l'API Gateway de GKE (équilibrage de charge natif des conteneurs) en dérive sa vérification de santé du Backend Service au niveau GCP — sans sonde de disponibilité, la Gateway se replie silencieusement sur un `GET /` non configurable attendant `200`, ce qui marque en permanence le backend `UNHEALTHY` pour toute application dont le chemin racine n'est pas un `200`. Les sous-champs reflètent `startup_probe_config` (`initial_delay_seconds` par défaut : 15, `timeout_seconds` par défaut : 5, `period_seconds` par défaut : 30, `failure_threshold` par défaut : 3). Le point de terminaison de santé doit répondre rapidement et ne pas effectuer d'opérations coûteuses. |
| `uptime_check_config` | `object` | `{ enabled = false, path = "/" }` | Test de disponibilité Google Cloud Monitoring qui envoie des requêtes HTTP à l'application depuis plusieurs emplacements mondiaux. Déclenche une alerte vers `support_users` si le point de terminaison devient inaccessible. Désactivé par défaut — définissez `enabled = true` pour provisionner le test. Sous-champs : `enabled`, `path`, `check_interval` (par défaut : `"60s"`), `timeout` (par défaut : `"10s"`). Actif uniquement lorsque le point de terminaison de l'application a un hôte stable et résolvable. Pour un service `LoadBalancer` avec une IP statique réservée (par défaut — voir `reserve_static_ip`), le test sonde automatiquement un **nom d'hôte `<reserved-ip>.nip.io` par défaut** ; définissez `application_domains` pour sonder votre propre domaine à la place. Un `LoadBalancer` simple à IP éphémère (c'est-à-dire `reserve_static_ip = false` sans `application_domains`) n'a pas d'hôte stable, donc le test est ignoré. |
| `alert_policies` | `list(object)` | `[]` | Stratégies d'alerte Cloud Monitoring qui déclenchent des notifications vers `support_users` lorsque les métriques Kubernetes dépassent les seuils définis. Chaque stratégie nécessite : `name`, `metric_type`, `comparison` (`COMPARISON_GT` / `COMPARISON_LT`), `threshold_value`, `duration_seconds`, `aggregation_period` (par défaut : `"60s"`). Types de métriques GKE courants : `kubernetes.io/container/cpu/usage_time`, `kubernetes.io/container/memory/used_bytes`. |

### Exploration dans GCP — Groupe 10 {#exploring-in-gcp--group-10}

**Console Google Cloud :**
- **Sondes de santé :** Accédez à **Kubernetes Engine → Workloads → *votre déploiement* → YAML** et recherchez les champs `livenessProbe`, `readinessProbe` et `startupProbe` dans la spécification du conteneur.
- **Tests de disponibilité :** Accédez à **Monitoring → Uptime checks** pour afficher les tests actifs, l'état actuel et les résultats par emplacement mondial.
- **Stratégies d'alerte :** Accédez à **Monitoring → Alerting** pour afficher les stratégies d'alerte configurées, leur état et les canaux de notification.

**kubectl / gcloud CLI :**
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

Ces variables définissent les jobs d'initialisation, les tâches planifiées récurrentes et les services supplémentaires qui s'exécutent en parallèle de la charge de travail principale de l'application.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[{ name = "db-init", … }]` | Jobs Kubernetes exécutés une fois pendant ou après le déploiement pour initialiser l'application. Utilisations courantes : migrations de schémas de base de données, chargement de données initiales, configuration de répertoires NFS. Sous-champs clés : `name`, `description`, `image`, `command`, `args`, `script_path`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `needs_db`, `needs_secrets`. Sur GKE, `execute_on_apply` contrôle uniquement si Terraform **attend** que le job se termine avant de continuer — le Job Kubernetes est créé et planifié de toute façon, donc un job dont la correction dépend du démarrage de la charge de travail principale peut toujours être en concurrence avec elle. |
| `cron_jobs` | `list(object)` | `[]` | Tâches planifiées récurrentes déployées en tant que CronJobs Kubernetes. Chaque entrée définit : `name`, `schedule` (expression cron en UTC), `image`, `command`, `args`, `env_vars`, `cpu_limit`, `memory_limit`, `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`, `mount_nfs`, `mount_gcs_volumes`, `script_path`. |
| `additional_services` | `list(object)` | `[]` | Déploiements Kubernetes supplémentaires déployés en parallèle de l'application principale dans le même espace de noms. À utiliser pour les modèles de type sidecar : workers dédiés, services proxy, consommateurs de files d'attente en arrière-plan. Chacun crée son propre Deployment, Service et HPA optionnel. Sous-champs clés : `name`, `image`, `port`, `command`, `args`, `env_vars`, `secret_env_vars` (mappe un nom de variable d'environnement à une clé dans le Secret d'application matérialisé, afin qu'un sidecar puisse lire les mêmes secrets que le conteneur principal), `cpu_limit`, `memory_limit`, `ephemeral_storage_limit`, `ephemeral_storage_request`, `min_instance_count`, `max_instance_count`, `ingress`, `service_port`, `loadbalancer_ip` (épingle un service supplémentaire `LoadBalancer` à une IP externe statique réservée, donnant une URL stable connue au moment de la planification), `extra_ports` (ports de service supplémentaires pour un conteneur écoutant sur plus d'un port sous un seul nom de service), `output_env_var_name` (injecte automatiquement l'URL du service dans l'application principale en tant que variable d'environnement), `volume_mounts`, `persistent_volume` (un PVC de stockage par blocs dédié — `size`, `mount_path`, `storage_class`, par défaut `standard-rwo` — pour un sidecar avec état ; `ReadWriteOnce`, donc le service doit rester à un seul réplica, et le PVC n'est **pas** supprimé avec le Deployment), `wait_for_rollout` (par défaut `true` ; définissez `false` uniquement lorsque le service ne peut pas devenir sain tant qu'une étape ultérieure ne s'exécute pas, ce qui bloquerait autrement l'apply — cela convertit un échec au moment de l'apply en un échec silencieux), `startup_probe`, `liveness_probe`. |

### Exploration dans GCP — Groupe 11 {#exploring-in-gcp--group-11}

**Console Google Cloud :**
- **Jobs Kubernetes :** Accédez à **Kubernetes Engine → Workloads** et filtrez par type de ressource `Job` pour afficher les jobs d'initialisation, leur état d'achèvement et leur durée.
- **CronJobs :** Accédez à **Kubernetes Engine → Workloads** et filtrez par type de ressource `CronJob` pour afficher les planifications et l'état de la dernière exécution.
- **Services supplémentaires :** Accédez à **Kubernetes Engine → Services & Ingress** pour afficher les points de terminaison des services supplémentaires.

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

Ces variables configurent les pipelines de build et de déploiement automatisés à l'aide de Cloud Build et de Cloud Deploy (facultatif).

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Interrupteur principal pour le pipeline CI/CD. Lorsque `true`, un déclencheur Cloud Build est créé qui surveille le dépôt GitHub connecté et construit et déploie automatiquement l'application lors des push de code qualifiés. |
| `github_repository_url` | `string` | `""` | URL HTTPS complète du dépôt GitHub à connecter à Cloud Build. Obligatoire lorsque `enable_cicd_trigger` est `true`. Format : `https://github.com/ORG/REPO`. |
| `github_token` | `string` | `""` | Jeton d'accès personnel GitHub utilisé pour autoriser la connexion GitHub de Cloud Build. Obligatoire lors du premier déploiement lorsque `enable_cicd_trigger` est `true`. Portées requises : `repo` et `admin:repo_hook`. Stocké dans Secret Manager après le premier déploiement et réutilisé automatiquement par la suite. |
| `github_app_installation_id` | `string` | `""` | ID d'installation de l'application GitHub Cloud Build. Préféré pour les dépôts au niveau de l'organisation. Lorsqu'il est fourni avec `github_token`, la connexion s'authentifie via l'application GitHub. |
| `cicd_trigger_config` | `object` | `{ branch_pattern = "^main$" }` | Configuration avancée pour le déclencheur Cloud Build. Sous-champs : `branch_pattern` (regex correspondant aux noms de branches), `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `bool` | `false` | Bascule le pipeline CI/CD des déploiements directs Cloud Build vers un pipeline Google Cloud Deploy géré avec des étapes de promotion. Nécessite que `enable_cicd_trigger` soit `true`. |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod]` | Liste ordonnée des étapes de promotion pour le pipeline de livraison Cloud Deploy. Chaque étape crée une cible Cloud Deploy et un espace de noms GKE associé. Sous-champs : `name`, `target_name`, `namespace`, `cluster`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `gateway_backend_stage` | `string` | `"dev"` | Étape Cloud Deploy dont le Service est ciblé par la HTTPRoute de la Gateway. Changez en `"staging"` ou `"prod"` une fois que Cloud Deploy a promu à cette étape. Ignoré lorsque `enable_cloud_deploy` est `false`. |
| `enable_binary_authorization` | `bool` | `false` | Applique la stratégie d'autorisation binaire sur le cluster GKE, exigeant que les images de conteneurs portent une attestation valide avant de pouvoir être déployées. |
| `binauthz_evaluation_mode` | `string` | `"ALWAYS_ALLOW"` | Mode d'application de la stratégie d'autorisation binaire. `ALWAYS_ALLOW` autorise toute image (à utiliser lors de la configuration initiale). `REQUIRE_ATTESTATION` applique les images signées. `ALWAYS_DENY` bloque tous les déploiements (verrouillage). Utilisé uniquement lorsque `enable_binary_authorization` est `true`. |

### Exploration dans GCP — Groupe 12 {#exploring-in-gcp--group-12}

**Console Google Cloud :**
- **Déclencheurs Cloud Build :** Accédez à **Cloud Build → Triggers** pour afficher le déclencheur, le dépôt connecté et l'état de la dernière build.
- **Historique des builds :** Accédez à **Cloud Build → History** pour afficher les builds passées, leur état et leurs logs.
- **Pipelines Cloud Deploy :** Accédez à **Cloud Deploy → Delivery Pipelines** pour afficher les étapes du pipeline, la version actuelle et l'historique des promotions.
- **Stratégie d'autorisation binaire :** Accédez à **Security → Binary Authorization** pour afficher la stratégie d'application actuelle.

**gcloud CLI / kubectl :**
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

Ces variables configurent le stockage partagé Cloud Filestore (NFS) monté dans le pod GKE en tant que volume persistant. NFS fournit un système de fichiers partagé compatible POSIX accessible simultanément par tous les réplicas de pod.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | `bool` | `true` | Lorsque `true`, un volume NFS est monté dans le pod GKE à `nfs_mount_path`. Le module découvre automatiquement une instance Filestore existante ou une VM GCE NFS dans le projet, ou provisionne une VM GCE NFS intégrée si aucune n'est trouvée. Essentiel pour les applications qui gèrent des téléchargements de fichiers partagés ou des données qui doivent persister au-delà des redémarrages de pods. |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Chemin du système de fichiers à l'intérieur du conteneur où le volume NFS est monté. Utilisé uniquement lorsque `enable_nfs` est `true`. Les fichiers écrits en dehors de ce chemin dans le système de fichiers du conteneur sont éphémères et perdus au redémarrage du pod. |
| `nfs_volume_name` | `string` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. Ne changez que lors du montage d'un deuxième partage NFS avec un nom de volume distinct. |
| `nfs_instance_name` | `string` | `""` | Nom d'une VM GCE NFS existante à laquelle se connecter directement. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou pour provisionner une VM NFS intégrée. |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Nom de base de la VM GCE NFS intégrée créée lorsqu'aucun serveur NFS existant n'est trouvé. L'ID de déploiement est automatiquement ajouté pour l'unicité. |

### Exploration dans GCP — Groupe 13 {#exploring-in-gcp--group-13}

**Console Google Cloud :**
- **Instance NFS (Filestore) :** Accédez à **Filestore → Instances** pour confirmer l'existence de l'instance, son niveau, sa capacité et son adresse IP.
- **Instance NFS (VM GCE) :** Accédez à **Compute Engine → VM Instances** et filtrez par le nom de l'instance pour confirmer qu'elle est en cours d'exécution.
- **Montage de volume NFS :** Dans le YAML de la charge de travail Kubernetes, recherchez le volume `nfs` et son `mountPath` dans la spécification du conteneur.

**kubectl / gcloud CLI :**
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

Ces variables configurent les buckets Google Cloud Storage (GCS) et les montages GCS Fuse pour l'application.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `true` | Interrupteur principal pour le provisionnement des buckets GCS. Définissez sur `false` lorsque les buckets sont gérés en externe ou doivent être partagés entre les déploiements. |
| `storage_buckets` | `list(object)` | `[]` | Buckets GCS à provisionner pour l'application. Chaque nom de bucket est automatiquement préfixé par l'ID du projet et le nom de l'application. Sous-champs par entrée : `name_suffix`, `location`, `storage_class` (`STANDARD`, `NEARLINE`, `COLDLINE`, `ARCHIVE`), `force_destroy`, `versioning_enabled`, `lifecycle_rules`, `public_access_prevention` (`"enforced"` recommandé), `uniform_bucket_level_access`, `cors`. |
| `gcs_volumes` | `list(object)` | `[]` | Buckets GCS à monter en tant que volumes de système de fichiers à l'intérieur des pods à l'aide du pilote CSI GCS Fuse. Sous-champs : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options` (par défaut : `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). Nécessite que le pilote CSI GCS Fuse soit activé sur le cluster (activé par défaut sur GKE Autopilot). |
| `manage_storage_kms_iam` | `bool` | `false` | Lorsque `true`, crée un trousseau de clés KMS CMEK et une clé de chiffrement de stockage, accorde au compte de service GCS le rôle de chiffreur/déchiffreur, et active CMEK sur tous les buckets de stockage. Peut être activé en toute sécurité lors du premier déploiement — la clé est créée automatiquement. |
| `enable_artifact_registry_cmek` | `bool` | `false` | Lorsque `true`, crée une clé KMS Artifact Registry et active le chiffrement au repos des images de conteneurs avec une clé gérée par le client. Peut être activé en toute sécurité lors du premier déploiement. |
| `max_images_to_retain` | `number` | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. Agit comme une garde de rétention. Définissez sur `0` pour désactiver. |
| `delete_untagged_images` | `bool` | `true` | Supprime automatiquement les images de conteneurs non taguées (couches orphelines) du dépôt Artifact Registry. N'affecte que les images dont la portée est le nom de l'application de ce déploiement. |
| `image_retention_days` | `number` | `30` | Nombre de jours après lesquels les images de conteneurs sont éligibles à la suppression. Les images de moins de `max_images_to_retain` jours sont toujours conservées. Définissez sur `0` pour désactiver la suppression basée sur l'âge. |

### Exploration dans GCP — Groupe 14 {#exploring-in-gcp--group-14}

**Console Google Cloud :**
- **Buckets GCS :** Accédez à **Cloud Storage → Buckets** pour confirmer que les buckets sont créés avec les noms et configurations attendus.
- **Montages GCS Fuse :** Dans le YAML de la charge de travail Kubernetes, recherchez les volumes CSI du pilote `gcsfuse.csi.storage.gke.io`.
- **Stratégies de nettoyage d'Artifact Registry :** Accédez à **Artifact Registry → Repositories → *dépôt* → Cleanup Policies**.

**kubectl / gcloud CLI :**
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

Ces variables configurent la connectivité Redis pour l'application en injectant les détails de connexion en tant que variables d'environnement dans le pod GKE.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | Lorsque `true`, injecte les variables d'environnement `REDIS_HOST` et `REDIS_PORT` dans le pod GKE. Lorsque `false`, aucune variable d'environnement Redis n'est injectée. **Définissez explicitement sur `false` pour les applications qui n'utilisent pas Redis** — la valeur par défaut `true` avec un `redis_host` vide revient à l'IP du serveur NFS, ce qui peut enregistrer des erreurs de connexion inattendues. |
| `redis_host` | `string` | `""` | Nom d'hôte ou adresse IP du serveur Redis injecté en tant que `REDIS_HOST`. Laissez vide pour utiliser par défaut l'adresse IP du serveur NFS (convient aux environnements partagés à VM unique). Définissez explicitement lors de la connexion à Google Cloud Memorystore — utilisez l'IP privée de l'instance. |
| `redis_port` | `string` | `"6379"` | Port TCP du serveur Redis injecté en tant que `REDIS_PORT`. Le port Redis standard est `6379`. |
| `redis_auth` | `string` | `""` | Mot de passe d'authentification pour le serveur Redis. Stocké dans Secret Manager et injecté de manière sécurisée — jamais stocké en texte clair. Laissez vide si l'instance Redis ne nécessite pas d'authentification. Pour Memorystore avec AUTH activé, définissez-le sur la chaîne d'authentification de l'instance. |

### Exploration dans GCP — Groupe 15 {#exploring-in-gcp--group-15}

**Console Google Cloud :**
- **Instance Memorystore Redis :** Accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et son état AUTH.
- **Variables d'environnement Redis :** Dans la spécification du pod Kubernetes (ou `kubectl exec`), confirmez que `REDIS_HOST` et `REDIS_PORT` sont présents.

**kubectl / gcloud CLI :**
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

> **Choisir le backend de base de données.** Décidez d'abord *si* vous en avez besoin : `database_type = "NONE"` ignore tout provisionnement de base de données (et les fonctionnalités dépendantes — importation de sauvegarde, SQL personnalisé, rotation automatique, le volume Cloud SQL — chacune rejetée au moment de la planification si elle est laissée activée avec `NONE`). Si vous en avez besoin, choisissez le moteur requis par votre application (`POSTGRES`/`MYSQL`, ou une variante épinglée comme `POSTGRES_15`/`MYSQL_8_0`). **Épinglez la version pour la production** — `database_type` est effectivement immuable : le modifier après le premier déploiement remplace l'instance Cloud SQL et détruit ses données. Avec une fondation `Services_GCP`, le module ne crée qu'une base de données + un utilisateur dans l'instance partagée (pas de coût d'instance par déploiement) ; seul, il provisionne une instance dédiée. L'application atteint la base de données via le proxy d'authentification Cloud SQL (`enable_cloudsql_volume`) — laissez-le activé pour les connexions socket. Les bascules de famille de moteurs (`enable_postgres_extensions`, `enable_mysql_plugins`) doivent correspondre au moteur (appliqué).

Ces variables configurent le backend de base de données Cloud SQL. Le module prend en charge PostgreSQL, MySQL et SQL Server, et peut provisionner une nouvelle instance, se connecter à une instance existante ou ignorer entièrement le provisionnement de la base de données.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | `string` | `"POSTGRES"` | Moteur de base de données Cloud SQL. `NONE` ignore le provisionnement de la base de données. Les alias génériques (`POSTGRES`, `MYSQL`) déploient la dernière version prise en charge. Les valeurs épinglées à une version (par exemple `POSTGRES_17`, `MYSQL_8_4`) sont recommandées pour la production. **Modifier cela après le déploiement initial remplace l'instance Cloud SQL et entraîne une perte de données.** |
| `sql_instance_name` | `string` | `""` | Nom d'une instance Cloud SQL existante à utiliser directement. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou pour provisionner une instance intégrée. |
| `sql_instance_base_name` | `string` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée créée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est automatiquement ajouté. |
| `application_database_name` | `string` | `"gkeappdb"` | Nom de la base de données créée dans l'instance Cloud SQL. Injecté dans le pod en tant que `DB_NAME`. **Ne jamais modifier après le déploiement initial.** |
| `application_database_user` | `string` | `"gkeappuser"` | Nom d'utilisateur de la base de données créé pour l'application. Injecté en tant que `DB_USER`. |
| `database_password_length` | `number` | `32` | Longueur du mot de passe de l'utilisateur de la base de données généré aléatoirement. Plage valide : 16–64. Les mots de passe plus longs offrent une plus grande entropie. |
| `db_password_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire pour exposer le mot de passe de la base de données en plus du `DB_PASSWORD` standard. Défini par les modules wrapper pour les applications qui attendent un nom non standard (par exemple `WORDPRESS_DB_PASSWORD`). |
| `enable_postgres_extensions` | `bool` | `false` | Active l'installation des extensions PostgreSQL listées dans `postgres_extensions` après le provisionnement de la base de données. S'applique uniquement aux types de bases de données PostgreSQL. Remarque : utilisé pour la validation des entrées uniquement lors du déploiement autonome — les extensions sont injectées à partir de la configuration du module d'application lorsqu'elles sont appelées depuis un wrapper. |
| `postgres_extensions` | `list(string)` | `[]` | Extensions PostgreSQL à installer. Nécessite `enable_postgres_extensions = true` et un `database_type` PostgreSQL. Valeurs courantes : `postgis`, `uuid-ossp`, `pg_trgm`, `pgcrypto`. |
| `enable_mysql_plugins` | `bool` | `false` | Active l'installation des plugins MySQL. S'applique uniquement aux types de bases de données MySQL. Remarque : utilisé pour la validation des entrées uniquement lors du déploiement autonome. |
| `mysql_plugins` | `list(string)` | `[]` | Plugins MySQL à installer. Nécessite `enable_mysql_plugins = true` et un `database_type` MySQL. Valeurs courantes : `audit_log`, `validate_password`. |
| `enable_auto_password_rotation` | `bool` | `false` | Active la rotation automatique du mot de passe de l'utilisateur de la base de données via un CronJob Kubernetes et un déclencheur Eventarc. La fréquence de rotation est régie par `secret_rotation_period`. S'applique uniquement lorsque `database_type` n'est pas `NONE`. |
| `rotation_propagation_delay_sec` | `number` | `90` | Secondes à attendre après l'écriture d'un nouveau mot de passe de base de données dans Secret Manager avant de redémarrer les pods GKE. Permet la réplication globale de Secret Manager. Augmentez pour les applications à forte concurrence. Utilisé uniquement lorsque `enable_auto_password_rotation` est `true`. |
| `db_host_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire pour exposer l'hôte de la base de données en plus du `DB_HOST` standard. Défini par les modules wrapper pour les applications qui attendent un nom non standard (par exemple `DB_HOSTNAME`). |
| `db_user_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire pour exposer l'utilisateur de la base de données en plus du `DB_USER` standard. (par exemple `DB_USERNAME`) |
| `db_name_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire pour exposer le nom de la base de données en plus du `DB_NAME` standard. (par exemple `DB_DATABASE`) |
| `db_port_env_var_name` | `string` | `""` | Nom de variable d'environnement supplémentaire pour exposer le port de la base de données en plus du `DB_PORT` standard. (par exemple `DB_PORT_NUMBER`) |

### Exploration dans GCP — Groupe 16 {#exploring-in-gcp--group-16}

**Console Google Cloud :**
- **Instance Cloud SQL :** Accédez à **SQL** pour confirmer l'existence de l'instance, sa version de moteur, sa région et son nom de connexion.
- **Bases de données et utilisateurs :** Cliquez sur l'instance, puis sélectionnez les onglets **Databases** et **Users**.
- **Identifiants de base de données dans Secret Manager :** Accédez à **Security → Secret Manager** et filtrez par le nom de l'application pour trouver le secret `DB_PASSWORD`.
- **Variables d'environnement de base de données sur les pods :** Utilisez `kubectl exec` pour inspecter les variables d'environnement des pods pour `DB_HOST`, `DB_NAME`, `DB_USER`.

**kubectl / gcloud CLI :**
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

Ces variables configurent la planification automatisée des sauvegardes de base de données et l'importation de sauvegarde unique.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Expression Cron définissant le moment où le Job Kubernetes de sauvegarde de base de données automatisé s'exécute. Utilise le format Cron Unix standard en UTC. Exemple : `"0 2 * * *"` pour tous les jours à 02:00 UTC. S'applique uniquement lorsque `database_type` n'est pas `NONE`. |
| `backup_retention_days` | `number` | `7` | Nombre de jours de rétention des fichiers de sauvegarde dans le bucket de sauvegarde GCS avant suppression automatique. Utilisez 7 pour le développement, 30 à 90 pour la production selon les exigences de conformité. |
| `enable_backup_import` | `bool` | `false` | Déclenche un Job Kubernetes d'importation de base de données unique pendant le déploiement, restaurant le fichier de sauvegarde spécifié par `backup_file`. **Remettez immédiatement à `false` après une restauration réussie** — le laisser à `true` écrasera la base de données en direct avec la sauvegarde obsolète à chaque déploiement ultérieur. |
| `backup_source` | `string` | `"gcs"` | Source à partir de laquelle le fichier de sauvegarde est récupéré. `gcs` importe depuis le bucket de sauvegarde GCS provisionné par le module ; `gdrive` importe depuis Google Drive. |
| `backup_file` | `string` | `"backup.sql"` | Nom du fichier de sauvegarde à importer. Doit exister dans la source configurée avant le déploiement. Exemple : `"backup-2024-01-15.sql.gz"`. |
| `backup_format` | `string` | `"sql"` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. Utilisez `auto` pour détecter à partir de l'extension de fichier. |

### Exploration dans GCP — Groupe 17 {#exploring-in-gcp--group-17}

**Console Google Cloud :**
- **CronJob de sauvegarde :** Accédez à **Kubernetes Engine → Workloads** et filtrez les ressources `CronJob` pour trouver le job de sauvegarde et sa planification.
- **Fichiers de sauvegarde (bucket GCS) :** Accédez à **Cloud Storage → Buckets** et recherchez le bucket de sauvegarde. Confirmez que les fichiers de sauvegarde sont écrits et que les règles de cycle de vie sont appliquées.
- **Job d'importation :** Accédez à **Kubernetes Engine → Workloads → Jobs** pour confirmer que le job d'importation s'est terminé avec succès après l'activation de `enable_backup_import`.

**kubectl / gcloud CLI :**
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

Ces variables permettent l'exécution de scripts SQL personnalisés sur la base de données de l'application pendant le déploiement.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | `bool` | `false` | Lorsque `true`, récupère les fichiers de script SQL du bucket GCS et du chemin configurés et les exécute sur la base de données de l'application par ordre lexicographique. Destiné aux migrations de schéma, à l'installation de procédures stockées ou au chargement de données initiales qui ne peuvent pas être gérées par le framework de migration de l'application. Concevez des scripts idempotents (pouvant être exécutés plusieurs fois sans effet secondaire). |
| `custom_sql_scripts_bucket` | `string` | `""` | Nom du bucket GCS contenant les scripts SQL. Le compte de service de la charge de travail GKE doit avoir un accès en lecture à ce bucket. Requis lorsque `enable_custom_sql_scripts` est `true`. |
| `custom_sql_scripts_path` | `string` | `""` | Préfixe de chemin dans le bucket GCS à partir duquel les scripts SQL sont récupérés. Tous les fichiers `.sql` sous ce préfixe sont exécutés par ordre lexicographique. Utilisez une convention de nommage comme `001_create_tables.sql` pour contrôler l'ordre d'exécution. |
| `custom_sql_scripts_use_root` | `bool` | `false` | Exécute les scripts SQL personnalisés en tant qu'utilisateur de base de données root au lieu de l'utilisateur de base de données de l'application. N'activez cette option que lorsque les scripts nécessitent des privilèges élevés (par exemple `CREATE EXTENSION`, `CREATE ROLE`). |

### Exploration dans GCP — Groupe 18 {#exploring-in-gcp--group-18}

**Console Google Cloud :**
- **Job de scripts SQL :** Naviguez vers **Kubernetes Engine → Workloads → Jobs** pour trouver le job de scripts SQL et consulter son historique d'exécution.
- **Fichiers de script dans GCS :** Naviguez vers **Cloud Storage → Buckets → *bucket des scripts*** pour confirmer que les fichiers `.sql` existent au préfixe de chemin configuré.

**kubectl / gcloud CLI :**
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

> **Choisir comment la charge de travail est exposée.** Le chemin d'exposition est la décision clé et couvre les groupes 19 à 21. Un simple `ClusterIP`/`LoadBalancer` `service_type` vous donne une IP brute ; un **domaine personnalisé** (Groupe 19) provisionne un certificat géré par Google via la Gateway/Ingress et nécessite un enregistrement DNS post-déploiement. **Cloud Armor (Groupe 21)** — la couche WAF/DDoS — nécessite soit un domaine personnalisé, soit un service `LoadBalancer` (appliqué au moment de la planification) car il a besoin d'un point d'entrée externe pour y attacher la politique, et **`enable_cdn` ne nécessite *pas* de domaine personnalisé** — la Gateway utilise un certificat HTTPS `<ip>.nip.io` dérivé. Pour les outils internes uniquement, préférez **IAP (Groupe 20)** — mais IAP sur GKE nécessite un ID/secret client OAuth et une adresse e-mail de support (tous appliqués), alors configurez-les avant d'activer. Décidez d'abord du modèle d'exposition, puis de la couche de sécurité qui lui convient.

## Groupe 19 — Accès et Réseau {#group-19--access--networking}

Ces variables contrôlent la configuration du domaine personnalisé, la réservation d'IP statique, les tags réseau et la sélection du réseau VPC.

> **Nom d'hôte `nip.io` par défaut.** Avec le `LoadBalancer` `service_type` et `reserve_static_ip = true` par défaut, le déploiement dérive un nom d'hôte `<reserved-ip>.nip.io` par défaut (nip.io est un DNS wildcard qui résout `<ip>.nip.io` → cette IP). Cela donne à chaque déploiement GKE par défaut un nom d'hôte fonctionnel dès le départ — utilisé comme hôte de vérification de la disponibilité de Cloud Monitoring et une URL de navigateur pratique — sans configuration DNS. Fournissez `application_domains` (avec `enable_custom_domain = true` pour le SSL de la Gateway) pour utiliser votre propre domaine ; la vérification de la disponibilité sonde alors ce domaine.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_domain` | `bool` | `false` | Provisionne une ressource Ingress de l'API Kubernetes Gateway pour acheminer le trafic en utilisant les noms d'hôtes personnalisés spécifiés dans `application_domains`. Requis pour la terminaison SSL de domaine personnalisé via Certificate Manager. |
| `application_domains` | `list(string)` | `[]` | Noms de domaine personnalisés à associer à la Gateway de l'application. Le DNS doit être configuré pour pointer chaque domaine vers l'IP de l'équilibreur de charge après le déploiement. Utilisé uniquement lorsque `enable_custom_domain` est `true`. |
| `reserve_static_ip` | `bool` | `true` | Provisionne une adresse IP externe statique pour l'équilibreur de charge. Fortement recommandé pour la production — assure une IP stable vers laquelle les enregistrements DNS peuvent pointer de manière fiable. Lorsque `false`, l'équilibreur de charge reçoit une IP éphémère qui peut changer lors d'un redéploiement. |
| `static_ip_name` | `string` | `""` | Nom personnalisé de la ressource d'adresse IP statique. Laissez vide pour une génération automatique. |
| `network_name` | `string` | `""` | Nom du réseau VPC à utiliser pour ce déploiement. Laissez vide pour découvrir automatiquement un seul réseau géré par Services GCP. Requis lorsque plus d'un réseau géré par Services GCP existe dans le projet. |
| `network_tags` | `list(string)` | `["nfsserver"]` | Tags réseau appliqués aux nœuds et pods GKE. Utilisés pour cibler les règles de pare-feu VPC. Le tag `nfsserver` par défaut est requis pour la connectivité NFS lorsque `enable_nfs` est `true`. |

### Exploration dans GCP — Groupe 19 {#exploring-in-gcp--group-19}

**Console Google Cloud :**
- **Gateway et Ingress :** Naviguez vers **Kubernetes Engine → Services & Ingress → Gateways, Ingresses & Routes** pour afficher la ressource Gateway et ses HTTPRoutes.
- **IP statique :** Naviguez vers **Réseau VPC → Adresses IP** pour confirmer que l'IP statique est réservée et son adresse.
- **Certificats SSL :** Naviguez vers **Certificate Manager → Certificats** pour afficher les certificats SSL gérés et leur état de provisionnement.
- **Configuration DNS :** Utilisez votre registraire de domaine ou Cloud DNS pour vérifier que les enregistrements `A` pointent vers l'IP de l'équilibreur de charge.

**kubectl / gcloud CLI :**
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

Ces variables configurent Identity-Aware Proxy (IAP) devant l'application en utilisant `GCPBackendPolicy` de l'API GKE Gateway. IAP nécessite une authentification par identité Google avant que les utilisateurs puissent accéder à l'application — aucune modification du code de l'application n'est nécessaire.

> **Remarque :** IAP sur GKE nécessite des identifiants OAuth 2.0 pré-créés. Contrairement à Cloud Run, ceux-ci ne peuvent pas être générés automatiquement par le module. Les deux `iap_oauth_client_id` et `iap_oauth_client_secret` doivent être créés manuellement dans **APIs & Services → Credentials** avant d'activer IAP.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | `bool` | `false` | Active Identity-Aware Proxy pour l'application via `GCPBackendPolicy` sur la Gateway. Lorsque `true`, configurez `iap_authorized_users` et `iap_authorized_groups` avant d'activer — une liste blanche vide signifie que 100 % des requêtes renvoient HTTP 403. |
| `iap_authorized_users` | `list(string)` | `[]` | Utilisateurs individuels ou comptes de service autorisés à accéder via IAP. Format : `"user:email@example.com"` ou `"serviceAccount:sa@project.iam.gserviceaccount.com"`. Actif uniquement lorsque `enable_iap` est `true`. |
| `iap_authorized_groups` | `list(string)` | `[]` | Groupes Google autorisés à accéder via IAP. Format : `"group:name@example.com"`. Préféré aux utilisateurs individuels pour la gestion de l'accès au niveau de l'équipe. Actif uniquement lorsque `enable_iap` est `true`. |
| `iap_oauth_client_id` | `string` | `""` | ID client OAuth 2.0 pour le service backend IAP. Doit être pré-créé dans la console GCP. Requis lorsque `enable_iap` est `true`. |
| `iap_oauth_client_secret` | `string` | `""` | Secret client OAuth 2.0 correspondant à `iap_oauth_client_id`. Requis lorsque `enable_iap` est `true`. Traité comme sensible. |
| `iap_support_email` | `string` | `""` | Adresse e-mail de support affichée sur l'écran de consentement OAuth. Requise lorsque `enable_iap` est `true`. Doit être une adresse e-mail ou de groupe Google valide. |

### Exploration dans GCP — Groupe 20 {#exploring-in-gcp--group-20}

**Console Google Cloud :**
- **État d'IAP :** Naviguez vers **Security → Identity-Aware Proxy** pour confirmer que le backend est listé avec IAP activé.
- **Membres autorisés :** Cliquez sur l'entrée du backend et examinez l'onglet **Principals** pour vérifier que les utilisateurs et groupes attendus ont un accès `IAP-secured Web App User`.
- **GCPBackendPolicy :** Naviguez vers **Kubernetes Engine → Workloads** et recherchez la ressource `GCPBackendPolicy` dans l'espace de noms.

**kubectl / gcloud CLI :**
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

Ces variables configurent une politique de sécurité WAF Cloud Armor attachée au backend de la Gateway GKE, et un Cloud CDN optionnel via l'équilibreur de charge de l'API Gateway.

> **Remarque :** Sur GKE, seul **Cloud CDN** est mutuellement exclusif avec IAP sur le même backend de Gateway (`iap.tf` nécessite `enable_cdn = false`). Cloud Armor ne l'est *pas* — c'est en fait la méthode recommandée pour satisfaire l'exigence HTTPS-Gateway d'IAP sans posséder de domaine, car il active la Gateway et obtient un certificat `nip.io` sans configuration.

> **Remarque sur le CDN :** La CRD `GCPBackendPolicy` n'expose pas de champ de configuration CDN. Après le déploiement avec `enable_cdn = true`, Cloud CDN doit être activé sur le service backend hors bande via `gcloud compute backend-services update --enable-cdn` ou en attachant une `GCPHTTPFilter` sur les versions GKE prises en charge.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | `bool` | `false` | Attache une politique de sécurité Cloud Armor au backend de la Gateway GKE, activant les règles WAF, la protection DDoS et les contrôles d'accès basés sur IP. Nécessite `enable_custom_domain = true` ou `service_type = "LoadBalancer"`. |
| `admin_ip_ranges` | `list(string)` | `[]` | Plages d'adresses IP CIDR exemptées des règles WAF Cloud Armor. Généralement utilisées pour les réseaux d'opérations de confiance ou les systèmes CI/CD. N'est efficace que lorsque `enable_cloud_armor` est `true`. Également utilisé comme niveau d'accès administrateur dans les périmètres VPC-SC — une liste vide entraîne l'omission du provisionnement VPC-SC avec un avertissement. |
| `cloud_armor_policy_name` | `string` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. Remplacez pour référencer une politique personnalisée. La politique intégrée inclut des règles pour SQLi, XSS, LFI, RCE et la limitation de débit (500 requêtes/min par IP). |
| `enable_cdn` | `bool` | `false` | Acheminer l'application via l'équilibreur de charge de l'API Gateway en préparation de Cloud CDN. Un domaine personnalisé n'est **pas** requis — la validation qui l'exigeait autrefois a été assouplie (`validation.tf` commentaire 20), car la Gateway provisionne HTTPS dès le départ via un certificat `<ip>.nip.io` dérivé. Voir la note ci-dessus concernant l'activation hors bande du CDN. |

### Exploration dans GCP — Groupe 21 {#exploring-in-gcp--group-21}

**Console Google Cloud :**
- **Politique Cloud Armor :** Naviguez vers **Network security → Cloud Armor policies** pour afficher la politique, ses règles et les services backend attachés.
- **Backend de l'équilibreur de charge :** Naviguez vers **Network services → Load balancing** pour confirmer que la politique Cloud Armor est attachée au backend.
- **État du CDN :** Dans les détails du backend de l'équilibreur de charge, confirmez que Cloud CDN est affiché comme activé.

**gcloud CLI :**
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

Ces variables contrôlent l'application du périmètre VPC Service Controls (VPC-SC) et la journalisation d'audit au niveau du projet.

> **Remarque :** Déployez d'abord VPC-SC en mode simulation (`vpc_sc_dry_run = true`, la valeur par défaut). Examinez les journaux de violation de la simulation avant de passer à l'application. VPC-SC nécessite une organisation GCP — les projets autonomes n'ont pas d'organisation et le périmètre est ignoré silencieusement avec un avertissement.

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | `bool` | `false` | Lorsque `true`, provisionne un périmètre VPC-SC autour des API GCP utilisées par ce module. Restreint l'accès aux API à l'intérieur du VPC et aux identités approuvées, empêchant l'exfiltration de données. Est automatiquement ignoré avec un avertissement pour les projets autonomes, les projets imbriqués dans un dossier sans `organization_id`, et les déploiements avec `admin_ip_ranges` vide. |
| `vpc_cidr_ranges` | `list(string)` | `[]` | Plages CIDR de sous-réseau VPC pour le niveau d'accès réseau VPC-SC. Lorsqu'elles sont vides, les sous-réseaux sont automatiquement découverts à partir du réseau VPC. |
| `vpc_sc_dry_run` | `bool` | `true` | Lorsque `true`, les violations VPC-SC sont journalisées mais non bloquées. Définissez sur `false` uniquement après avoir validé que les journaux de simulation sont exempts de refus involontaires. |
| `organization_id` | `string` | `""` | ID d'organisation GCP pour la politique Access Context Manager de VPC-SC. Découvert automatiquement à partir du projet lorsqu'il est vide. Doit être défini explicitement lorsque le projet est imbriqué dans un dossier. |
| `enable_audit_logging` | `bool` | `false` | Active les journaux d'audit Cloud détaillés (`DATA_READ`, `DATA_WRITE`, `ADMIN_READ`) pour tous les services GCP du projet, plus des remplacements par service pour Secret Manager et Cloud KMS. Recommandé pour les environnements sensibles à la conformité (PCI-DSS, HIPAA, SOC 2). Augmente les coûts de Cloud Logging. |

### Exploration dans GCP — Groupe 22 {#exploring-in-gcp--group-22}

**Console Google Cloud :**
- **Périmètre VPC-SC :** Naviguez vers **Security → VPC Service Controls** pour confirmer l'existence du périmètre et sa liste de services restreints.
- **Violations en mode simulation :** Naviguez vers **Logging → Logs Explorer** et filtrez par `VpcServiceControlAuditMetadata` pour identifier les appels d'API refusés.
- **Journalisation d'audit :** Naviguez vers **IAM & Admin → Audit Logs** pour confirmer que `Admin Read`, `Data Read` et `Data Write` sont activés.

**gcloud CLI :**
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

## Prérequis de déploiement et analyse des dépendances {#deployment-prerequisites--dependency-analysis}

Cette section résume toutes les dépendances externes pour le déploiement de `App GKE`. Les dépendances sont regroupées par mode de défaillance.

> **Notation :** *Auto-provisionné* signifie que le module crée automatiquement la ressource lors du premier déploiement — aucun prérequis manuel n'est nécessaire.

---

### Niveau 1 — Prérequis stricts {#tier-1--hard-prerequisites}

Ces configurations empêcheront le déploiement de réussir, ou empêcheront la charge de travail GKE d'atteindre un état sain, si le prérequis listé n'est pas satisfait.

| Fonctionnalité | Variable(s) | Exigence |
|---|---|---|
| **Références Secret Manager** | `secret_environment_variables` | Chaque secret nommé dans la carte doit exister dans Secret Manager avant le déploiement. Créez d'abord le secret, puis déployez. |
| **Scripts SQL personnalisés** | `enable_custom_sql_scripts = true` | Le bucket GCS dans `custom_sql_scripts_bucket` doit exister et tous les fichiers `.sql` doivent être téléchargés vers `custom_sql_scripts_path` avant le déploiement. |
| **Importation de sauvegarde de base de données** | `enable_backup_import = true` | Le fichier de sauvegarde nommé dans `backup_file` doit exister à la source configurée (bucket de sauvegarde GCS ou Google Drive) avant le déploiement. Un fichier manquant entraîne l'échec immédiat du job Kubernetes d'importation. |
| **Pipeline CI/CD** | `enable_cicd_trigger = true` | Un dépôt GitHub doit être accessible et soit un jeton d'accès personnel GitHub (scopes : `repo`, `admin:repo_hook`), soit un ID d'installation d'application GitHub doit être fourni. |
| **Build de conteneur personnalisé** | `container_image_source = "custom"` | Nécessite la même connexion et les mêmes identifiants de dépôt GitHub que `enable_cicd_trigger`. Cloud Build échoue si le dépôt est inaccessible. |
| **IAP** | `enable_iap = true` | ID client et secret OAuth 2.0 pré-créés à partir de **APIs & Services → Credentials**. Contrairement à Cloud Run, ceux-ci ne peuvent pas être générés automatiquement. Un écran de consentement OAuth doit exister avant que la GCPBackendPolicy puisse être créée. |
| **VPC Service Controls (projets imbriqués dans un dossier)** | `enable_vpc_sc = true` + projet imbriqué dans un dossier | `organization_id` doit être fourni explicitement pour les projets imbriqués dans un dossier — la découverte automatique est désactivée. Sans cela, le périmètre est ignoré avec un avertissement. |
| **VPC Service Controls (protection contre le verrouillage administrateur)** | `enable_vpc_sc = true` | `admin_ip_ranges` doit contenir au moins une plage CIDR. Une liste vide entraîne l'omission du périmètre pour éviter un verrouillage administrateur. |
| **GKE intégré — deuxième apply requis** | Provisionnement de cluster GKE intégré | Lors du premier déploiement d'un cluster GKE intégré, la sortie `kubernetes_ready` est `false` — le cluster est créé mais son point de terminaison n'est pas encore lisible, de sorte que toutes les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit détecter cette valeur et exécuter un deuxième déploiement pour achever le déploiement de l'application. |

---

### Niveau 2 — Défaillances silencieuses {#tier-2--silent-failures}

Ces configurations se déploient avec succès mais ne fonctionneront pas correctement à l'exécution.

| Fonctionnalité | Variable(s) | Mode de défaillance | Résolution |
|---|---|---|---|
| **Cache Redis** | `enable_redis = true` + `redis_host` explicite | `REDIS_HOST` et `REDIS_PORT` sont injectés dans le pod mais l'application ne peut pas se connecter si aucun service Redis n'existe à l'adresse spécifiée. Le déploiement réussit sans erreur. | Provisionnez une instance Cloud Memorystore ou déployez Services GCP qui fournit une instance partagée auto-découverte lorsque `redis_host` est vide. |
| **Rotation de secrets** | `secret_rotation_period` | La notification de rotation Pub/Sub se déclenche à l'intervalle configuré mais **aucune valeur de secret n'est réellement tournée**. La notification n'est qu'un déclencheur — un gestionnaire doit être implémenté séparément. | Utilisez `enable_auto_password_rotation = true` pour le mot de passe de la base de données (géré automatiquement), ou implémentez une fonction Cloud Function ou un CronJob Kubernetes séparé pour faire tourner d'autres secrets. |
| **Service mesh** | `configure_service_mesh = true` (cluster externe) | Le label d'espace de noms `istio-injection: enabled` est appliqué mais aucun plan de contrôle Istio ne le sert si ASM n'est pas en cours d'exécution sur le cluster. Les pods démarrent mais les conteneurs sidecar restent en `ContainerCreating`. | Confirmez que Cloud Service Mesh ou Anthos Service Mesh est installé et opérationnel sur le cluster cible avant d'activer. |

---

### Niveau 3 — Prérequis souples {#tier-3--soft-prerequisites}

Ces fonctionnalités se déploient avec succès mais nécessitent une étape manuelle avant d'être pleinement opérationnelles.

| Fonctionnalité | Variable(s) | Action requise |
|---|---|---|
| **Domaine personnalisé** | `application_domains` (avec `enable_custom_domain = true`) | Après le déploiement, créez des **enregistrements DNS A** pour chaque domaine pointant vers l'IP externe de l'équilibreur de charge (affichée dans les sorties de déploiement). Le provisionnement du certificat SSL géré par Google commence automatiquement après la propagation DNS et se termine généralement en 10 à 60 minutes. |
| **Cloud CDN** | `enable_cdn = true` | Après le déploiement, activez Cloud CDN sur le service backend de la Gateway hors bande : `gcloud compute backend-services update BACKEND_NAME --global --enable-cdn`. Le module ne peut pas activer le CDN lui-même en raison d'une limitation dans la CRD `GCPBackendPolicy`. |
| **Mise en scène du fichier de sauvegarde** | `enable_backup_import = true` | Le fichier de sauvegarde doit être téléchargé vers le bucket de sauvegarde GCS (ou Google Drive) avant le déploiement qui active ce drapeau. |

---

### Auparavant manuel — Maintenant auto-provisionné {#previously-manual--now-self-provisioned}

| Fonctionnalité | Variable(s) | Comment c'est géré maintenant |
|---|---|---|
| **Attestateur d'autorisation binaire, politique et clé KMS** | `enable_binary_authorization = true` | `App_Common/modules/app_security` crée de manière idempotente le trousseau de clés de signature KMS, la clé `binauthz-signer`, la note `pipeline-attestor`, l'attestateur et la politique d'autorisation binaire. Si Services GCP a provisionné ces ressources en premier, les scripts les détectent et les réutilisent. |
| **Trousseau de clés CMEK pour le chiffrement du stockage** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` crée de manière idempotente le trousseau de clés `${project_id}-cmek-keyring` et la CryptoKey `storage-key` avant l'application de la liaison IAM de stockage. Peut être activé en toute sécurité lors du premier déploiement. |
| **Périmètre VPC Service Controls** | `enable_vpc_sc = true` | `App_Common/modules/app_vpc_sc` découvre automatiquement l'ID de l'organisation, réutilise toute politique Access Context Manager existante, provisionne quatre niveaux d'accès par déploiement (VPC, IP admin, IAP, CI/CD) et crée un périmètre de service `PERIMETER_TYPE_REGULAR`. Par défaut à `vpc_sc_dry_run = true`. |

---

### Dépendance à Services GCP pour les ressources partagées {#dependency-on-services-gcp-for-shared-resources}

Services GCP est déclaré comme une dépendance de module mais n'est **pas requis** pour un déploiement autonome. Le module auto-provisionne toute l'infrastructure nécessaire en ligne lorsque Services GCP n'a pas été déployé. Cependant, le déploiement de Services GCP en premier est fortement recommandé lorsque plusieurs modules d'application partagent le même projet GCP.

| Ressource | Sans Services GCP | Avec Services GCP |
|---|---|---|
| **Réseau VPC** | Le module auto-provisionne un VPC, un sous-réseau, un Cloud NAT et un Cloud Router intégrés. | Le module se connecte au VPC partagé géré de manière centralisée. Simplifie la gestion du pare-feu et évite la consommation de quotas VPC par projet. |
| **Cluster GKE** | Le module auto-provisionne un cluster GKE Autopilot intégré utilisant `prereq_gke_subnet_cidr`. Une deuxième exécution de déploiement est requise pour déployer les ressources de l'application une fois le cluster prêt. | Le module auto-découvre et cible le cluster GKE partagé. Aucune création de cluster ni exigence de deuxième exécution. |
| **Instance Cloud SQL** | Le module auto-provisionne une instance Cloud SQL dédiée par déploiement. Chaque déploiement entraîne le coût total de l'instance. | Le module auto-découvre et se connecte à l'instance Cloud SQL partagée, ne provisionnant qu'une base de données et un utilisateur séparés à l'intérieur. Élimine le coût de l'instance par déploiement. |
| **NFS / Filestore** | Le module auto-provisionne une VM GCE NFS intégrée. Point de défaillance unique sans sauvegardes gérées. | Le module auto-découvre l'instance Filestore gérée de manière centralisée. NFS de qualité entreprise avec un débit garanti et des instantanés gérés. |
| **Redis / Memorystore** | `enable_redis = true` avec un `redis_host` vide revient à l'IP de la VM NFS. Nécessite un service compatible Redis fonctionnant sur cette VM. | Le module auto-découvre l'instance Memorystore partagée. `redis_host` peut être laissé vide. |
| **Artifact Registry** | Le module crée automatiquement un dépôt Artifact Registry par déploiement. | Le module auto-découvre et utilise le registre partagé, permettant la réutilisation d'images et une analyse cohérente des vulnérabilités entre les déploiements. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale ou violation de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

> **De nombreuses combinaisons invalides sont détectées au moment de la planification.** Le module contient 34 préconditions inter-variables dans `validation.tf`, plus des blocs `validation` par variable et 3 autres préconditions qui se trouvent à côté des ressources qu'elles protègent (`deployment.tf`, `iap.tf`, `prerequisites.tf`). Ainsi, une grande catégorie de mauvaises configurations échoue à la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée. Les lignes ci-dessous marquées **🛡 plan-time** sont rejetées d'emblée — vous n'atteignez jamais la conséquence. Les lignes non marquées sont des risques *d'exécution* ou *opérationnels* (un mauvais port, un changement de CIDR, un renommage destructeur) que le module ne peut pas décider pour vous. Un plan propre confirme que les règles de valeur/combinaison sont passées ; il ne valide pas qu'un port corresponde à votre application ou qu'un renommage soit intentionnel.

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `container_image_source` + `container_image` | `"custom"` (build à partir de la source), ou `"prebuilt"` **avec** un `container_image` non vide | **Élevé** 🛡 plan-time | `"prebuilt"` avec un `container_image` vide n'a pas d'URI d'image à déployer — maintenant rejeté au moment de la planification. |
| `mount_nfs` (jobs) + `enable_nfs` | Activer NFS lorsque tout job le monte | **Élevé** 🛡 plan-time | Un job avec `mount_nfs = true` alors que `enable_nfs = false` (et aucun serveur NFS découvrable) référence un volume qui n'existe pas — maintenant rejeté au moment de la planification. |
| `enable_postgres_extensions` / `enable_mysql_plugins` + `database_type` | Faire correspondre le commutateur à la famille de moteurs | **Moyen** 🛡 plan-time | L'activation des extensions Postgres sur un moteur MySQL (ou vice-versa) est rejetée au moment de la planification. *(Défaut corrigé : la liste blanche MySQL inclut maintenant correctement `MYSQL_8_0`, précédemment rejeté par erreur.)* |
| `redis_port` | `"6379"` | **Faible** 🛡 plan-time | Un port non numérique ou hors plage est rejeté au moment de la planification plutôt que de produire un `REDIS_PORT` inaccessible. |
| `application_name` | Court, minuscule, sûr pour les tirets (par exemple `"myapp"`, `"payments-api"`) | **Critique** | Intégré dans chaque nom de ressource GCP et Kubernetes (espace de noms, services, secrets, instance SQL, buckets GCS). **Ne jamais changer après le premier déploiement** — toutes les ressources nommées sont détruites et recréées, entraînant une perte complète de données et une nouvelle base de données vide. |
| `tenant_id` | Correspondre à l'environnement : `"prod"`, `"staging"`, `"dev"` | **Critique** | Intégré dans tous les noms de ressources avec `application_name`. **Ne jamais changer après le premier déploiement** — même conséquence que le changement de `application_name` : recréation complète des ressources, perte de données et un nouveau déploiement vide fonctionnant à côté de l'ancien orphelin. |
| `quota_memory_requests` / `quota_memory_limits` | Suffixe d'unité binaire requis : `"4Gi"`, `"8192Mi"` — jamais un entier nu | **Critique** | Un entier nu tel que `"4"` est interprété par Kubernetes comme **4 octets**. Le ResourceQuota est créé mais chaque pod est rejeté au moment de la planification avec `exceeded quota: requests.memory`. L'espace de noms est effectivement mort jusqu'à ce que le quota soit corrigé. |
| `stateful_pvc_enabled` + `workload_type` | `stateful_pvc_enabled = true` se résout automatiquement en `StatefulSet` — ne pas définir également `workload_type = "Deployment"` | **Critique** | `stateful_pvc_enabled = true` avec `workload_type = "Deployment"` échoue à la validation au moment de la planification. Terraform refuse d'appliquer. |
| `container_port` | Doit correspondre exactement à ce que le serveur d'applications lie (par exemple `8080`, `3000`, `5000`) | **Critique** | Inadéquation de port : les sondes de vivacité et de disponibilité Kubernetes échouent sur chaque pod. Tous les pods entrent dans une boucle de redémarrage `CrashLoopBackOff`. Le déploiement n'atteint jamais `Ready`. Le service est hors ligne. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` — **épingler à la valeur appliquée et ne jamais la changer** | **Critique** | Le changement après la création du cluster GKE intégré détruit et recrée le sous-réseau, ce qui force le remplacement du cluster GKE. Toutes les charges de travail sur le cluster sont perdues. Les CIDR doivent être uniques sur tous les déploiements GKE du projet — les CIDR qui se chevauchent entraînent des échecs de peering VPC. |
| `prereq_subnet_cidr_override` | `""` initialement ; **épingler à la valeur CIDR de sortie du premier déploiement** sur tous les déploiements ultérieurs | **Critique** | Laissé vide sur les déploiements ultérieurs lorsque le sous-réseau VPC intégré existe déjà : Terraform peut attribuer automatiquement un nouveau CIDR, déclenchant le remplacement du sous-réseau qui force la recréation du cluster GKE et une perte complète de données. |
| `enable_iap` + `iap_oauth_client_id` / `iap_oauth_client_secret` | Les deux identifiants OAuth doivent être pré-créés avant d'activer IAP | **Critique** | `enable_iap = true` sans `iap_oauth_client_id` et `iap_oauth_client_secret` valides : le déploiement `GCPBackendPolicy` échoue. Aucun trafic n'est acheminé. IAP sur GKE nécessite des identifiants OAuth pré-créés — contrairement à IAP Cloud Run, ceux-ci ne peuvent pas être générés automatiquement. |
| `enable_iap` + `iap_authorized_users` / `iap_authorized_groups` | Toujours renseigner au moins un utilisateur ou un groupe avant d'activer IAP | **Critique** | `enable_iap = true` avec des listes d'utilisateurs et de groupes vides : **100 % des requêtes renvoient HTTP 403**. Le service est déployé et accessible mais aucune identité n'est autorisée. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` jusqu'à ce que le pipeline CI produise des attestations valides ; puis `"REQUIRE_ATTESTATION"` | **Critique** | `"REQUIRE_ATTESTATION"` avant les attestations : **tous les déploiements de pods sont bloqués** avec `Image is not attested` dans les événements de pod. Les retours arrière d'urgence sont également bloqués. `"ALWAYS_DENY"` bloque tous les déploiements, y compris les correctifs. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | Toujours activer avec `vpc_sc_dry_run = true` d'abord ; examiner les journaux d'audit avant d'appliquer | **Critique** | `vpc_sc_dry_run = false` lors de la première activation sans validation : les pulls de nœuds GKE depuis Artifact Registry, les appels de Cloud SQL Auth Proxy et les lectures de Secret Manager peuvent tous échouer simultanément. |
| `cloud_deploy_stages` étape de production | `require_approval = true` sur l'étape de production | **Critique** | `require_approval = false` avec `auto_promote = true` en production : un déploiement de staging réussi promeut automatiquement en production sans examen humain. Une migration cassée ou une mauvaise image atteint la production automatiquement. |
| `enable_backup_import` | `false` (par défaut) — définissez `true` uniquement pour le déploiement où vous souhaitez restaurer | **Critique** | Laisser `enable_backup_import = true` après une restauration réussie : le job Kubernetes d'importation se réexécute à chaque déploiement, écrasant la base de données en direct avec le fichier de sauvegarde obsolète. **Remettez à `false` immédiatement après une restauration réussie.** |
| `session_affinity` | `"ClientIP"` pour les applications avec état nécessitant des sessions persistantes | **Élevé** | `"None"` pour une application avec état : les requêtes sont distribuées aléatoirement entre les pods, entraînant une perte de session — les utilisateurs sont déconnectés ou rencontrent des flux de travail multi-étapes interrompus. |
| `enable_pod_disruption_budget` | `true` — toujours garder activé en production | **Élevé** | `false` : lors des mises à niveau de nœuds GKE Autopilot, tous les pods peuvent être expulsés simultanément. Avec `min_instance_count = 1`, le pod unique est expulsé et l'application est totalement indisponible pendant la mise à niveau. |
| `pdb_min_available` | `"1"` pour plusieurs réplicas ; `"0"` pour les charges de travail à réplica unique | **Élevé** | `"1"` avec un déploiement à réplica unique : GKE ne peut pas vider le nœud pour les mises à niveau — le budget n'est jamais satisfaisable avec un seul pod. Les mises à niveau de nœuds sont bloquées en permanence et le cluster prend du retard sur les correctifs de sécurité. |
| `max_instance_count` | Taille à `≤ Cloud SQL max_connections / connections_per_pod` | **Élevé** | Trop élevé : épuise le pool de connexions Cloud SQL, provoquant `FATAL: sorry, too many clients already` pour tous les pods. Trop faible : limite le débit sous charge, provoquant des files d'attente de requêtes et des pics de latence. |
| `enable_network_segmentation` | `false` initialement ; activer uniquement après avoir mappé tous les flux de trafic inter-espaces de noms | **Élevé** | L'activation sans comprendre les modèles de trafic bloque la communication légitime de pod à pod. Symptômes : les connexions à la base de données expirent, les jobs d'initialisation se bloquent, les sondes de santé échouent. Déboguer avec `kubectl describe networkpolicy -n NAMESPACE`. |
| `enable_image_mirroring` | `true` (par défaut ; fortement recommandé) | **Élevé** | `false` : les nœuds GKE tirent des registres externes. Les limites de débit de Docker Hub provoquent `ErrImagePull` lors des déploiements de pointe. Dans les environnements VPC-SC, l'accès au registre externe est bloqué — tous les démarrages de pods échouent. |
| `enable_resource_quota` + `quota_memory_*` / `quota_cpu_*` | Définir les valeurs de quota ≥ somme des requêtes de tous les conteneurs dans l'espace de noms | **Élevé** | Valeurs inférieures aux requêtes de ressources agrégées de la charge de travail : les pods ne parviennent pas à être planifiés avec des événements `exceeded quota`. Les jobs d'initialisation et les CronJobs échouent également. L'espace de noms est inutilisable tant que les quotas ne sont pas augmentés. |
| `enable_auto_password_rotation` + `rotation_propagation_delay_sec` | Activer uniquement après avoir validé le pipeline de rotation ; garder `rotation_propagation_delay_sec` ≥ `90` | **Élevé** | Trop court : l'ancienne credential est révoquée avant que tous les pods ne redémarrent avec la nouvelle version. L'épuisement du pool de connexions provoque des erreurs HTTP 500 jusqu'à ce que tous les pods terminent un cycle de redémarrage. |
| `workload_type` | `"Deployment"` pour les applications sans état ; `"StatefulSet"` pour les applications nécessitant une identité de pod stable | **Élevé** | `"Deployment"` pour une charge de travail nécessitant une identité de volume persistant : les pods reçoivent différents PVC au redémarrage, entraînant une incohérence des données. `"StatefulSet"` pour une application sans état : surcharge de planification inutile et mises à jour progressives plus lentes. |
| `kubernetes_ready` sortie | Vérifier cette sortie avant de dépendre des ressources Kubernetes dans un pipeline | **Élevé** | Lors du premier déploiement d'un cluster intégré, `kubernetes_ready = false` — toutes les ressources Kubernetes sont exclues. Une **deuxième exécution de déploiement** est requise pour déployer les ressources de l'application. Ignorer laisse l'infrastructure provisionnée mais aucune application déployée. |
| `enable_topology_spread` + `topology_spread_strict` | `topology_spread_strict = false` sauf si vous avez ≥ 3 réplicas sur ≥ 3 zones | **Moyen** | `topology_spread_strict = true` avec moins de 3 réplicas ou zones : les nouveaux pods restent `Pending` indéfiniment avec des événements `FailedScheduling` faisant référence à des contraintes de topologie. |
| `enable_redis` | `false` pour les applications qui n'utilisent pas Redis | **Moyen** | Laisser `true` pour une application non-Redis : `REDIS_HOST` par défaut à l'IP du serveur NFS. Si aucun service Redis n'y est exécuté, l'application enregistre des erreurs de connexion à chaque démarrage. |
| `secret_rotation_period` | `"2592000s"` (30 jours) — doit inclure le suffixe `s` | **Moyen** | Omettre le suffixe `s` (par exemple `"2592000"`) : Secret Manager rejette la configuration au moment de l'apply. Les notifications de rotation ne sont jamais enregistrées et la rotation automatique ne se déclenche jamais. |
| `backup_retention_days` | `7` pour le développement ; `30` pour la production | **Moyen** | `1` ou `0` : presque aucune fenêtre de récupération — une erreur n'est réversible que dans les 24 heures. Trop élevé : les coûts de stockage augmentent de manière illimitée. Équilibrer en fonction de vos exigences RPO. |
| `configure_service_mesh` | `false` jusqu'à ce que ASM soit confirmé opérationnel sur le cluster | **Moyen** | L'activation sans les API Fleet/ASM requises activées : le déploiement échoue avec `API not enabled`. L'activation sur un cluster partagé sans plan de contrôle ASM en cours d'exécution : les pods démarrent mais les conteneurs sidecar restent en `ContainerCreating` indéfiniment. |

---

## Sorties {#outputs}

Le module expose les sorties suivantes après un déploiement réussi.

### Informations sur le service {#service-information}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `namespace` | Espace de noms Kubernetes où l'application est déployée |
| `service_url` | URL du service — URL externe si LoadBalancer avec IP statique, sinon URL interne du cluster |
| `service_external_ip` | IP externe du LoadBalancer (si IP statique réservée) ; `null` si non réservée |
| `service_cluster_ip` | ClusterIP du service Kubernetes de base ; `null` lorsque Cloud Deploy est actif |
| `stage_service_cluster_ips` | Mappage nom de stage → ClusterIP pour les services spécifiques au stage lorsque `enable_cloud_deploy = true` ; mappage vide sinon |
| `additional_service_urls` | Mappage des noms de services additionnels à leurs URL (IP externe du LoadBalancer si disponible, sinon URL interne du cluster) |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est disponible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier déploiement d'un cluster intégré — une deuxième exécution du déploiement est requise. |

### Base de données {#database}

| Sortie | Description |
|---|---|
| `database_instance_name` | Nom de l'instance Cloud SQL ; `null` lorsque `database_type = "NONE"` |
| `database_name` | Nom de la base de données de l'application dans l'instance |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_host` | Hôte de la base de données (`127.0.0.1` via Cloud SQL Auth Proxy) |
| `database_port` | Port de la base de données |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |

### Stockage {#storage}

| Sortie | Description |
|---|---|
| `storage_buckets` | Mappage nom logique du bucket → nom du bucket pour tous les buckets GCS provisionnés ; mappage vide lorsque `create_cloud_storage` est `false` |

### Réseau {#network}

| Sortie | Description |
|---|---|
| `network_name` | Nom du réseau VPC utilisé par le déploiement |
| `network_exists` | Indique si le réseau VPC a été trouvé (`true`/`false`) |
| `regions` | Régions GCP disponibles dans le VPC |
| `region` | Région GCP où l'application est déployée |

### NFS {#nfs}

| Sortie | Description |
|---|---|
| `nfs_server_ip` | IP interne du serveur NFS *(sensible)* ; `null` lorsque NFS est désactivé ou qu'aucun serveur n'existe |
| `nfs_mount_path` | Chemin du système de fichiers du conteneur où le volume NFS est monté |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS |

### Conteneur et registre {#container--registry}

| Sortie | Description |
|---|---|
| `container_image` | URI de l'image de conteneur entièrement qualifié utilisé par la charge de travail déployée |
| `container_registry` | Nom du dépôt Artifact Registry ; `null` lorsqu'aucune build personnalisée n'est configurée |

### Surveillance {#monitoring}

| Sortie | Description |
|---|---|
| `monitoring_enabled` | Indique si Cloud Monitoring est configuré (`true`/`false`) |
| `monitoring_notification_channels` | Liste des noms des canaux de notification Cloud Monitoring |
| `uptime_check_names` | Liste des noms des configurations de test de disponibilité |

### Métadonnées de déploiement {#deployment-metadata}

| Sortie | Description |
|---|---|
| `deployment_id` | Identifiant unique du déploiement (suffixe hexadécimal aléatoire auto-généré) |
| `tenant_id` | Identifiant du locataire dérivé de `tenant_id` |
| `resource_prefix` | Préfixe de nommage appliqué aux ressources GCP dans ce déploiement |
| `project_id` | ID du projet GCP |
| `project_number` | Numéro du projet GCP |

### Jobs {#jobs}

| Sortie | Description |
|---|---|
| `initialization_jobs` | Mappage clé du job → nom du job Kubernetes pour tous les jobs d'initialisation provisionnés |
| `cron_jobs` | Mappage clé du job → nom du CronJob Kubernetes pour tous les cron jobs provisionnés |
| `statefulset_name` | Nom du StatefulSet lorsque `workload_type = "StatefulSet"` (ou `stateful_pvc_enabled = true`) ; `null` sinon |
| `nfs_setup_job` | Nom du job Kubernetes pour le job de configuration NFS ; `null` lorsqu'il n'est pas créé |
| `db_import_job` | Nom du job Kubernetes pour le job d'importation de base de données ; `null` lorsqu'il n'est pas créé |

### CI/CD {#cicd}

| Sortie | Description |
|---|---|
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté à Cloud Build |
| `github_repository_owner` | Propriétaire / organisation du dépôt GitHub |
| `github_repository_name` | Nom du dépôt GitHub |
| `artifact_registry_repository` | Objet contenant `name`, `location` et `url` du dépôt Artifact Registry ; `null` lorsque ni la build personnalisée ni le CI/CD ne sont activés |
| `cloudbuild_trigger_name` | Nom du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` est `false` |
| `cloudbuild_trigger_id` | ID du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` est `false` |
| `cicd_configuration` | Objet avec tous les détails CI/CD (nom/ID du déclencheur, informations du dépôt, modèle de branche, URL du registre, e-mail du compte de service) ; `null` lorsqu'aucun déclencheur n'existe |

### Contrôles de service VPC {#vpc-service-controls}

| Sortie | Description |
|---|---|
| `vpc_sc_enabled` | Indique si le périmètre VPC-SC a été créé avec succès |
| `vpc_sc_perimeter_name` | Nom de la ressource du périmètre de service VPC-SC ; `null` lorsqu'il n'est pas activé |
| `vpc_sc_dry_run_mode` | `true` si VPC-SC est en mode simulation (journalisation uniquement) ; `false` si l'application est active |
| `audit_logging_enabled` | Indique si les journaux d'audit Cloud au niveau du projet sont activés |
| `artifact_registry_cmek_enabled` | Indique si le chiffrement CMEK d'Artifact Registry est configuré |

---

## Destruction des ressources {#destroying-resources}

Lors de la suppression d'un déploiement App GKE, la plateforme déclenche une suppression complète de toutes les ressources Kubernetes, de l'infrastructure GCP et des liaisons de comptes de service gérées par ce module.

**Avant d'initier la destruction :**

1.  **Comprendre le comportement de purge** — un paramètre géré par la plateforme contrôle si la destruction supprime entièrement les ressources gérées par le module ou les conserve pour protéger contre la perte accidentelle de données. Confirmez quel mode s'applique avant de détruire.
2.  **Vérifier les sauvegardes** — confirmez qu'une sauvegarde récente de la base de données existe dans le bucket de sauvegarde GCS avant de supprimer le déploiement, en particulier pour les environnements de production.
3.  **Enregistrements DNS** — si des domaines personnalisés sont configurés, supprimez les enregistrements DNS A pointant vers l'IP de l'équilibreur de charge après la suppression du déploiement pour éviter les entrées DNS obsolètes.
4.  **PVC orphelins** — pour les charges de travail StatefulSet, Kubernetes ne supprime pas automatiquement les PersistentVolumeClaims lorsqu'un StatefulSet est supprimé. La plateforme gère la suppression des PVC dans le cadre du démontage, mais vérifiez dans **Kubernetes Engine → Stockage → PersistentVolumeClaims** qu'aucun PVC ne reste après la destruction.
5.  **Cluster GKE intégré** — si un cluster intégré a été provisionné par ce déploiement (aucune dépendance Services GCP), le cluster, son VPC et toutes les ressources de sous-réseau sont supprimés. Tous les autres espaces de noms et charges de travail sur ce cluster seront également détruits. Assurez-vous qu'aucune autre charge de travail ne partage le cluster intégré avant d'initier la suppression.

**Délai connu — libération d'IP statique :**
Après la suppression du service Kubernetes LoadBalancer, GCP peut conserver l'adresse IP externe sur le sous-réseau VPC pendant 20 à 30 minutes. Si cela se produit pendant le nettoyage, attendez 20 à 30 minutes et réessayez. La deuxième tentative réussira une fois que GCP aura libéré l'adresse réservée.

<!-- related-guides -->

## Guides associés {#related-guides}

-   [Lab pratique : App GKE](../labs/App_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
-   [Module App CloudRun — Guide de configuration](App_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
-   [App Common — Guide de configuration](App_Common.md) — la configuration partagée par les deux cibles de déploiement.
