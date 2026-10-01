---
title: "Module App CloudRun — Guide de configuration"
description: "Référence de configuration pour déployer App sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/App_CloudRun.md @ 3055034 sha256:decc16fae0dd -->

# Module App CloudRun — Guide de configuration {#app-cloudrun-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/App_CloudRun.png" alt="Module App CloudRun — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `App CloudRun`, organisée en groupes fonctionnels. Pour chaque variable, il présente les options disponibles, les conséquences de chaque choix et la manière de valider la configuration obtenue dans la console Google Cloud ou avec la CLI `gcloud`.

---

## Services GCP déployés {#deployed-gcp-services}

Un déploiement `App CloudRun` entièrement configuré provisionne et intègre les services GCP suivants :

- **Cloud Run v2** — Environnement d'exécution de conteneurs serverless entièrement géré, avec mise à l'échelle automatique, répartition du trafic et gestion des révisions
- **Cloud Build** — Pipeline de build d'images de conteneur et déclencheur CI/CD connecté à GitHub
- **Artifact Registry** — Dépôt d'images de conteneur avec règles de nettoyage configurables et chiffrement CMEK facultatif
- **Cloud SQL** — Instance de base de données gérée PostgreSQL, MySQL ou SQL Server avec un sidecar Cloud SQL Auth Proxy
- **Cloud Storage (GCS)** — Buckets applicatifs avec montages GCS Fuse facultatifs dans les conteneurs Cloud Run
- **Cloud Filestore / VM GCE NFS** — Stockage NFS persistant partagé, accessible simultanément par toutes les instances Cloud Run
- **Secret Manager** — Stockage sécurisé des mots de passe de base de données, des jetons GitHub et des secrets applicatifs ; injectés dans les conteneurs sous forme de variables d'environnement
- **Cloud Monitoring** — Tests de disponibilité, règles d'alerte et canaux de notification pour `support_users`
- **Cloud Deploy** *(facultatif)* — Pipeline de livraison progressive multi-étapes avec portes de promotion et approbations manuelles facultatives
- **Cloud Armor** *(facultatif)* — Règle de sécurité WAF associée à l'équilibreur de charge HTTPS placé devant Cloud Run
- **Identity-Aware Proxy** *(facultatif)* — Authentification par identité Google appliquée au niveau de l'équilibreur de charge
- **Certificate Manager** *(facultatif)* — Certificats SSL gérés par Google pour les domaines personnalisés
- **VPC Service Controls** *(facultatif)* — Périmètre d'API limitant l'accès aux services GCP au VPC et aux identités approuvées
- **Binary Authorization** *(facultatif)* — Application d'une règle exigeant des images de conteneur attestées avant le déploiement

---

## Prérequis {#prerequisites}

Avant de déployer App CloudRun :

1. **Projet GCP** avec la facturation activée.
2. **Module Services GCP** (fournit Cloud SQL partagé, NFS partagé, Artifact Registry partagé et VPC partagé). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme le provisionne automatiquement avant votre déploiement s'il n'existe pas déjà dans le projet cible. App CloudRun peut aussi fonctionner en mode intégré entièrement autonome sans Services GCP (`require_services_gcp_module = false`), mais chaque déploiement provisionne alors son propre VPC, sa propre VM NFS et sa propre instance Cloud SQL.
3. **Autorisations IAM** : le compte de service qui déploie requiert des autorisations étendues au niveau du projet (Project Editor ou équivalent) pour créer des services Cloud Run, des utilisateurs Cloud SQL, des buckets GCS et des secrets Secret Manager.
4. Les **secrets Secret Manager** référencés dans `secret_environment_variables` doivent exister avant le déploiement — le déploiement échoue si un secret référencé est absent.
5. Pour la **CI/CD** (`enable_cicd_trigger = true`) : un dépôt GitHub et soit un Personal Access Token GitHub (portées : `repo`, `admin:repo_hook`), soit un ID d'installation de GitHub App.
6. Pour **IAP** (`enable_iap = true`) : un client OAuth 2.0 créé au préalable (ID client et secret) depuis **APIs & Services → Credentials** et un écran de consentement OAuth configuré.
7. Pour l'**import de sauvegarde** (`enable_backup_import = true`) : le fichier de sauvegarde doit être téléversé dans le bucket GCS de sauvegarde avant le déploiement.

---

## Groupe 0 — Métadonnées du module et câblage de la plateforme {#group-0--module-metadata--platform-wiring}

Ces variables sont consommées par la plateforme de déploiement plutôt que par les ressources Terraform elles-mêmes. Les variables préfixées par `module_*` (`module_storage_buckets`, `module_env_vars`, `module_secret_env_vars`, `module_writable_secret_ids`, `module_explicit_secret_values`) et `scripts_dir` sont renseignées par un module Application (wrapper) — tel que `Ghost_CloudRun` — qui appelle `App_CloudRun` comme module enfant ; elles doivent rester à leurs valeurs par défaut vides lorsque `App_CloudRun` est déployé seul. `additional_cloudrun_sa_roles` est une véritable variable fonctionnelle (elle accorde des rôles IAM supplémentaires) qui se trouve simplement dans ce groupe.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `module_description` | *(texte de présentation du module)* | Toute chaîne | Description lisible de l'objet du module, affichée dans l'interface de la plateforme. Métadonnée uniquement — ne la modifiez pas, sauf pour personnaliser le module dans un fork. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/modules/App_CloudRun"` | Chaîne d'URL | Lien vers la documentation externe de ce module, affiché dans l'interface de la plateforme comme référence d'aide. Métadonnée uniquement. |
| `module_dependency` | `["Services_GCP"]` | Liste de noms de modules | Autres modules de la plateforme qui doivent être déployés avant celui-ci. Utilisé par la plateforme pour imposer l'ordre des déploiements. Métadonnée uniquement. |
| `module_services` | `["Cloud Run", …]` | Liste de noms de services GCP | Services GCP activés ou consommés par ce module. Utilisé pour la documentation et la visibilité des services sur la plateforme. Métadonnée uniquement. |
| `credit_cost` | `0` | Entier | Crédits de la plateforme consommés lors du déploiement de ce module. Utilisé par le système de facturation de la plateforme. Métadonnée uniquement. |
| `require_credit_purchases` | `false` | `true` / `false` | Lorsque `true`, les frais de module ne peuvent être réglés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts gratuits ou des crédits d'événement. |
| `enable_purge` | `true` | `true` / `false` | Autorise la suppression complète de toutes les ressources gérées par le module lors de la destruction. Définissez `false` pour conserver les ressources après le retrait du module, afin de vous protéger contre une perte accidentelle de données. Métadonnée uniquement. |
| `public_access` | `true` | `true` / `false` | Détermine si ce module est listé publiquement dans le catalogue de la plateforme. Métadonnée uniquement. |
| `require_services_gcp_module` | `true` | `true` / `false` | Lorsque `true`, le déploiement échoue au moment du plan avec une erreur explicite si aucun réseau VPC géré par `Services_GCP` n'est détecté dans le projet. Définissez `false` pour autoriser un déploiement autonome avec des ressources prérequises intégrées. |
| `requires_services` | `{ create_postgres = true, create_network_filesystem = true, … }` | Objet de booléens `create_*` | Liste explicite des ressources provisionnées par `Services_GCP` dont ce module a besoin, indépendamment des valeurs par défaut actuelles des variables de `Services_GCP`. La plateforme lit cette liste — et non `module_services`, qui n'est qu'une liste lisible destinée à l'interface de confirmation du déploiement — pour décider quels interrupteurs `create_*` de `Services_GCP` doivent être activés lorsqu'elle provisionne automatiquement ou met à jour le déploiement `Services_GCP` partagé du projet de destination. Les clés reprennent 1:1 les noms des variables booléennes de `Services_GCP` : `create_postgres`, `create_mysql`, `create_redis`, `create_network_filesystem`, `create_filestore_nfs`, `create_google_kubernetes_engine`, `create_firestore`, `enable_alloydb`. Par défaut, `create_postgres = true` et `create_network_filesystem = true`, toutes les autres valant `false`. `create_redis` et `create_filestore_nfs` restent volontairement à `false` sur le chemin automatisé : la VM Compute Engine gratuite NFS+Redis (`create_network_filesystem`) est ce que reçoit chaque déploiement automatisé, et le passage à Cloud Memorystore/Filestore gérés est une optimisation manuelle postérieure au déploiement, et non une demande qu'une chaîne de dépendances automatisée formule d'elle-même. |
| `shared_users` | `[]` | Liste d'adresses e-mail | Utilisateurs qui peuvent voir et déployer ce module, quel que soit le paramètre `public_access`. |
| `technical_support_users` | `[]` | Liste d'adresses e-mail | Utilisateurs chargés d'assurer le support technique de ce module. Le portail de déploiement achemine les demandes de support vers ces adresses. Métadonnée uniquement. |
| `resource_creator_identity` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | E-mail de compte de service | Compte de service utilisé par Terraform pour créer et gérer les ressources. Remplacez-le par un compte de service propre au projet pour les déploiements de production. |
| `impersonation_service_account` | `""` | E-mail de compte de service | Compte de service à emprunter (emprunt d'identité) lorsque les scripts shell (découverte, mise en miroir d'images, configuration NFS) appellent les API GCP. Requis pour les déploiements inter-projets ; laissez vide pour utiliser les identifiants propres de l'exécuteur. |
| `job_execution_wait_timeout` | `900` | Entier (secondes) | Nombre maximal de secondes pendant lesquelles un déploiement attend la fin de l'exécution d'un job d'initialisation ou de configuration de la base de données avant d'abandonner. Borne les provisioners `gcloud run jobs execute --wait` afin qu'un job bloqué fasse échouer rapidement l'apply. |
| `module_storage_buckets` | `[]` | Liste d'objets de définition de bucket | Définitions de buckets GCS supplémentaires injectées par un module wrapper ; fusionnées avec `storage_buckets` à l'exécution. Laissez vide en déploiement autonome. |
| `module_env_vars` | `{}` | Map de `"VAR_NAME" = "value"` | Variables d'environnement en texte clair supplémentaires injectées par un module wrapper ; fusionnées avec `environment_variables`. Laissez vide en déploiement autonome. |
| `module_secret_env_vars` | `{}` | Map de `"VAR_NAME" = "secret-name"` | Références supplémentaires de variables d'environnement Secret Manager injectées par un module wrapper ; fusionnées avec `secret_environment_variables`. Laissez vide en déploiement autonome. |
| `module_writable_secret_ids` | `{}` | Map clé de secret → ID de secret | ID de secrets Secret Manager pour lesquels le compte de service de la charge de travail a besoin d'un accès `secretVersionAdder` (écriture). Défini par les modules applicatifs dont les hooks post-installation réécrivent des valeurs dans Secret Manager. |
| `module_explicit_secret_values` | `{}` | Map de `"VAR_NAME" = "value"` | Valeurs de secrets brutes fournies directement par un module wrapper. Les clés doivent correspondre à des entrées de `module_secret_env_vars`. Lorsqu'elles sont fournies, la recherche de la source de données Secret Manager au moment du plan est ignorée pour ces clés, ce qui permet au premier apply de réussir avant que les secrets n'existent. |
| `scripts_dir` | `""` | Chemin du système de fichiers | Répertoire contenant les scripts d'initialisation et utilitaires. Correspond par défaut au répertoire de scripts intégré du module s'il est laissé vide. À remplacer lorsqu'un module wrapper fournit des scripts personnalisés. |
| `additional_cloudrun_sa_roles` | `[]` | Liste de chaînes de rôles IAM | Rôles IAM supplémentaires accordés au compte de service Cloud Run en plus de l'ensemble standard. À utiliser lorsqu'un module applicatif requiert des autorisations GCP non incluses dans la liste de rôles de base (par ex. `roles/datastore.owner` pour la gestion des utilisateurs Firestore). |

---

## Groupe 1 — Projet et identité {#group-1--project--identity}

Ces variables établissent le contexte du projet GCP et les paramètres d'identité partagés qui s'appliquent à toutes les ressources créées par le module. Elles doivent être correctement configurées avant qu'un déploiement puisse réussir.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `project_id` | *(obligatoire)* | `[a-z][a-z0-9-]{4,28}[a-z0-9]` | ID du projet GCP dans lequel toutes les ressources seront provisionnées. Tous les prérequis GCP nécessaires (API, réseau, IAM) sont provisionnés automatiquement s'ils ne sont pas déjà présents. Vous pouvez éventuellement déployer d'abord `Services GCP` pour provisionner des ressources de plateforme partagées (telles qu'une instance Cloud SQL partagée, un serveur NFS ou un réseau VPC) que plusieurs déploiements d'un même projet peuvent ensuite réutiliser. **Tous les noms de ressources, liaisons IAM, secrets et appels d'API sont limités à ce projet.** Modifier cette valeur après le déploiement initial entraîne la recréation de toutes les ressources dans le nouveau projet. |
| `region` | `"us-central1"` | Chaîne de région GCP | Région GCP utilisée lorsqu'aucune correspondance de sous-réseau `Services GCP` ne peut être découverte automatiquement pour le projet. Remplacez-la lorsque vous déployez dans un projet dont la région principale n'est pas `us-central1` et où `Services GCP` n'a pas été déployé (ou dont les données de région ne sont pas encore propagées). Exemple : `"europe-west1"`, `"asia-northeast1"`. Sans effet lorsqu'un sous-réseau géré par `Services GCP` est découvert automatiquement, car la région est alors déduite du sous-réseau. |
| `tenant_id` | `"demo"` | `[a-z0-9-]{1,20}` | Courte étiquette ajoutée aux noms des ressources (par ex. service Cloud Run, secrets, instance SQL) pour distinguer ce déploiement des autres du même projet. Utilisez des valeurs telles que `prod`, `staging`, `dev` ou un identifiant de client/tenant. **Ne la modifiez pas après le déploiement initial** — elle est intégrée aux noms des ressources et sa modification entraîne la recréation de toutes les ressources sous de nouveaux noms, laissant les anciennes orphelines. |
| `support_users` | `[]` | Liste d'adresses e-mail | Adresses e-mail qui reçoivent les notifications d'alerte Cloud Monitoring (échecs de disponibilité, latence élevée, pics de taux d'erreur). Ces adresses sont ajoutées à un canal de notification dans Cloud Monitoring. Laissez vide pour supprimer tous les e-mails d'alerte. Ajouter des adresses ici n'accorde aucune autorisation IAM GCP. |
| `resource_labels` | `{}` | Map de paires `key = "value"` | Libellés clé-valeur appliqués à chaque ressource GCP créée par ce module (service Cloud Run, instance Cloud SQL, buckets GCS, secrets, etc.). Utilisez les libellés pour appliquer les règles d'étiquetage de votre organisation — par exemple centre de coûts, environnement, équipe propriétaire ou classification de conformité. Les libellés sont visibles dans les rapports de facturation et peuvent servir à filtrer les ressources dans la console. Les clés et valeurs de libellés GCP doivent être en minuscules, comporter de 1 à 63 caractères et peuvent contenir des lettres, des chiffres, des traits d'union et des traits de soulignement. |

### Explorer dans GCP — Groupe 1 {#exploring-in-gcp--group-1}

**Console Google Cloud :**
- **Confirmation du projet :** le nom et l'ID du projet s'affichent dans la barre de navigation supérieure. Accédez à **Home → Dashboard** pour vérifier que vous êtes dans le bon projet.
- **Libellés :** accédez à n'importe quelle ressource (par ex. **Cloud Run → Services → *votre service***) et sélectionnez l'onglet **Details** pour vérifier que les libellés sont correctement appliqués.
- **Canaux de notification d'alerte :** accédez à **Monitoring → Alerting → Notification channels** pour vérifier que les adresses e-mail des utilisateurs de support sont enregistrées.

**CLI gcloud :**
```bash
# Confirm the project exists and is active
gcloud projects describe PROJECT_ID

# List all resources in the project with a specific label
gcloud run services list --project=PROJECT_ID \
  --format="table(name,metadata.labels)"

# List Cloud Monitoring notification channels (alert recipients)
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address)"
```

---

## Groupe 2 — Identité de l'application {#group-2--application-identity}

Ces variables définissent l'identité de l'application déployée. Elles déterminent la manière dont l'application est nommée dans les services GCP, son affichage dans la console et les tableaux de bord de supervision, ainsi que la façon dont les déploiements sont versionnés et suivis.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `application_name` | `"crapp"` | `[a-z][a-z0-9-]{0,19}` (1 à 20 caractères) | Identifiant interne de l'application. Sert de nom de base pour le service Cloud Run, le dépôt Artifact Registry, les secrets Secret Manager, la base de données Cloud SQL et les buckets GCS. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des traits d'union. **Ne le modifiez pas après le déploiement initial** — il est intégré aux noms des ressources et sa modification entraîne la recréation de toutes les ressources nommées, laissant les originales orphelines. Choisissez un identifiant court et parlant, tel que `crm-app`, `payments-api` ou `customer-portal`. |
| `application_display_name` | `"App_CloudRun Application"` | Toute chaîne | Nom lisible affiché dans l'interface de la plateforme, la liste des services Cloud Run et les tableaux de bord de supervision. Contrairement à `application_name`, il peut être modifié librement à tout moment sans affecter les noms des ressources. Utilisez un titre descriptif qui aide les opérateurs à identifier le service d'un coup d'œil, par ex. `Customer Portal`, `Payment Processing API`. |
| `application_description` | `"App CloudRun Custom Application…"` | Toute chaîne | Brève description de l'objet de l'application. Reportée dans le champ de description du service Cloud Run et utilisée dans la documentation de la plateforme. Visible dans la console Cloud Run, dans les détails du service. Mettez-la à jour pour décrire précisément votre application — elle est particulièrement utile à des fins d'audit et de gouvernance lorsque plusieurs services coexistent dans le même projet. |
| `application_version` | `"1.0.0"` | Toute chaîne (par ex. `v1.2.3`, `latest`, `sha-8f2b1a`) | Tag de version appliqué à l'image de conteneur et utilisé pour le suivi des déploiements. Lorsque `container_image_source` vaut `custom`, incrémenter cette valeur déclenche une nouvelle exécution Cloud Build et crée une nouvelle image taguée dans Artifact Registry. Avec `prebuilt`, cette valeur est purement informative. Il est fortement recommandé d'adopter une convention de versionnement telle que [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) pour conserver une piste d'audit claire de ce qui est déployé. Évitez `latest` en production, car il devient alors impossible de déterminer exactement quel code s'exécute. |

### Explorer dans GCP — Groupe 2 {#exploring-in-gcp--group-2}

**Console Google Cloud :**
- **Nom du service Cloud Run :** accédez à **Cloud Run → Services** et vérifiez que le service figure dans la liste sous le nom attendu (dérivé de `application_name`).
- **Description et nom d'affichage du service :** cliquez sur le service, puis sélectionnez l'onglet **Details** pour voir la description.
- **Dépôt Artifact Registry :** accédez à **Artifact Registry → Repositories** pour vérifier qu'un dépôt nommé d'après `application_name` a été créé.
- **Versions d'image :** dans Artifact Registry, sélectionnez le dépôt pour voir toutes les versions d'image taguées et vérifier que le tag `application_version` attendu est présent.

**CLI gcloud :**
```bash
# Confirm the Cloud Run service exists and view its description
gcloud run services describe APPLICATION_NAME \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"

# List all tagged images for the application in Artifact Registry
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

## Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

Ces variables déterminent la manière dont le conteneur de l'application est obtenu, construit, déployé et mis à l'échelle sur Cloud Run. Ce sont les paramètres centraux qui définissent le comportement d'exécution de votre application.

> **Choisir l'exécution et la mise à l'échelle.** Trois décisions dominent le coût et le comportement. **Source de l'image :** `"custom"` construit l'image depuis votre dépôt via Cloud Build (nécessite la connexion GitHub) ; `"prebuilt"` déploie directement une URI d'image existante et *exige* `container_image` (vérifié au moment du plan). **Plancher de mise à l'échelle :** `min_instance_count = 0` permet le scale-to-zero — le moins cher, mais chaque requête à froid subit une pénalité de démarrage et tout état en mémoire ou sur disque local est perdu entre les requêtes ; définissez `1+` pour les applications sensibles à la latence ou avec état. `max_instance_count` est votre plafond de coût. **Environnement d'exécution :** conservez la valeur par défaut `gen2` — `gen1` ne peut pas monter NFS ni GCS Fuse (une combinaison `gen1` + `enable_nfs`/`gcs_volumes` est rejetée au moment du plan). `cpu_always_allocated` vaut `false` par défaut (facturation à la requête), de sorte que les économies du scale-to-zero sont acquises d'emblée ; définissez-le à `true` uniquement lorsqu'un travail en arrière-plan doit s'exécuter entre les requêtes (planificateurs, consommateurs de files d'attente, WebSockets).

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | Lorsque `true`, le service Cloud Run est déployé dans le cadre de cette configuration. Définissez `false` pour provisionner toute l'infrastructure de support (VPC, Cloud SQL, buckets GCS, secrets) sans déployer le conteneur de l'application. Utile pour les **workflows « infrastructure d'abord »** dans lesquels la base de données et le stockage doivent être alimentés ou configurés avant le démarrage de l'application, ou pour les déploiements progressifs dans lesquels l'infrastructure est d'abord validée indépendamment. |
| `container_image_source` | `"custom"` | `prebuilt` / `custom` | Détermine comment l'image de conteneur est obtenue. **`prebuilt`** : déploie directement une image existante depuis n'importe quel registre de conteneurs accessible (par ex. Docker Hub, Artifact Registry, GitHub Container Registry) à l'aide de l'URI indiquée dans `container_image`. Aucune étape de build n'est effectuée. À utiliser pour les images fournies par un éditeur ou construites en externe. **`custom`** : utilise Cloud Build pour construire l'image à partir du code source du dépôt GitHub connecté, selon la configuration de `container_build_config`. L'image construite est poussée dans Artifact Registry puis déployée. |
| `container_image` | `""` | URI complète d'image de conteneur | URI pleinement qualifiée de l'image de conteneur à déployer. Obligatoire lorsque `container_image_source` vaut `prebuilt`, ou lorsque `enable_image_mirroring` vaut `true` (en tant qu'image source à mettre en miroir). Exemples : `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:1.25`, `ghcr.io/my-org/my-app:latest`. Lorsque vous utilisez une image d'un registre public tel que Docker Hub, il est fortement recommandé d'activer `enable_image_mirroring` pour éviter les limitations de débit et garantir la reproductibilité. |
| `container_build_config` | `{ enabled = true }` | Objet | Configuration transmise à Cloud Build lorsque `container_image_source` vaut `custom`. Champs principaux : **`enabled`** (`true`/`false`) — définissez `false` pour ignorer entièrement l'étape de build et déployer la dernière image construite. **`dockerfile_path`** — chemin relatif du Dockerfile dans le dépôt (par défaut : `Dockerfile`). **`dockerfile_content`** — contenu du Dockerfile en ligne, sous forme de chaîne ; lorsqu'il est défini, ce contenu est écrit dans un fichier au moment du build au lieu de lire un Dockerfile depuis le dépôt. **`context_path`** — répertoire de contexte du build (par défaut : `.`). **`build_args`** — map de valeurs `ARG` transmises au build Docker (par ex. `{ ENV = "prod" }`). **`artifact_repo_name`** — nom du dépôt Artifact Registry dans lequel pousser l'image construite ; laissez vide pour utiliser le dépôt créé automatiquement et nommé d'après `application_name`. |
| `enable_image_mirroring` | `true` | `true` / `false` | Lorsque `true`, l'image indiquée dans `container_image` est copiée dans le dépôt Artifact Registry du projet avant le déploiement. **Fortement recommandé avec des images publiques externes** (Docker Hub, GitHub Container Registry, etc.) pour trois raisons : (1) évite les limites de débit de téléchargement des registres à grande échelle ; (2) garantit que l'image reste disponible même si le registre amont est indisponible ; (3) vous fournit une copie vérifiable, limitée au projet, à des fins d'audit et de conformité. Sans effet lorsque `container_image_source` vaut `custom`, car l'image est alors déjà construite dans Artifact Registry. |
| `min_instance_count` | `0` | Entier `0`–`1000` | Nombre minimal d'instances de conteneur maintenues en fonctionnement en permanence. **`0` (scale-to-zero) :** les instances sont arrêtées en l'absence de trafic, ce qui élimine les coûts de calcul au repos. En contrepartie, un délai de **démarrage à froid** (généralement de 1 à 10 secondes) s'applique à la première requête après une période d'inactivité. **`1` ou plus :** au moins une instance reste toujours chaude, ce qui élimine les démarrages à froid. Recommandé pour les applications sensibles à la latence, les API soumises à un SLA ou les services qui maintiennent des connexions à Cloud SQL ou Redis. Avec `cpu_always_allocated = false`, définir `min_instance_count` > 0 entraîne des coûts d'instance continus, même au repos. |
| `max_instance_count` | `1` | Entier `1`–`1000` | Nombre maximal d'instances de conteneur que Cloud Run est autorisé à atteindre sous charge. Sert de plafond de coût et de garde-fou contre une mise à l'échelle incontrôlée provoquée par des pics de trafic ou des attaques par déni de service. Chaque instance traite des requêtes en parallèle (par défaut, Cloud Run gère 80 requêtes simultanées par instance). **Fixez cette valeur en fonction de votre pic de trafic attendu et des limites de vos ressources en aval** — par exemple, une instance Cloud SQL a un nombre maximal de connexions, de sorte que `max_instance_count` × connexions par instance ne doit pas le dépasser. |
| `cpu_always_allocated` | `false` | `true` / `false` | **`true` :** le CPU est alloué au conteneur en permanence, même lorsqu'il ne traite aucune requête. Cela permet le traitement en arrière-plan, les tâches planifiées dans le conteneur et les connexions WebSocket. Les coûts sont engagés en continu par instance. **`false` (par défaut) :** le CPU n'est alloué que pendant le traitement des requêtes ; il est réduit quasiment à zéro entre les requêtes. Réduit le coût des charges de travail à faible trafic, mais empêche tout calcul en arrière-plan. Définissez `true` pour les applications qui exécutent des threads en arrière-plan ou maintiennent des connexions persistantes (par ex. consommateurs de files de messages). |
| `container_port` | `8080` | Entier `1`–`65535` | Port TCP sur lequel votre serveur d'application écoute à l'intérieur du conteneur. Cloud Run achemine tout le trafic HTTP(S) entrant vers ce port. **Il doit correspondre au port sur lequel votre application se lie réellement** — une incohérence fait échouer toutes les requêtes avec une erreur de connexion. Valeurs courantes : `8080` (valeur par défaut de Java, Go, Node.js), `3000` (Node.js/Express), `5000` (Flask/Python), `80` (nginx). |
| `container_protocol` | `"http1"` | `http1` / `h2c` | Version du protocole HTTP utilisée par Cloud Run pour communiquer avec votre conteneur. **`http1` :** HTTP/1.1 standard. Compatible avec tous les frameworks web. À utiliser pour les API REST, les applications web et tout service qui ne requiert pas spécifiquement HTTP/2. **`h2c` :** HTTP/2 en clair (non chiffré). À utiliser pour les **services gRPC** (qui requièrent HTTP/2) ou les services qui tirent parti du multiplexage et de la compression des en-têtes, par exemple ceux qui envoient des charges utiles volumineuses ou utilisent le streaming côté serveur. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Objet | Limites de ressources CPU et mémoire du conteneur. **`cpu_limit`** : exprimée en millicœurs — `1000m` = 1 vCPU, `2000m` = 2 vCPU. Cloud Run prend en charge `1000m`, `2000m`, `4000m`, `6000m` et `8000m`. **`memory_limit`** : exprimée en `Mi` (mébioctets) ou `Gi` (gibioctets), par ex. `512Mi`, `1Gi`, `2Gi`, `4Gi`. Cloud Run prend en charge jusqu'à `32Gi`. **Conseils de dimensionnement :** commencez avec `1000m` / `512Mi` et augmentez en fonction de l'utilisation CPU et mémoire observée dans Cloud Monitoring. Notez qu'un CPU fractionnaire (inférieur à `1000m`) n'est valide qu'avec `cpu_always_allocated = false` (facturation à la requête) ; un CPU toujours alloué requiert une valeur entière d'au moins 1 vCPU. `cpu_request` et `mem_request` sont facultatifs et prennent par défaut les valeurs des limites s'ils ne sont pas précisés. |
| `execution_environment` | `"gen2"` | `gen1` / `gen2` | Génération de l'environnement d'exécution Cloud Run. **`gen2` (recommandé) :** s'exécute dans un environnement Linux complet, prend en charge les montages de volumes NFS et GCS Fuse, des tampons réseau plus grands, et offre des temps de démarrage plus rapides. Requis lorsque `enable_nfs` ou `gcs_volumes` sont utilisés. **`gen1` :** l'environnement historique. À n'utiliser que si votre image de conteneur dépend d'un comportement propre à gen1 (par ex. certains appels système non pris en charge en gen2). Gen1 ne prend pas en charge les montages NFS. |
| `timeout_seconds` | `300` | Entier `0`–`3600` | Durée maximale, en secondes, pendant laquelle Cloud Run attend la fin d'une requête HTTP avant de renvoyer un `504 Gateway Timeout`. **Augmentez** cette valeur pour les opérations longues telles que le traitement de fichiers, les migrations de base de données, la génération de rapports ou les imports de données volumineux. **Gardez-la basse** pour les API interactives afin de détecter tôt les réponses lentes et de libérer rapidement les ressources. La valeur maximale autorisée est `3600` (1 heure). |
| `enable_cloudsql_volume` | `true` | `true` / `false` | Lorsque `true`, un sidecar Cloud SQL Auth Proxy est injecté dans le service Cloud Run. Le proxy crée un socket Unix sécurisé au chemin défini par `cloudsql_volume_mount_path`, que l'application utilise au lieu d'une connexion TCP directe. C'est la manière **recommandée et la plus sûre** de se connecter à Cloud SQL — elle utilise l'authentification IAM et chiffre la connexion sans exposer la base de données sur l'internet public. Définissez `false` uniquement si votre application se connecte à Cloud SQL directement en TCP via une adresse IP privée. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Chemin du système de fichiers | Chemin, à l'intérieur du conteneur, où le socket Unix du Cloud SQL Auth Proxy est monté. La chaîne de connexion à la base de données de votre application doit référencer ce chemin. Par exemple, une chaîne de connexion PostgreSQL serait `host=/cloudsql/PROJECT:REGION:INSTANCE`. Pertinent uniquement lorsque `enable_cloudsql_volume` vaut `true`. Ne le modifiez que si le framework de votre application attend le socket à un chemin spécifique autre que celui par défaut. |
| `traffic_split` | `[]` *(tout le trafic vers la dernière révision)* | Liste d'objets | Définit la répartition du trafic entrant entre les révisions Cloud Run. Laissez vide pour envoyer 100 % du trafic à la dernière révision (comportement par défaut). Configurez-le pour des **déploiements canary** (par ex. 90 % vers la version stable, 10 % vers la nouvelle révision) ou des **déploiements blue-green** (basculer 100 % vers une révision précise à la demande). Chaque entrée requiert : **`type`** — `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST` (dernière révision) ou `TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION` (une révision nommée). **`percent`** — pourcentage du trafic (0–100 ; la somme de toutes les entrées doit être exactement 100). **`revision`** — obligatoire lorsque le type est `REVISION` ; le nom de la révision Cloud Run. **`tag`** — tag d'URL stable facultatif (par ex. `canary`, `stable`) qui crée une URL dédiée à cette révision pour la tester avant de basculer le trafic. |
| `max_revisions_to_retain` | `7` | Entier `0`–`100` | Nombre maximal de révisions Cloud Run conservées après chaque déploiement. Après chaque déploiement, les anciennes révisions au-delà de cette limite sont supprimées automatiquement (triées de la plus ancienne à la plus récente). Les révisions qui servent activement du trafic ne sont jamais supprimées. Définissez `0` pour désactiver entièrement la suppression automatique et conserver toutes les révisions indéfiniment. Réduire cette valeur limite la consommation de quota d'API et garde la liste des révisions gérable. S'applique uniquement aux déploiements sans Cloud Deploy ; les services gérés par Cloud Deploy sont traités séparément pour chaque étape. Doit être compris entre `0` et `100`. |

### Explorer dans GCP — Groupe 3 {#exploring-in-gcp--group-3}

**Console Google Cloud :**
- **Déploiement et mise à l'échelle du service :** accédez à **Cloud Run → Services → *votre service*** pour vérifier que le service est déployé. L'onglet **Revisions** affiche toutes les révisions déployées, leur répartition du trafic et leur configuration de mise à l'échelle.
- **Image de conteneur :** l'onglet **Revisions** affiche l'URI de l'image de conteneur utilisée par chaque révision.
- **Limites de ressources et mise à l'échelle :** cliquez sur une révision et sélectionnez **Container(s)** pour voir le CPU, la mémoire, le nombre minimal/maximal d'instances et les paramètres de simultanéité.
- **Environnement d'exécution :** visible dans l'onglet **Container(s)** des détails de la révision, sous **Execution environment**.
- **Images Artifact Registry :** accédez à **Artifact Registry → Repositories → *application_name*** pour voir tous les tags d'image disponibles.

**CLI gcloud :**
```bash
# Describe the Cloud Run service and view scaling and resource config
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec,spec.traffic)"

# List all revisions and their traffic allocation
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].status,spec.containerConcurrency,metadata.annotations)"

# View the current traffic split
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="table(spec.traffic)"

# List container images in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags \
  --format="table(image,tags,createTime)"

# Confirm revision count after pruning (should be <= max_revisions_to_retain)
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --sort-by="~DEPLOYED" \
  --format="table(name,metadata.creationTimestamp)"
```

---

## Groupe 4 — Variables d'environnement et secrets {#group-4--environment-variables--secrets}

Ces variables déterminent la manière dont la configuration et les identifiants sensibles sont transmis au conteneur en cours d'exécution. Le principe clé est ici la séparation entre la **configuration en texte clair** (paramètres non sensibles injectés directement sous forme de variables d'environnement) et les **identifiants sensibles** (injectés de manière sécurisée via des références Secret Manager, jamais stockés en clair).

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `environment_variables` | `{}` | Map de `"VAR_NAME" = "value"` | Variables d'environnement en texte clair injectées dans chaque instance de conteneur au démarrage. À utiliser pour la configuration non sensible, comme les feature flags, les niveaux de journalisation, les URL de base d'API ou les paramètres de mode de l'application. Exemples : `{ LOG_LEVEL = "info", FEATURE_NEW_UI = "true", API_BASE_URL = "https://api.example.com" }`. **N'y stockez pas de mots de passe, jetons, clés d'API ni aucune valeur sensible** — ils seraient visibles dans la configuration de la révision Cloud Run et dans la configuration de la plateforme. Utilisez plutôt `secret_environment_variables` pour les valeurs sensibles. Toute modification de cette map déclenche une nouvelle révision Cloud Run. |
| `secret_environment_variables` | `{}` | Map de `"VAR_NAME" = "secret-name"` | Valeurs sensibles injectées sous forme de variables d'environnement à l'aide de références Secret Manager. La clé de la map est le nom de la variable d'environnement exposée au conteneur ; la valeur est le nom d'un secret Secret Manager existant dans le même projet. Cloud Run récupère la **dernière version active** du secret au démarrage de l'instance — la valeur en clair n'est jamais stockée dans la configuration ni dans l'état. Exemples : `{ DB_PASSWORD = "app-db-password", STRIPE_KEY = "stripe-api-key" }`. Le compte de service Cloud Run doit disposer du rôle IAM `roles/secretmanager.secretAccessor` sur chaque secret référencé (accordé automatiquement par ce module). Si un secret référencé n'existe pas, le déploiement de la révision Cloud Run échoue. |
| `service_annotations` | `{}` | Map de `"annotation-key" = "value"` | Annotations de type Kubernetes appliquées directement à la ressource de service Cloud Run. Utilisées pour des paramètres avancés de Cloud Run qui ne sont pas exposés comme options de configuration à part entière. Rarement nécessaires pour les déploiements standard. Exemple de cas d'usage : indiquer manuellement une chaîne de connexion d'instance Cloud SQL via `run.googleapis.com/cloudsql-instances`. Des annotations incorrectes peuvent empêcher le déploiement du service ; ne les utilisez donc qu'en cas de besoin précis. |
| `service_labels` | `{}` | Map de `"key" = "value"` | Libellés appliqués spécifiquement à la ressource de service Cloud Run, en plus de `resource_labels` qui s'applique à toutes les ressources. À utiliser pour l'imputation des coûts au niveau du service, le regroupement opérationnel ou les règles d'étiquetage qui ne concernent que le service Cloud Run. Exemple : `{ tier = "frontend", billing-code = "team-a" }`. Ces libellés apparaissent dans les détails du service Cloud Run et peuvent servir à filtrer les services dans la console. |
| `secret_rotation_period` | `"2592000s"` *(30 jours)* | Chaîne de durée en secondes, par ex. `"2592000s"` | Fréquence à laquelle Secret Manager publie un événement de **notification de rotation** via Pub/Sub pour inviter l'application ou un gestionnaire de rotation à mettre à jour la valeur du secret. Valeurs courantes : `"604800s"` (7 jours), `"2592000s"` (30 jours), `"7776000s"` (90 jours). **Important :** ce paramètre n'effectue pas la rotation du secret automatiquement — il ne fait que déclencher une notification. La logique de rotation proprement dite (générer une nouvelle valeur et mettre à jour le secret) doit être mise en œuvre séparément, soit via `enable_auto_password_rotation` (pour le mot de passe de la base de données), soit via une Cloud Function ou un Cloud Run Job personnalisés. S'applique à tous les secrets gérés par ce module. |
| `secret_propagation_delay` | `30` | Entier (secondes) | Nombre de secondes d'attente après la création ou la mise à jour d'un secret avant de poursuivre les opérations dépendantes (par ex. le déploiement d'une nouvelle révision Cloud Run). Secret Manager utilise une réplication globale, et un court délai garantit que la nouvelle version du secret s'est entièrement propagée dans toutes les régions avant que les instances ne tentent de la lire. **Augmentez cette valeur** (par ex. à `60` ou `90`) si vous rencontrez des échecs de déploiement avec des erreurs indiquant qu'une version de secret est introuvable, en particulier dans les déploiements multirégionaux. |

### Explorer dans GCP — Groupe 4 {#exploring-in-gcp--group-4}

**Console Google Cloud :**
- **Variables d'environnement :** accédez à **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Container(s)**. Les variables d'environnement en texte clair sont listées sous **Environment variables**. Les références de secrets sont listées séparément sous **Secrets**.
- **Secrets Secret Manager :** accédez à **Security → Secret Manager** pour voir tous les secrets, leurs versions, leurs calendriers de rotation et leurs règles d'accès.
- **Accès IAM aux secrets :** dans Secret Manager, cliquez sur un secret et sélectionnez l'onglet **Permissions** pour vérifier que le compte de service Cloud Run dispose des autorisations `Secret Accessor`.
- **Calendrier de rotation :** dans Secret Manager, cliquez sur un secret et consultez l'onglet **Overview** — la période de rotation figure sous **Rotation**.

**CLI gcloud :**
```bash
# View environment variables and secret references on the latest revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"

# List all Secret Manager secrets in the project
gcloud secrets list --project=PROJECT_ID \
  --format="table(name,createTime,replication.automatic)"

# View the rotation config for a specific secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID \
  --format="yaml(rotation,labels)"

# Confirm the Cloud Run service account has Secret Accessor access
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"

# List versions of a specific secret
gcloud secrets versions list SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"
```

---

## Groupe 5 — Observabilité et santé {#group-5--observability--health}

Ces variables configurent la manière dont Cloud Run surveille la santé de chaque instance de conteneur et dont Cloud Monitoring observe l'application de l'extérieur. Des contrôles de santé correctement configurés empêchent les instances défaillantes de servir du trafic ; les tests de disponibilité et les règles d'alerte signalent les pannes à votre équipe avant que les utilisateurs ne les remarquent.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Objet | Configure la **sonde de démarrage**, que Cloud Run utilise pour déterminer quand une instance de conteneur nouvellement démarrée est prête à recevoir du trafic. Cloud Run n'achemine aucune requête vers l'instance tant que cette sonde n'a pas réussi. Sous-champs : **`enabled`** (`true`/`false`) — à désactiver uniquement pour les conteneurs qui démarrent instantanément et n'ont pas de phase d'initialisation. **`type`** — `HTTP` (par défaut ; envoie un HTTP GET vers `path`) ou `TCP` (vérifie que le port accepte les connexions ; à utiliser en l'absence de point de terminaison HTTP). **`path`** — chemin HTTP à vérifier, par ex. `/healthz`, `/ready`, `/status`. **`initial_delay_seconds`** — secondes d'attente après le démarrage du conteneur avant la première tentative de sonde (par défaut : `10`). **`timeout_seconds`** — secondes d'attente de la réponse de la sonde avant de la considérer comme échouée (par défaut : `5`). **`period_seconds`** — intervalle entre les tentatives de sonde (par défaut : `10`). **`failure_threshold`** — nombre d'échecs consécutifs avant que l'instance ne soit considérée comme défaillante et redémarrée (par défaut : `10`). Pour les applications à démarrage lent (par ex. celles qui exécutent des migrations de base de données au démarrage), augmentez `failure_threshold` ou `period_seconds` plutôt que `initial_delay_seconds`, afin de laisser au conteneur suffisamment de temps sans bloquer le trafic trop longtemps. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Objet | Configure la **sonde de vivacité** (liveness), que Cloud Run utilise pour vérifier périodiquement qu'une instance de conteneur en cours d'exécution est toujours en bonne santé. Si la sonde échoue `failure_threshold` fois consécutives, Cloud Run redémarre automatiquement le conteneur. Les sous-champs reprennent ceux de `startup_probe_config` : **`enabled`**, **`type`** (`HTTP` / `TCP`), **`path`**, **`initial_delay_seconds`** (par défaut : `15`), **`timeout_seconds`** (par défaut : `5`), **`period_seconds`** (par défaut : `30`), **`failure_threshold`** (par défaut : `3`). **Important :** le point de terminaison de contrôle de santé doit répondre rapidement et ne doit pas effectuer d'opérations coûteuses (requêtes de base de données, appels d'API externes) — un point de terminaison de santé lent peut provoquer des redémarrages injustifiés. Il doit renvoyer `HTTP 200` lorsque l'application est en bonne santé et un code non 2xx dans le cas contraire. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Objet | Configure un **test de disponibilité Google Cloud Monitoring** qui envoie périodiquement des requêtes HTTP à l'application depuis plusieurs emplacements dans le monde (généralement 6 points de présence Google). Si l'application devient injoignable depuis une majorité d'emplacements, une alerte est déclenchée et envoyée à `support_users`. Désactivé par défaut — définissez `enabled = true` pour provisionner le test ; il n'est créé que lorsque le point de terminaison est joignable publiquement. Sous-champs : **`enabled`** (`true`/`false`). **`path`** — chemin HTTP à sonder depuis l'extérieur, par ex. `/healthz` ou `/`. **`check_interval`** — fréquence de la sonde, en secondes avec le suffixe `s` (par défaut : `"60s"` ; minimum `"60s"`). **`timeout`** — temps de réponse maximal avant que le test ne soit marqué comme échoué (par défaut : `"10s"` ; doit être inférieur à `check_interval`). Contrairement aux sondes de démarrage et de vivacité — qui sont des vérifications internes au niveau du conteneur — le test de disponibilité valide l'accessibilité de bout en bout depuis l'internet public. Il valide donc aussi le DNS, les équilibreurs de charge et, le cas échéant, les règles Cloud Armor. |
| `alert_policies` | `[]` | Liste d'objets | Liste de règles d'alerte Cloud Monitoring qui déclenchent des notifications par e-mail à `support_users` lorsque les métriques de l'application dépassent des seuils définis. Laissez vide pour ne déployer aucune règle d'alerte personnalisée. Chaque objet de règle requiert : **`name`** — un libellé descriptif pour la règle (par ex. `"high-latency"`, `"5xx-errors"`). **`metric_type`** — la métrique Cloud Monitoring à surveiller (voir les valeurs courantes ci-dessous). **`comparison`** — `COMPARISON_GT` (supérieur à) ou `COMPARISON_LT` (inférieur à). **`threshold_value`** — le seuil numérique qui déclenche l'alerte. **`duration_seconds`** — durée pendant laquelle la condition doit persister avant le déclenchement de l'alerte (utilisez `0` pour alerter immédiatement). **`aggregation_period`** — fenêtre temporelle d'agrégation de la métrique (par défaut : `"60s"`). Valeurs courantes de `metric_type` pour Cloud Run : `run.googleapis.com/request_latencies` (latence des requêtes en ms), `run.googleapis.com/request_count` (requêtes par seconde ; filtrez sur `response_code_class` pour les 5xx), `run.googleapis.com/container/cpu/utilizations` (utilisation du CPU, 0–1), `run.googleapis.com/container/memory/utilizations` (utilisation de la mémoire, 0–1). |

### Explorer dans GCP — Groupe 5 {#exploring-in-gcp--group-5}

**Console Google Cloud :**
- **Sondes de démarrage et de vivacité :** accédez à **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Container(s)**. La configuration des sondes figure sous **Health checks**.
- **Tests de disponibilité :** accédez à **Monitoring → Uptime checks** pour voir les tests actifs, leur état actuel (réussite/échec) et les derniers résultats depuis chaque emplacement dans le monde.
- **Règles d'alerte :** accédez à **Monitoring → Alerting** pour voir toutes les règles d'alerte configurées, leur état actuel (déclenchée/OK) et leurs canaux de notification.
- **Incidents :** accédez à **Monitoring → Alerting → Incidents** pour voir l'historique des déclenchements d'alertes.

**CLI gcloud :**
```bash
# View health probe configuration on the latest revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# List all uptime checks in the project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout,selectedRegions)"

# List all alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"

# View recent uptime check results (pass/fail per location)
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="value(name)" | head -1 | xargs -I{} \
  gcloud monitoring uptime get-config {} --project=PROJECT_ID
```

---

## Groupe 6 — Jobs et tâches planifiées {#group-6--jobs--scheduled-tasks}

Ces variables définissent des charges de travail qui s'exécutent aux côtés du service Cloud Run principal, mais en dehors du cycle requête-réponse. Les jobs d'initialisation s'exécutent une fois au moment du déploiement pour amorcer l'application ; les jobs cron prennent en charge les travaux récurrents en arrière-plan selon un calendrier ; les services supplémentaires déploient des services Cloud Run complémentaires dont dépend l'application principale.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", … }]` | Liste d'objets | Cloud Run Jobs exécutés **une fois pendant ou après le déploiement** pour initialiser l'application. La valeur par défaut comprend un job `db-init` qui exécute les scripts d'initialisation de la base de données. Chaque job s'exécute séquentiellement dans l'ordre de la liste, sauf si des dépendances sont précisées. Sous-champs principaux : **`name`** — identifiant unique du job (utilisé comme nom du Cloud Run Job). **`description`** — libellé lisible affiché dans la console. **`image`** — image de conteneur à utiliser pour le job ; correspond par défaut à l'image de l'application si laissée vide. **`command`** / **`args`** — commande de point d'entrée et arguments à exécuter. **`script_path`** — chemin d'un fichier de script relatif au répertoire de scripts du module ; utilisé à la place de `command`/`args` pour exécuter des scripts fournis. **`env_vars`** / **`secret_env_vars`** — variables d'environnement et références Secret Manager propres au job (même format que dans le groupe 4). **`cpu_limit`** / **`memory_limit`** — limites de ressources du conteneur du job (par défaut : `1000m` / `512Mi`). **`timeout_seconds`** — durée maximale du job (par défaut : `600`). **`max_retries`** — nombre de nouvelles tentatives en cas d'échec (par défaut : `1`). **`task_count`** — nombre de tâches parallèles (par défaut : `1` ; augmentez-le pour les charges de travail parallèles). **`mount_nfs`** — indique s'il faut monter le volume NFS (requiert `enable_nfs = true`). **`mount_gcs_volumes`** — liste des noms de volumes GCS à monter. **`depends_on_jobs`** — liste des autres jobs qui doivent se terminer avec succès avant l'exécution de celui-ci. **`execute_on_apply`** — lorsque `true`, le job est réexécuté à chaque déploiement ; lorsque `false`, il ne s'exécute qu'une fois, lors du premier déploiement. |
| `cron_jobs` | `[]` | Liste d'objets | Tâches planifiées récurrentes déployées sous forme de Cloud Run Jobs et déclenchées par **Cloud Scheduler** selon un calendrier cron. Chaque job crée une ressource Cloud Run Job et un job Cloud Scheduler qui l'invoque. Sous-champs principaux : **`name`** — identifiant unique du job. **`schedule`** — expression cron en UTC, par ex. `"0 2 * * *"` (tous les jours à 02:00 UTC), `"*/15 * * * *"` (toutes les 15 minutes), `"0 9 * * 1"` (tous les lundis à 09:00 UTC). **`image`** — image de conteneur ; correspond par défaut à l'image de l'application si laissée vide. **`command`** / **`args`** / **`script_path`** — comme pour `initialization_jobs`. **`env_vars`** / **`secret_env_vars`** — configuration et secrets propres au job. **`cpu_limit`** / **`memory_limit`** — limites de ressources (par défaut : `1000m` / `512Mi`). **`timeout_seconds`** — durée maximale (par défaut : `600`). **`max_retries`** — nouvelles tentatives en cas d'échec (par défaut : `3`). **`task_count`** / **`parallelism`** — nombre de tâches et nombre de tâches exécutées en parallèle (par défaut : `1` / `0`, ce qui signifie utiliser la valeur par défaut de Cloud Run). **`mount_nfs`** / **`mount_gcs_volumes`** — montages de volumes de stockage. **`paused`** — définissez `true` pour désactiver le déclencheur du planificateur sans supprimer la définition du job. Utile pour suspendre temporairement un job pendant une maintenance. |
| `additional_services` | `[]` | Liste d'objets | Services Cloud Run complémentaires déployés aux côtés de l'application principale. À utiliser pour les **modèles de type sidecar** dans lesquels un service distinct assure une fonction précise — par exemple un processus de travail dédié, un proxy de cache compatible Redis, un consommateur de file d'attente en arrière-plan ou une interface d'administration interne. Chaque service supplémentaire est un service Cloud Run entièrement indépendant. Sous-champs principaux : **`name`** — identifiant unique ajouté au nom de l'application (par ex. `worker` donne `APPLICATION_NAME-worker`). **`image`** — URI de l'image de conteneur (obligatoire). **`port`** — port sur lequel le service supplémentaire écoute. **`command`** / **`args`** — remplacement du point d'entrée. **`env_vars`** — variables d'environnement en texte clair pour ce service. **`cpu_limit`** / **`memory_limit`** — limites de ressources (par défaut : `1000m` / `512Mi`). **`min_instance_count`** / **`max_instance_count`** — bornes de mise à l'échelle (par défaut : `0` / `1`). **`ingress`** — restriction de la source du trafic pour ce service ; la valeur par défaut est `INGRESS_TRAFFIC_INTERNAL_ONLY`, ce qui signifie que seuls le service principal et d'autres services GCP internes peuvent l'appeler — il n'est pas accessible publiquement. **`output_env_var_name`** — si défini, l'URL de ce service supplémentaire est automatiquement injectée dans le conteneur de l'application **principale** sous forme de variable d'environnement portant ce nom, ce qui permet à l'application principale de le découvrir et de l'appeler sans URL codée en dur. **`volume_mounts`** — volumes NFS ou GCS à monter. **`startup_probe`** / **`liveness_probe`** — configuration des contrôles de santé propre à chaque service (même structure que les sondes du groupe 5). |
| `additional_containers` | `[]` | Liste d'objets | Conteneurs **sidecar dans le pod** ajoutés au **même** service Cloud Run que l'application principale (révision multi-conteneurs), partageant `localhost` et le cycle de vie du pod — à distinguer de `additional_services`, qui sont déployés comme services séparés. À utiliser lorsque l'application ou une dépendance doit être jointe via un protocole non HTTP/en boucle locale que le réseau de service à service de Cloud Run ne peut pas transporter, par ex. une base MongoDB à laquelle l'application se connecte sur `127.0.0.1:27017`. Le conteneur principal (ingress) ne démarre qu'une fois que chaque sidecar dont `startup_tcp_port` est défini a lui-même démarré. Sous-champs principaux : **`name`** — nom du conteneur sidecar. **`image`** — URI de l'image de conteneur. **`command`** / **`args`** — remplacement du point d'entrée. **`env_vars`** — variables d'environnement en texte clair pour le sidecar. **`cpu_limit`** / **`memory_limit`** — limites de ressources. **`mount_nfs`** — monte le volume Filestore partagé (requiert `enable_nfs = true`) sur `nfs_mount_path`, par ex. pour le répertoire de données d'une base de données. **`startup_tcp_port`** — port TCP que Cloud Run interroge pour déterminer que le sidecar est prêt avant de démarrer le conteneur principal. Exemple : `[{ name = "mongo", image = "mongo:7", args = ["--dbpath", "/data/db"], mount_nfs = true, nfs_mount_path = "/data/db", startup_tcp_port = 27017 }]`. |

### Explorer dans GCP — Groupe 6 {#exploring-in-gcp--group-6}

**Console Google Cloud :**
- **Jobs d'initialisation et cron :** accédez à **Cloud Run → Jobs** pour voir tous les Cloud Run Jobs, l'état de leur dernière exécution et leur historique d'exécution.
- **Historique d'exécution des jobs :** cliquez sur un job, puis sélectionnez l'onglet **Executions** pour voir chaque exécution, son état (réussie/échouée), sa durée et ses journaux.
- **Déclencheurs Cloud Scheduler :** accédez à **Cloud Scheduler** pour voir les déclencheurs des jobs cron, leur calendrier, l'heure de leur dernière exécution et leur état.
- **Services supplémentaires :** accédez à **Cloud Run → Services** — les services supplémentaires apparaissent comme des services distincts nommés `APPLICATION_NAME-ADDITIONAL_NAME`.

**CLI gcloud :**
```bash
# List all Cloud Run Jobs in the project
gcloud run jobs list \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp,status.conditions[0].type)"

# View the execution history of a specific job
gcloud run jobs executions list \
  --job=JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# Describe a specific job execution (useful for debugging failures)
gcloud run jobs executions describe EXECUTION_NAME \
  --region=REGION

# List all Cloud Scheduler jobs (cron triggers)
gcloud scheduler jobs list \
  --location=REGION \
  --format="table(name,schedule,state,lastAttemptTime,status.code)"

# Manually trigger a cron job immediately (for testing)
gcloud scheduler jobs run SCHEDULER_JOB_NAME \
  --location=REGION

# List all Cloud Run services (including additional services)
gcloud run services list \
  --region=REGION \
  --format="table(name,status.url,status.conditions[0].status)"
```

---

## Groupe 7 — CI/CD et intégration GitHub {#group-7--cicd--github-integration}

Ces variables configurent les pipelines automatisés de build et de déploiement. Le module prend en charge deux modèles de pipeline : un modèle **Cloud Build** simple, dans lequel chaque push de code admissible déclenche un build et un déploiement directement sur Cloud Run, et un modèle **Cloud Deploy** plus avancé, qui introduit un pipeline fondé sur la promotion, avec des étapes définies et des approbations manuelles facultatives entre elles.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | `true` / `false` | Interrupteur principal du pipeline CI/CD. Lorsque `true`, un déclencheur Cloud Build est créé ; il surveille le dépôt GitHub connecté et construit puis déploie automatiquement l'application lorsque du code est poussé sur la branche configurée. Requiert que `github_repository_url` et au moins l'un de `github_token` ou `github_app_installation_id` soient définis. Lorsque `false`, les déploiements doivent être déclenchés manuellement (par ex. en lançant un build depuis la console Cloud Build ou en mettant à jour `application_version`). |
| `github_repository_url` | `""` | URL HTTPS complète | URL HTTPS du dépôt GitHub à connecter à Cloud Build. Obligatoire lorsque `enable_cicd_trigger` vaut `true`. Format : `https://github.com/ORG/REPO`. Le dépôt doit être accessible avec les identifiants fournis dans `github_token` ou via la GitHub App indiquée dans `github_app_installation_id`. |
| `github_token` | `""` | Chaîne de PAT GitHub *(sensible)* | **Personal Access Token (PAT)** GitHub utilisé pour autoriser la connexion GitHub de Cloud Build. Obligatoire lors du **premier déploiement** lorsque `enable_cicd_trigger` vaut `true` — GCP utilise ce jeton pour établir la connexion. Portées requises : `repo` (accès complet au dépôt) et `admin:repo_hook` (pour créer des webhooks). **Une fois la connexion initiale établie**, le jeton est stocké dans Secret Manager et réutilisé automatiquement — vous n'avez pas besoin de le fournir à nouveau lors des déploiements suivants. Pour les dépôts d'organisation, préférez `github_app_installation_id` (authentification par GitHub App) à un PAT pour une meilleure auditabilité et une meilleure rotation des clés. Cette valeur est traitée comme sensible et n'est jamais stockée en clair. |
| `github_app_installation_id` | `""` | Chaîne numérique (par ex. `"12345678"`) | ID d'installation de la **GitHub App Cloud Build**, utilisé pour l'authentification via une GitHub App plutôt qu'un PAT. Lorsqu'il est fourni avec `github_token`, la connexion utilise l'authentification par GitHub App (à privilégier pour les dépôts d'organisation), le PAT ne servant que d'identifiant d'autorisation lors de la configuration initiale de la connexion. L'ID d'installation se trouve dans les paramètres de votre organisation GitHub sous **Installed GitHub Apps → Cloud Build → Configure**. L'authentification par GitHub App est préférable aux PAT pour les équipes, car elle rattache la connexion à l'application plutôt qu'à un compte utilisateur individuel. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Objet | Configuration fine du déclencheur Cloud Build. Sous-champs : **`branch_pattern`** — expression régulière correspondant à la ou aux branches qui déclenchent le build (par défaut : `"^main$"` ne se déclenche que sur les push vers `main` ; utilisez `"^(main\|develop)$"` pour les deux). **`included_files`** — liste de motifs de chemins de fichiers ; le build ne se déclenche que si au moins un fichier correspondant a été modifié (par ex. `["src/**", "Dockerfile"]`). Laissez vide pour déclencher sur toute modification de fichier. **`ignored_files`** — liste de motifs de chemins de fichiers à exclure du déclenchement (par ex. `["**.md", "docs/**"]`). **`trigger_name`** — nom personnalisé du déclencheur Cloud Build (généré automatiquement si vide). **`description`** — description affichée dans la console Cloud Build. **`substitutions`** — map de paires `_VARIABLE = "value"` transmises comme variables de substitution aux étapes de build Cloud Build (par ex. `{ _ENV = "prod", _REGION = "us-central1" }`). |
| `enable_cloud_deploy` | `false` | `true` / `false` | Fait passer le pipeline CI/CD de **déploiements Cloud Build directs** à un pipeline de livraison progressive géré par **Google Cloud Deploy**. Lorsque `true`, un pipeline de livraison Cloud Deploy et des cibles sont créés à partir de `cloud_deploy_stages`. Les releases sont promues d'étape en étape dans l'ordre (par ex. dev → staging → prod), avec des approbations manuelles facultatives avant la promotion. Requiert que `enable_cicd_trigger` vaille également `true` pour l'exécution automatisée du pipeline. À utiliser pour les environnements de production où vous avez besoin de déploiements multi-étapes contrôlés et audités plutôt que de déploiements directs en production. |
| `cicd_enable_cloud_deploy` | `false` | `true` / `false` | Détermine si le déclencheur Cloud Build crée des **releases Cloud Deploy** (`true`) ou met à jour directement le service Cloud Run (`false`). Définissez `true` pour que le pipeline CI/CD alimente Cloud Deploy au lieu de déployer directement. `enable_cloud_deploy` et `cicd_enable_cloud_deploy` doivent tous deux valoir `true` pour que le pipeline entièrement automatisé (build → release Cloud Deploy → promotion d'étape en étape) fonctionne de bout en bout. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | Liste d'objets | Liste ordonnée des étapes de promotion du pipeline de livraison Cloud Deploy. Chaque étape crée une cible Cloud Deploy et un service Cloud Run associé pour cet environnement. Les étapes sont promues dans l'ordre de la liste. Sous-champs principaux : **`name`** — identifiant de l'étape (par ex. `"dev"`, `"staging"`, `"prod"`) ; utilisé pour nommer la cible et le service Cloud Run. **`target_name`** — remplace le nom de la cible Cloud Deploy (par défaut `PIPELINE-NAME`). **`service_name`** — remplace le nom du service Cloud Run pour cette étape (par défaut `APPLICATION_NAME-STAGE`). **`project_id`** — déploie cette étape dans un autre projet GCP (par défaut le projet courant ; utile pour isoler la production dans un projet distinct). **`region`** — déploie cette étape dans une autre région. **`require_approval`** — lorsque `true`, une approbation manuelle est requise dans la console Cloud Deploy avant qu'une release puisse être promue vers cette étape. **Fortement recommandé pour `prod`**. **`auto_promote`** — lorsque `true`, la release est automatiquement promue vers l'étape suivante après un déploiement réussi, sans intervention manuelle. |
| `enable_binary_authorization` | `false` | `true` / `false` | Applique **Binary Authorization** au service Cloud Run, en exigeant que toutes les images de conteneur portent une attestation cryptographique valide avant de pouvoir être déployées. Cela empêche l'exécution d'images non vérifiées, non signées ou altérées. Lorsque `true`, le sous-module `app_security` du module crée automatiquement le trousseau de clés de signature KMS, l'attesteur et la règle Binary Authorization s'ils n'existent pas déjà — aucune configuration manuelle préalable n'est nécessaire. Si `Services GCP` a déjà provisionné ces ressources, elles sont détectées et réutilisées. À utiliser dans les environnements réglementés (services financiers, santé) où la sécurité de la chaîne d'approvisionnement et la provenance des images doivent être garanties. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | `ALWAYS_ALLOW` / `REQUIRE_ATTESTATION` / `ALWAYS_DENY` | Mode d'application de la règle Binary Authorization. S'applique uniquement lorsque `enable_binary_authorization` vaut `true` et que `Services GCP` n'a pas déjà configuré la règle. **`ALWAYS_ALLOW` :** autorise toute image ; utile pendant la mise en place du pipeline. **`REQUIRE_ATTESTATION` :** exige que chaque image déployée porte une signature cryptographique valide de l'attesteur du pipeline CI/CD. **`ALWAYS_DENY` :** bloque tous les déploiements ; à n'utiliser qu'en situation de verrouillage. Commencez par `ALWAYS_ALLOW`, vérifiez que votre pipeline produit des attestations valides, puis passez à `REQUIRE_ATTESTATION` pour la production. |

### Explorer dans GCP — Groupe 7 {#exploring-in-gcp--group-7}

**Console Google Cloud :**
- **Déclencheurs Cloud Build :** accédez à **Cloud Build → Triggers** pour voir le déclencheur, le dépôt connecté, le motif de branche et l'état du dernier build.
- **Historique des builds :** accédez à **Cloud Build → History** pour voir tous les builds passés, leur état, leur durée et leurs journaux.
- **Connexion GitHub :** accédez à **Cloud Build → Repositories (2nd gen)** pour vérifier que la connexion GitHub est établie et que le dépôt est associé.
- **Pipelines Cloud Deploy :** accédez à **Cloud Deploy → Delivery Pipelines** pour voir le pipeline, ses étapes, la release en cours et l'historique des promotions.
- **Approbations Cloud Deploy :** les approbations en attente apparaissent dans la console Cloud Deploy sous la cible concernée — les approbateurs reçoivent une notification par e-mail.
- **Règle Binary Authorization :** accédez à **Security → Binary Authorization** pour voir la règle d'application actuelle.

**CLI gcloud :**
```bash
# List Cloud Build triggers
gcloud builds triggers list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,github.name,github.push.branch,disabled)"

# View recent Cloud Build build history
gcloud builds list \
  --project=PROJECT_ID \
  --region=REGION \
  --limit=10 \
  --format="table(id,status,source.repoSource.branchName,createTime,duration)"

# List Cloud Deploy delivery pipelines
gcloud deploy delivery-pipelines list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,description,condition.pipelineReadyCondition.status)"

# List Cloud Deploy releases for a pipeline
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,buildArtifacts[0].tag,renderState,createTime)"

# List Cloud Deploy rollouts (promotion history per stage)
gcloud deploy rollouts list \
  --delivery-pipeline=PIPELINE_NAME \
  --release=RELEASE_NAME \
  --region=REGION \
  --format="table(name,targetId,state,deployStartTime)"

# View the Binary Authorization policy
gcloud container binauthz policy export \
  --project=PROJECT_ID
```

---

## Groupe 8 — Stockage et système de fichiers — NFS {#group-8--storage--filesystem--nfs}

> **Choisir un modèle de stockage (groupes 8 et 9).** Adaptez le type de stockage au mode d'accès. **NFS (ce groupe)** fournit un système de fichiers POSIX partagé en lecture-écriture par toutes les instances simultanément — le bon choix lorsque l'application ou ses sidecars ont besoin d'un véritable système de fichiers partagé montable (médias téléversés, répertoire de données d'une base de données dans un sidecar). **Le stockage d'objets GCS (groupe 9)** est destiné aux objets gérés par l'application et accessibles via l'API/le SDK — moins cher, extensible à l'infini, sans montage. **GCS Fuse (groupe 9)** fait le lien entre les deux : un bucket exposé comme chemin de système de fichiers, adapté aux ressources principalement lues, mais avec des réserves sur la sémantique du système de fichiers (pas de verrouillage POSIX, latence plus élevée). NFS et GCS Fuse requièrent tous deux `execution_environment = "gen2"`. Lorsqu'un socle `Services_GCP` est présent, `enable_nfs` découvre automatiquement le Filestore géré et partagé ; en mode autonome, il provisionne une VM NFS intégrée unique (un point de défaillance unique) — préférez le socle pour tout usage en production.

Ces variables configurent un stockage partagé **Network File System (NFS)** pour l'application, reposant sur Google Cloud Filestore. NFS fournit un système de fichiers partagé conforme à POSIX, accessible simultanément par toutes les instances Cloud Run, ce qui le rend adapté aux charges de travail qui nécessitent un état persistant partagé entre plusieurs instances de conteneur — comme les fichiers multimédias téléversés par les utilisateurs, les caches partagés ou les données applicatives qui doivent survivre aux redémarrages des conteneurs.

> **Prérequis :** les montages de volumes NFS requièrent que `execution_environment` soit défini sur `gen2`. Gen1 ne prend pas en charge les montages NFS.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | Lorsque `true`, un volume NFS est monté dans le service Cloud Run au chemin défini par `nfs_mount_path`. Le module utilise une instance Filestore existante si elle est découverte dans le projet (soit nommée via `nfs_instance_name`, soit découverte automatiquement à partir d'un déploiement `Services GCP`). Une VM GCE NFS intégrée n'est créée **que lorsqu'aucun déploiement `Services GCP` n'existe dans le projet** — si `Services GCP` est présent mais a été déployé sans NFS (`create_network_filesystem = false`), le plan échoue avec une erreur vous invitant à redéployer `Services GCP` avec NFS activé, plutôt que de créer une VM intégrée en conflit. **NFS fournit un stockage persistant partagé** — les fichiers écrits par une instance sont immédiatement visibles par toutes les autres. C'est indispensable pour les applications qui gèrent des téléversements de fichiers, une configuration partagée ou toute donnée devant persister au-delà de la durée de vie d'un conteneur. Définissez `false` si votre application est entièrement sans état ou utilise GCS/Cloud SQL pour toute la persistance. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin du système de fichiers | Chemin, à l'intérieur du conteneur, où le volume NFS est monté. Votre application lit et écrit les fichiers partagés dans ce répertoire. Le chemin ne doit entrer en conflit avec aucun répertoire utilisé par l'image de conteneur elle-même. Choix courants : `/mnt/nfs`, `/data`, `/shared`, `/app/storage`. Utilisé uniquement lorsque `enable_nfs` vaut `true`. Assurez-vous que votre application est configurée pour lire et écrire dans ce chemin — les fichiers écrits ailleurs dans le système de fichiers du conteneur sont éphémères et perdus au redémarrage de l'instance. |
| `nfs_volume_name` | `"nfs-data-volume"` | Chaîne | Nom du volume Kubernetes/Cloud Run utilisé pour le montage NFS. Modifiez-le lorsqu'un déploiement nécessite un second partage NFS avec un nom de volume distinct — par exemple pour séparer un volume de médias (`nfs-media-volume`) d'un volume de données. Les jobs qui montent ce partage NFS référencent le volume par ce nom dans leur configuration `mount_nfs`. Pertinent uniquement lorsque `enable_nfs` vaut `true`. |
| `nfs_instance_name` | `""` *(découverte automatique)* | Chaîne | Nom d'un serveur NFS existant précis (VM GCE) auquel se connecter. Lorsqu'il est défini, le module cible directement cette instance et ignore la découverte automatique. Laissez vide pour permettre au module de découvrir automatiquement une instance NFS gérée par `Services GCP` dans le projet, ou de créer une nouvelle VM NFS intégrée lorsqu'aucun déploiement `Services GCP` n'existe dans le projet. À utiliser lorsque le projet comporte plusieurs serveurs NFS et que vous devez contrôler explicitement celui auquel ce déploiement se connecte, ou lorsque la découverte automatique sélectionnerait la mauvaise instance. |
| `nfs_instance_base_name` | `"app-nfs"` | Chaîne | Nom de base d'une nouvelle VM GCE NFS intégrée, créée lorsqu'aucun serveur NFS existant n'est trouvé dans le projet. L'ID de déploiement est ajouté automatiquement pour garantir l'unicité (par ex. `app-nfs-prod`). Ne le modifiez que si le nom par défaut entre en conflit avec une ressource existante ou si votre convention de nommage exige un préfixe différent. Pertinent uniquement lorsqu'aucune instance NFS existante n'est découverte et que le module doit en provisionner une. |

### Explorer dans GCP — Groupe 8 {#exploring-in-gcp--group-8}

**Console Google Cloud :**
- **Instance NFS (Filestore) :** si vous utilisez Cloud Filestore, accédez à **Filestore → Instances** pour vérifier que l'instance existe, ainsi que son niveau, sa capacité et son adresse IP.
- **Instance NFS (VM GCE) :** si vous utilisez une VM GCE NFS, accédez à **Compute Engine → VM Instances** et filtrez par nom d'instance pour vérifier qu'elle est en cours d'exécution.
- **Montage du volume sur Cloud Run :** accédez à **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Volumes** pour vérifier que le volume NFS est listé et monté au chemin attendu.
- **Test de connectivité NFS :** consultez les journaux Cloud Run (**Cloud Run → Services → *votre service* → Logs**) pour repérer d'éventuelles erreurs de montage NFS au démarrage du conteneur.

**CLI gcloud :**
```bash
# List Filestore instances in the project
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,networks[0].ipAddresses[0],fileShares[0].capacityGb,state)"

# Describe a specific Filestore instance
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID

# List GCE VM instances (for inline NFS VMs)
gcloud compute instances list \
  --project=PROJECT_ID \
  --filter="name:nfs" \
  --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# View volume configuration on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes,spec.template.spec.containers[0].volumeMounts)"

# View Cloud Run startup logs to check for NFS mount errors
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

---

## Groupe 9 — Stockage, système de fichiers et registre d'images {#group-9--storage-filesystem--image-registry}

Ces variables configurent **Google Cloud Storage (GCS)** et la gestion du cycle de vie des images **Artifact Registry** pour l'application. GCS offre deux modes d'intégration distincts : le **stockage d'objets** standard (buckets que l'application lit et écrit via l'API GCS ou les bibliothèques clientes) et les montages **GCS Fuse** (buckets exposés comme chemin de système de fichiers POSIX directement dans le conteneur). Une option de chiffrement KMS est disponible pour les buckets qui requièrent des clés de chiffrement gérées par le client. Les variables de règles de nettoyage d'Artifact Registry, à la fin de ce groupe, régissent la suppression automatique des images dans le dépôt créé en mode intégré.

> **Prérequis :** les montages de volumes GCS Fuse requièrent que `execution_environment` soit défini sur `gen2`.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `create_cloud_storage` | `true` | `true` / `false` | Interrupteur principal du provisionnement des buckets GCS. Lorsque `true`, tous les buckets définis dans `storage_buckets` sont créés. Définissez `false` lorsque les buckets sont gérés en externe, existent déjà, ou lorsque ce déploiement doit partager des buckets provisionnés par un autre module ou déploiement (par ex. un déploiement `Services GCP` partagé). Lorsque `false`, la variable `storage_buckets` est ignorée, mais `gcs_volumes` peut toujours référencer des buckets gérés en externe. |
| `storage_buckets` | `[]` | Liste d'objets | Définit les buckets GCS à provisionner pour l'application. Le nom de chaque bucket est automatiquement préfixé par l'ID du projet et le nom de l'application pour garantir son unicité. Utilisé uniquement lorsque `create_cloud_storage` vaut `true`. Sous-champs principaux de chaque entrée : **`name_suffix`** — suffixe ajouté au nom de bucket généré automatiquement (par ex. `"data"` donne `PROJECT-APPLICATION-data`). **`location`** — emplacement GCS du bucket ; peut être une région (`"us-central1"`), une birégion (`"US-EAST1+US-WEST1"`) ou une multirégion (`"US"`, `"EU"`, `"ASIA"`). La multirégion offre une disponibilité plus élevée, mais à un coût supérieur. **`storage_class`** — `"STANDARD"` (par défaut ; pour les données fréquemment consultées), `"NEARLINE"` (données consultées moins d'une fois par mois), `"COLDLINE"` (consultées moins d'une fois par trimestre), `"ARCHIVE"` (sauvegarde à long terme, rarement consultée). Choisissez en fonction de la fréquence d'accès pour optimiser le coût. **`force_destroy`** — lorsque `true`, le bucket et tout son contenu sont supprimés lors de la destruction du déploiement (par défaut : `true`). **Définissez `false` pour les buckets contenant des données qui doivent être conservées** au-delà du cycle de vie du déploiement. **`versioning_enabled`** — lorsque `true`, GCS conserve les versions précédentes des objets lors d'une mise à jour ou d'une suppression, ce qui permet de récupérer après un écrasement accidentel. Recommandé pour les buckets stockant des données importantes. **`lifecycle_rules`** — liste de règles de cycle de vie des objets (par ex. supprimer automatiquement les objets de plus de 90 jours, passer en Coldline au bout de 30 jours). **`public_access_prevention`** — `"enforced"` (par défaut ; bloque tout accès public même si des ACL sont définies) ou `"inherited"` (s'en remet à la règle d'administration de l'organisation). Conservez `"enforced"`, sauf si le bucket doit explicitement servir du contenu public. **`uniform_bucket_level_access`** — lorsque `true`, désactive les ACL par objet et impose un contrôle d'accès exclusivement par IAM. Recommandé pour tous les nouveaux buckets. |
| `gcs_volumes` | `[]` | Liste d'objets | Buckets GCS à monter comme **volumes de système de fichiers** dans le conteneur à l'aide de GCS Fuse. Cela permet à l'application de lire et d'écrire des objets GCS avec des opérations d'E/S de fichiers standard (open, read, write, ls) sans utiliser directement l'API GCS. Sous-champs principaux : **`name`** — nom logique du volume (référencé dans `mount_gcs_volumes` dans les jobs). **`bucket_name`** — nom du bucket GCS à monter ; il peut s'agir d'un bucket créé par `storage_buckets` ou de tout bucket existant auquel le compte de service Cloud Run peut accéder. Laissez vide pour utiliser le bucket nommé automatiquement. **`mount_path`** — chemin du système de fichiers, dans le conteneur, où le bucket apparaît (par ex. `/mnt/gcs`, `/app/uploads`). **`readonly`** — lorsque `true`, le montage est en lecture seule ; le conteneur ne peut pas écrire dans le bucket via ce montage. **`mount_options`** — options avancées de GCS Fuse (valeurs par défaut : `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). **Remarque sur les performances :** GCS Fuse présente une latence plus élevée qu'un système de fichiers natif et ne convient pas aux charges de travail qui exigent des lectures/écritures aléatoires à faible latence (par ex. les bases de données). Il est bien adapté à la lecture de fichiers volumineux, à la diffusion de ressources statiques ou à l'écriture de fichiers journaux. |
| `manage_storage_kms_iam` | `false` | `true` / `false` | Détermine si le module gère la liaison IAM qui accorde au compte de service Cloud Run le rôle `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur la clé Cloud KMS utilisée pour chiffrer les buckets de stockage. Il est désormais sans risque de définir cette variable à `true` dès le premier déploiement — le sous-module `app_cmek` du module crée automatiquement le trousseau KMS `${project_id}-cmek-keyring` et la CryptoKey `storage-key` s'ils n'existent pas déjà, avant d'appliquer la liaison IAM. Si `Services GCP` a été déployé avec `enable_cmek = true`, le même nom de trousseau bien connu est partagé et aucune ressource n'est créée en double. |
| `enable_artifact_registry_cmek` | `false` | `true` / `false` | Lorsque `true`, crée une clé KMS Artifact Registry dans le trousseau CMEK du projet et accorde à l'identité de service Artifact Registry le rôle `roles/cloudkms.cryptoKeyEncrypterDecrypter`, ce qui permet le chiffrement au repos des images de conteneur avec une clé gérée par le client. Peut être activé sans risque dès le premier déploiement — la clé est créée automatiquement par le module. Fonctionne avec `manage_storage_kms_iam` pour offrir une base de chiffrement CMEK cohérente entre le stockage et le registre d'images. |
| `max_images_to_retain` | `7` | Entier `0`–`100` | Nombre maximal d'images de conteneur les plus récentes à conserver dans le dépôt Artifact Registry **créé en mode intégré** pour ce déploiement. Il s'agit d'une règle KEEP qui sert de filet de sécurité — elle empêche les règles DELETE ci-dessous de supprimer les N images les plus récentes, même si elles sont anciennes ou sans tag. S'applique uniquement au dépôt intégré créé par ce module (et non à un dépôt `Services GCP` partagé) et est limitée aux images de ce déploiement par `package_name_prefix`. Définissez `0` pour désactiver entièrement cette protection de conservation. |
| `delete_untagged_images` | `true` | `true` / `false` | Lorsque `true`, supprime automatiquement les images de conteneur sans tag (couches de build orphelines et artefacts intermédiaires) du dépôt Artifact Registry créé en mode intégré. Les images protégées par `max_images_to_retain` ne sont jamais supprimées, quel que soit leur état de tag. N'affecte que les images limitées au nom d'application de ce déploiement — les autres noms d'image du même dépôt ne sont pas touchés. Ne désactivez cette option (`false`) que si votre pipeline de build s'appuie volontairement sur des manifestes sans tag comme intermédiaires. |
| `image_retention_days` | `30` | Entier `0`–`3650` | Nombre de jours au-delà duquel les images de conteneur deviennent éligibles à la suppression du dépôt Artifact Registry créé en mode intégré. Les images comprises dans le nombre `max_images_to_retain` sont toujours conservées, quel que soit leur âge. N'affecte que les images limitées au nom d'application de ce déploiement. Définissez `0` pour désactiver la suppression en fonction de l'âge. **Pour les environnements de production**, une valeur de `30` à `90` jours conserve un historique raisonnable pour un retour arrière tout en empêchant une croissance illimitée du registre. Doit être comprise entre `0` et `3650` (10 ans). |

### Explorer dans GCP — Groupe 9 {#exploring-in-gcp--group-9}

**Console Google Cloud :**
- **Buckets GCS :** accédez à **Cloud Storage → Buckets** pour vérifier que les buckets sont créés avec les noms, emplacements et classes de stockage attendus. Cliquez sur un bucket pour voir sa configuration, y compris le versionnement, les règles de cycle de vie et les paramètres d'accès.
- **Prévention de l'accès public :** dans les détails du bucket, l'onglet **Permissions** indique si la prévention de l'accès public est appliquée.
- **Montages GCS Fuse :** accédez à **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision et cliquez sur **Volumes** pour vérifier que les volumes GCS sont montés aux chemins attendus.
- **Chiffrement KMS :** dans les détails du bucket, l'onglet **Configuration** indique le type de chiffrement et la clé si le chiffrement géré par le client est activé.
- **Règles de nettoyage d'Artifact Registry :** accédez à **Artifact Registry → Repositories → *votre dépôt* → Cleanup Policies** pour vérifier que les règles KEEP et DELETE sont correctement configurées pour ce déploiement.

**CLI gcloud :**
```bash
# List all GCS buckets in the project
gcloud storage buckets list \
  --project=PROJECT_ID \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"

# Describe a specific bucket (versioning, lifecycle, encryption)
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="yaml(versioning,lifecycle,encryption,iamConfiguration)"

# View GCS volume mounts on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes,spec.template.spec.containers[0].volumeMounts)"

# List objects in a bucket (validate application is writing correctly)
gcloud storage ls gs://BUCKET_NAME/ --recursive

# Check IAM policy on a KMS key
gcloud kms keys get-iam-policy KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=LOCATION \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"

# View Artifact Registry cleanup policies for the inline repository
gcloud artifacts repositories describe REPO_NAME \
  --location=REGION \
  --project=PROJECT_ID \
  --format="yaml(cleanupPolicies)"

# List container images to confirm cleanup is working (count should stay <= max_images_to_retain after builds)
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags \
  --format="table(image,tags,createTime,updateTime)"
```

---

## Groupe 10 — Cache Redis {#group-10--redis-cache}

Ces variables configurent la connectivité Redis de l'application. Plutôt que de provisionner directement une instance Redis, le module injecte les informations de connexion Redis sous forme de variables d'environnement (`REDIS_HOST`, `REDIS_PORT` et, éventuellement, `REDIS_AUTH`) dans le conteneur Cloud Run. Il incombe à l'application de lire ces variables et d'établir la connexion. Cette conception permet au module de se connecter à tout service compatible Redis — Google Cloud Memorystore, une VM Redis auto-hébergée ou un fournisseur Redis tiers.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Lorsque `true`, les variables d'environnement `REDIS_HOST` et `REDIS_PORT` sont injectées dans le conteneur Cloud Run. L'application doit être configurée pour utiliser ces variables pour sa connexion Redis. Lorsque `false`, aucune variable d'environnement Redis n'est injectée et l'application doit gérer sa propre configuration de cache de manière indépendante. **Si `enable_redis` vaut `true` et que `redis_host` est laissé vide**, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis — utile dans les déploiements où un service compatible Redis s'exécute sur la même VM que le serveur NFS (un modèle courant dans les environnements `Services GCP` partagés). |
| `redis_host` | `""` *(par défaut, IP du serveur NFS)* | Adresse IP ou nom d'hôte | Nom d'hôte ou adresse IP du serveur Redis, injecté en tant que variable d'environnement `REDIS_HOST`. Utilisé uniquement lorsque `enable_redis` vaut `true`. **Laissez vide** pour revenir à l'IP du serveur NFS (adapté aux environnements partagés à VM unique). **Définissez-le explicitement** pour vous connecter à une instance Redis dédiée telle que : Google Cloud Memorystore for Redis (utilisez l'IP privée de l'instance — vous la trouverez dans **Memorystore → Redis → *instance* → Primary endpoint**), une VM GCE Redis ou un fournisseur Redis externe. Le service Cloud Run communique avec cet hôte via le réseau VPC — assurez-vous que l'instance est joignable depuis le VPC de Cloud Run à l'aide de `vpc_egress_setting` et que les règles de pare-feu autorisent le trafic sur `redis_port`. |
| `redis_port` | `"6379"` | Numéro de port sous forme de chaîne | Port TCP du serveur Redis, injecté en tant que variable d'environnement `REDIS_PORT`. La valeur par défaut `6379` est le port Redis standard et convient à la plupart des déploiements, y compris Cloud Memorystore. Ne la modifiez que si votre instance Redis est configurée pour écouter sur un port non standard. Utilisé uniquement lorsque `enable_redis` vaut `true`. |
| `redis_auth` | `""` *(pas d'authentification)* | Chaîne de mot de passe *(sensible)* | Mot de passe d'authentification du serveur Redis. Lorsqu'elle est définie, cette valeur est stockée dans Secret Manager et injectée de manière sécurisée dans le conteneur — elle n'est jamais stockée en clair. Laissez vide si l'instance Redis ne requiert pas d'authentification (acceptable pour les environnements de développement ou les instances accessibles uniquement au sein d'un VPC privé). **Pour les déploiements de production utilisant Cloud Memorystore avec AUTH activé**, indiquez la chaîne d'authentification de l'instance (disponible dans **Memorystore → Redis → *instance* → AUTH string**). Pour un Redis auto-hébergé, indiquez la valeur configurée dans la directive `requirepass`. L'activation d'AUTH est fortement recommandée pour toute instance Redis accessible par le réseau, même privé, car elle apporte une défense en profondeur. |

### Explorer dans GCP — Groupe 10 {#exploring-in-gcp--group-10}

**Console Google Cloud :**
- **Instance Memorystore Redis :** accédez à **Memorystore → Redis** pour vérifier que l'instance existe, ainsi que son adresse IP, son port et son état AUTH.
- **Variables d'environnement Redis sur Cloud Run :** accédez à **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, cliquez sur **Container(s)** et consultez la section **Environment variables** pour vérifier que `REDIS_HOST` et `REDIS_PORT` sont présentes.
- **Connectivité VPC :** accédez à **VPC Network → Firewall** et vérifiez qu'une règle autorise le trafic TCP depuis la plage VPC du service Cloud Run vers l'IP de l'instance Redis sur le port configuré.

**CLI gcloud :**
```bash
# List Cloud Memorystore Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,tier,memorySizeGb,state,authEnabled)"

# Describe a specific Memorystore instance (includes IP and AUTH info)
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(host,port,authEnabled,transitEncryptionMode,state)"

# Confirm REDIS_HOST and REDIS_PORT are set on the Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -A2 "REDIS"

# Test Redis connectivity from within the VPC (using a Cloud Shell or GCE VM)
# redis-cli -h REDIS_HOST -p REDIS_PORT -a REDIS_AUTH ping
```

---

## Groupe 11 — Base de données {#group-11--database-backend}

> **Choisir la base de données.** Décidez d'abord *si* vous en avez besoin : `database_type = "NONE"` ignore tout provisionnement de base de données (et désactive les fonctionnalités qui en dépendent — import de sauvegarde, SQL personnalisé, rotation automatique, volume Cloud SQL —, chacune étant rejetée au moment du plan si elle reste activée avec `NONE`). Si vous avez besoin d'une base de données, choisissez le moteur requis par votre application (`POSTGRES`/`MYSQL`, ou une variante à version fixée comme `POSTGRES_15`). **Fixez la version en production** — `database_type` est de fait immuable : le modifier après le premier déploiement *remplace l'instance Cloud SQL et détruit ses données*. L'emplacement de l'instance est automatique : avec un socle `Services_GCP`, le module crée uniquement une base de données et un utilisateur dans l'instance partagée (pas de coût d'instance par déploiement) ; en mode autonome, il provisionne une instance dédiée. Les interrupteurs propres à une famille de moteurs (`enable_postgres_extensions`, `enable_mysql_plugins`) doivent correspondre au moteur choisi — une incohérence est détectée au moment du plan.

Ces variables configurent la base de données Cloud SQL de l'application. Le module prend en charge PostgreSQL, MySQL et SQL Server. Il peut provisionner automatiquement une nouvelle instance Cloud SQL, se connecter à une instance existante ou ignorer entièrement le provisionnement de la base de données. Les identifiants de la base de données sont générés de manière sécurisée et injectés dans l'application via Secret Manager — l'application reçoit `DB_HOST`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` sous forme de variables d'environnement.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Voir les options ci-dessous | Moteur de base de données Cloud SQL à provisionner. Utilisez `"NONE"` pour ignorer entièrement le provisionnement de la base de données (pour les applications sans état ou celles qui utilisent une base de données externe). Les **alias génériques** (`POSTGRES`, `MYSQL`) déploient la dernière version prise en charge gérée par Cloud SQL. Les **valeurs à version fixée** déploient une version précise du moteur et sont recommandées pour les environnements de production où la cohérence des versions entre déploiements compte. Options prises en charge : `NONE` — pas de base de données ; `POSTGRES` / `POSTGRESQL` / `POSTGRES_15` / `POSTGRES_14` / `POSTGRES_13` / `POSTGRES_12` / `POSTGRES_11` / `POSTGRES_10` / `POSTGRES_9_6` ; `MYSQL` / `MYSQL_8_0` / `MYSQL_5_7` / `MYSQL_5_6` ; `SQLSERVER` / `SQLSERVER_2019_ENTERPRISE` / `SQLSERVER_2019_STANDARD` / `SQLSERVER_2017_ENTERPRISE` / `SQLSERVER_2017_STANDARD`. **Remarque :** modifier `database_type` après le déploiement initial tente de remplacer l'instance Cloud SQL, ce qui entraîne une perte de données à moins qu'une sauvegarde ne soit restaurée au préalable. |
| `sql_instance_name` | `""` *(découverte automatique)* | Chaîne | Nom d'une instance Cloud SQL existante précise à laquelle se connecter. Lorsqu'il est défini, le module utilise directement cette instance et ignore la découverte automatique et la création d'instance. Laissez vide pour permettre au module de découvrir automatiquement une instance gérée par `Services GCP` dans le projet, ou de créer une nouvelle instance si aucune n'est trouvée. À utiliser lorsque le projet comporte plusieurs instances Cloud SQL et que vous devez en cibler une explicitement, ou pour réutiliser une instance partagée entre plusieurs déploiements d'applications. L'instance nommée doit déjà exister et être d'un `database_type` compatible. |
| `sql_instance_base_name` | `"app-sql"` | Chaîne | Nom de base d'une nouvelle instance Cloud SQL, créée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté automatiquement pour garantir l'unicité (par ex. `app-sql-prod`). Ne le modifiez que si le nom par défaut entre en conflit avec une ressource existante ou si votre convention de nommage exige un préfixe différent. Pertinent uniquement lorsque `sql_instance_name` est vide et qu'aucune instance existante n'est découverte automatiquement. |
| `application_database_name` | `"crappdb"` | `[a-z][a-z0-9_]{0,62}` (1 à 63 caractères) | Nom de la base de données créée dans l'instance Cloud SQL. Injecté dans le conteneur de l'application en tant que variable d'environnement `DB_NAME`. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des traits de soulignement. Choisissez un nom qui reflète l'application et l'environnement, par ex. `crm_prod`, `payments_staging`. Utilisé uniquement lorsque `database_type` ne vaut pas `NONE`. **Ne le modifiez pas après le déploiement initial** — renommer la base de données exige une migration manuelle des données. |
| `application_database_user` | `"crappuser"` | `[a-z][a-z0-9_]{0,31}` (1 à 32 caractères) | Nom de l'utilisateur de base de données créé pour l'application. Injecté dans le conteneur de l'application en tant que variable d'environnement `DB_USER`. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des traits de soulignement. Utilisez un nom parlant tel que `crm_svc` ou `app_user`. Le mot de passe correspondant est généré automatiquement, stocké dans Secret Manager et injecté en tant que `DB_PASSWORD`. Utilisé uniquement lorsque `database_type` ne vaut pas `NONE`. |
| `db_password_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel le secret du mot de passe de la base de données est également exposé, en plus du `DB_PASSWORD` standard. Destiné aux modules wrapper qui encapsulent des applications attendant un nom de variable de mot de passe non standard (par ex. WordPress requiert `WORDPRESS_DB_PASSWORD`). Laissez vide pour injecter le mot de passe uniquement en tant que `DB_PASSWORD`. Lorsqu'il est défini, `DB_PASSWORD` et la variable nommée pointent vers la même version de secret Secret Manager — modifier cette valeur sur un déploiement existant n'affecte pas le mot de passe de la base de données lui-même. |
| `database_password_length` | `32` | Entier `16`–`64` | Longueur, en caractères, du mot de passe généré aléatoirement pour l'utilisateur de la base de données. Les mots de passe plus longs offrent nettement plus d'entropie et résistent mieux aux attaques par force brute. **Minimum recommandé en production : `32`**. Le mot de passe est généré une fois lors du premier déploiement, stocké dans Secret Manager et renouvelé automatiquement si `enable_auto_password_rotation` est activé. Modifier cette valeur lors d'un déploiement ultérieur ne génère un nouveau mot de passe que si une rotation est déclenchée — cela ne modifie pas rétroactivement la longueur du mot de passe existant. |
| `enable_postgres_extensions` | `false` | `true` / `false` | Lorsque `true`, active l'installation d'extensions PostgreSQL dans la base de données de l'application après le provisionnement. S'applique uniquement lorsque `database_type` est une variante PostgreSQL. Définissez `false` si aucune extension n'est requise ou si les extensions sont gérées par l'application au démarrage. |
| `postgres_extensions` | `[]` | Liste de noms d'extensions | Extensions PostgreSQL à installer dans la base de données de l'application. Requiert `enable_postgres_extensions = true` et un `database_type` PostgreSQL. Extensions courantes : `postgis` (données géospatiales), `uuid-ossp` (génération d'UUID), `pg_trgm` (recherche textuelle par trigrammes), `pgcrypto` (fonctions cryptographiques), `hstore` (stockage clé-valeur), `pg_stat_statements` (suivi des performances des requêtes). Vérifiez que l'extension est prise en charge par la version de Cloud SQL PostgreSQL utilisée. |
| `enable_mysql_plugins` | `false` | `true` / `false` | Lorsque `true`, active l'installation de plugins MySQL dans la base de données de l'application après le provisionnement. S'applique uniquement lorsque `database_type` est une variante MySQL. Définissez `false` si aucun plugin n'est requis ou si les plugins sont gérés par l'application au démarrage. |
| `mysql_plugins` | `[]` | Liste de noms de plugins | Plugins MySQL à installer dans la base de données de l'application. Requiert `enable_mysql_plugins = true` et un `database_type` MySQL. Plugins courants : `audit_log` (journalisation d'audit à des fins de conformité), `validate_password` (contrôle de la robustesse des mots de passe). Vérifiez la disponibilité du plugin pour votre version de MySQL dans Cloud SQL avant de l'activer. |
| `enable_auto_password_rotation` | `false` | `true` / `false` | Lorsque `true`, déploie un mécanisme automatisé de rotation des mots de passe composé d'un Job Cloud Run de rotation et d'un déclencheur Eventarc qui se déclenche lorsque Secret Manager publie une notification de rotation. Le job de rotation génère un nouveau mot de passe de base de données, met à jour l'utilisateur Cloud SQL et le secret Secret Manager, puis redémarre le service Cloud Run pour qu'il prenne en compte les nouveaux identifiants. La fréquence de rotation est régie par `secret_rotation_period` (groupe 4). **Recommandé pour les environnements de production** afin de limiter le rayon d'impact d'un identifiant de base de données divulgué. S'applique uniquement lorsque `database_type` ne vaut pas `NONE`. |
| `rotation_propagation_delay_sec` | `90` | Entier (secondes) | Nombre de secondes d'attente après l'écriture d'un nouveau mot de passe de base de données dans Secret Manager avant de redémarrer le service Cloud Run. Ce délai permet à la réplication globale de Secret Manager de se terminer afin que la nouvelle version du secret soit disponible dans toutes les régions avant que les instances ne tentent de la lire. **Augmentez cette valeur** (par ex. à `120`) dans les déploiements multirégionaux ou si vous constatez des échecs de rotation où des instances démarrent avec les nouveaux identifiants avant que le secret ne soit entièrement propagé. Utilisé uniquement lorsque `enable_auto_password_rotation` vaut `true`. |
| `db_host_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel l'hôte de la base de données est également exposé, en plus du `DB_HOST` standard. Destiné aux modules wrapper qui encapsulent des applications attendant un nom de variable d'hôte non standard (par ex. `NC_DB_HOST` pour Nextcloud). Laissez vide pour injecter l'hôte uniquement en tant que `DB_HOST`. |
| `db_user_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel l'utilisateur de la base de données est également exposé, en plus du `DB_USER` standard. Laissez vide pour injecter l'utilisateur uniquement en tant que `DB_USER`. |
| `db_name_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel le nom de la base de données est également exposé, en plus du `DB_NAME` standard. Laissez vide pour injecter le nom uniquement en tant que `DB_NAME`. |
| `db_port_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel le port de la base de données est également exposé, en plus du `DB_PORT` standard. Laissez vide pour injecter le port uniquement en tant que `DB_PORT`. |
| `service_url_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Nom de variable d'environnement supplémentaire sous lequel l'URL du service Cloud Run est également exposée, en plus du `CLOUDRUN_SERVICE_URL` standard. Utile pour les applications qui construisent des URL absolues à partir d'une variable précise (par ex. `NC_PUBLIC_URL`, `URL` pour Outline). Laissez vide pour injecter l'URL uniquement en tant que `CLOUDRUN_SERVICE_URL`. |

### Explorer dans GCP — Groupe 11 {#exploring-in-gcp--group-11}

**Console Google Cloud :**
- **Instance Cloud SQL :** accédez à **SQL** pour vérifier que l'instance existe, ainsi que son moteur de base de données, sa version, sa région et son nom de connexion.
- **Bases de données et utilisateurs :** cliquez sur l'instance, puis sélectionnez les onglets **Databases** et **Users** pour vérifier que la base de données et l'utilisateur de l'application ont été créés.
- **Identifiants de la base de données dans Secret Manager :** accédez à **Security → Secret Manager** et filtrez par nom d'application pour trouver le secret `DB_PASSWORD`. Consultez ses versions et son calendrier de rotation.
- **Job de rotation des mots de passe :** accédez à **Cloud Run → Jobs** et cherchez un job de rotation nommé d'après l'application. Accédez à **Eventarc → Triggers** pour vérifier que le déclencheur de rotation est configuré.
- **Variables d'environnement de la base de données sur Cloud Run :** accédez à **Cloud Run → Services → *votre service* → Revisions → Container(s)** et vérifiez que `DB_HOST`, `DB_NAME` et `DB_USER` apparaissent comme variables d'environnement en texte clair et que `DB_PASSWORD` apparaît comme référence de secret.

**CLI gcloud :**
```bash
# List Cloud SQL instances in the project
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,region,settings.tier,state)"

# Describe a specific Cloud SQL instance (connection name, IP, flags)
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(connectionName,ipAddresses,databaseVersion,settings)"

# List databases on a Cloud SQL instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,charset,collation)"

# List users on a Cloud SQL instance
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"

# List Secret Manager secrets related to the database
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:db" \
  --format="table(name,createTime)"

# List Eventarc triggers (password rotation trigger)
gcloud eventarc triggers list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,eventFilters,destination.cloudRun.service)"
```

---

## Groupe 12 — Sauvegarde et maintenance {#group-12--backup--maintenance}

Ces variables configurent la planification des sauvegardes automatisées de la base de données et l'import ponctuel d'une sauvegarde. Le module provisionne un Cloud Run Job pour effectuer les dumps de la base de données, un déclencheur Cloud Scheduler pour l'exécuter selon un calendrier défini et un bucket GCS pour stocker les fichiers de sauvegarde obtenus. Un mécanisme d'import ponctuel distinct permet de restaurer une sauvegarde existante dans la base de données pendant le déploiement — utile pour alimenter un nouvel environnement avec des données de production.

> **Remarque :** les opérations de sauvegarde et d'import ne s'appliquent que lorsque `database_type` ne vaut pas `NONE`.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Expression cron Unix (UTC) | Calendrier cron qui détermine quand le job de sauvegarde automatisée de la base de données s'exécute. Toutes les heures sont en **UTC**. Le job de sauvegarde effectue un dump de la base de données et écrit le résultat dans le bucket GCS de sauvegarde du module. Exemples de calendriers courants : `"0 2 * * *"` — tous les jours à 02:00 UTC ; `"0 */6 * * *"` — toutes les 6 heures ; `"0 2 * * 0"` — chaque semaine le dimanche à 02:00 UTC ; `"0 2 1 * *"` — chaque mois le 1er à 02:00 UTC. **Choisissez un calendrier correspondant à votre objectif de point de reprise (RPO)** — par exemple, une sauvegarde quotidienne signifie que vous pourriez perdre jusqu'à 24 heures de données dans le pire des cas. Pour les bases de données de production critiques, envisagez un calendrier horaire ou toutes les 6 heures. Planifiez la sauvegarde pendant les périodes de faible trafic afin de réduire l'impact sur les performances de la base de données. |
| `backup_retention_days` | `7` | Entier positif | Nombre de jours pendant lesquels les fichiers de sauvegarde sont conservés dans le bucket GCS de sauvegarde avant d'être supprimés automatiquement par une règle de cycle de vie. Une durée de conservation plus longue augmente les coûts de stockage, mais offre une fenêtre de récupération plus longue. **Recommandations par environnement :** développement — `7` jours suffisent généralement ; préproduction — `14` à `30` jours ; production — `30` à `90` jours ou plus selon les exigences de conformité. Certains cadres réglementaires (par ex. PCI-DSS, HIPAA) imposent des durées minimales de conservation des sauvegardes — vérifiez vos exigences avant de réduire cette valeur. |
| `enable_backup_import` | `false` | `true` / `false` | Lorsque `true`, un job ponctuel d'import de base de données est exécuté pendant le déploiement ; il restaure le fichier de sauvegarde indiqué par `backup_file` depuis la source définie dans `backup_source`. Il est conçu pour **alimenter un nouvel environnement** avec les données d'une sauvegarde existante — par exemple pour peupler un environnement de préproduction avec une copie des données de production, ou restaurer une base de données après un nouveau déploiement. **Configurez `backup_source`, `backup_file` et `backup_format` avant de l'activer.** Le job d'import s'exécute après le provisionnement de la base de données. Si la base de données contient déjà des données, l'import peut produire des erreurs ou des conflits selon le format de la sauvegarde — testez d'abord dans un environnement hors production. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | Source depuis laquelle le fichier de sauvegarde est récupéré pour l'import. **`gcs`** : récupère le fichier de sauvegarde depuis le bucket GCS de sauvegarde provisionné par le module. Le fichier doit être téléversé dans le bucket avant le déploiement. **`gdrive`** : récupère le fichier de sauvegarde depuis un emplacement Google Drive. Utile lorsque les fichiers de sauvegarde sont stockés dans un Google Drive partagé plutôt que dans GCS. Utilisé uniquement lorsque `enable_backup_import` vaut `true`. |
| `backup_file` | `"backup.sql"` | Chaîne de nom de fichier | Nom du fichier de sauvegarde à importer dans la base de données. Le fichier doit exister à la source configurée (`backup_source`) avant le début du déploiement. Pour GCS, le fichier doit être présent dans le bucket de sauvegarde du module. Exemples : `"backup.sql"`, `"2024-01-15-dump.sql.gz"`, `"production-snapshot.tar"`. Utilisé uniquement lorsque `enable_backup_import` vaut `true`. Assurez-vous que le nom de fichier correspond exactement au fichier présent dans la source, extension comprise — une incohérence fait échouer le job d'import. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | Format du fichier de sauvegarde à importer. Doit correspondre au format réel de `backup_file`. **`sql`** : dump SQL en texte brut (par ex. sortie de `pg_dump` ou `mysqldump`). **`gz`** : dump SQL compressé avec gzip. **`tar`** / **`tgz`** / **`tar.gz`** : archive tar (éventuellement compressée). **`zip`** : archive ZIP. **`auto`** : le job d'import tente de détecter automatiquement le format à partir de l'extension du fichier — à utiliser lorsque le format peut varier d'une exécution à l'autre, mais les valeurs explicites sont préférables pour la fiabilité. Utilisé uniquement lorsque `enable_backup_import` vaut `true`. |

### Explorer dans GCP — Groupe 12 {#exploring-in-gcp--group-12}

**Console Google Cloud :**
- **Calendrier de sauvegarde (Cloud Scheduler) :** accédez à **Cloud Scheduler** pour vérifier que le déclencheur du job de sauvegarde existe, ainsi que son calendrier, l'heure de sa dernière exécution et son état (activé/en pause).
- **Job de sauvegarde (Cloud Run Jobs) :** accédez à **Cloud Run → Jobs** pour vérifier que le job de sauvegarde existe. Cliquez sur le job et sélectionnez **Executions** pour voir les exécutions passées, leur état et leur durée.
- **Fichiers de sauvegarde (bucket GCS) :** accédez à **Cloud Storage → Buckets** et cherchez le bucket de sauvegarde (nommé d'après l'application avec le suffixe `-backup`). Cliquez sur le bucket pour vérifier que les fichiers de sauvegarde sont bien écrits et que les règles de cycle de vie sont appliquées.
- **Job d'import :** après avoir activé `enable_backup_import`, accédez à **Cloud Run → Jobs → Executions** pour vérifier que le job d'import s'est exécuté avec succès. Consultez les journaux pour repérer d'éventuelles erreurs.

**CLI gcloud :**
```bash
# List Cloud Scheduler jobs (backup triggers)
gcloud scheduler jobs list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,schedule,state,lastAttemptTime)"

# View the last execution of the backup Cloud Run Job
gcloud run jobs executions list \
  --job=BACKUP_JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# List backup files in the GCS backup bucket
gcloud storage ls gs://BACKUP_BUCKET_NAME/ \
  --recursive \
  --format="table(name,size,timeCreated)"

# View the lifecycle rules on the backup bucket (confirm retention policy)
gcloud storage buckets describe gs://BACKUP_BUCKET_NAME \
  --format="yaml(lifecycle)"

# Manually trigger the backup job immediately (for testing)
gcloud scheduler jobs run SCHEDULER_JOB_NAME \
  --location=REGION
```

---

## Groupe 13 — Initialisation personnalisée et SQL {#group-13--custom-initialisation--sql}

Ces variables permettent d'exécuter des scripts SQL personnalisés sur la base de données de l'application pendant le déploiement. Elles offrent un mécanisme souple pour appliquer des modifications de schéma, installer des procédures stockées, créer des rôles ou charger des données d'amorçage que le propre framework de migration de l'application ne peut pas prendre en charge. Les scripts sont récupérés depuis un bucket GCS et exécutés dans l'ordre lexicographique (alphabétique), ce qui facilite le versionnement et l'enchaînement des migrations.

> **Remarque :** les scripts SQL personnalisés ne s'exécutent que lorsque `database_type` ne vaut pas `NONE`. Le compte de service Cloud Run doit disposer d'un accès en lecture au bucket GCS contenant les scripts.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | `true` / `false` | Lorsque `true`, le module récupère les fichiers de scripts SQL depuis le bucket GCS et le chemin indiqués par `custom_sql_scripts_bucket` et `custom_sql_scripts_path`, puis les exécute sur la base de données de l'application dans l'ordre lexicographique. Les scripts s'exécutent dans le cadre du processus de déploiement via un Cloud Run Job. Destiné aux **migrations de schéma, à l'installation de procédures stockées, à la création de rôles ou au chargement de données d'amorçage** qui doivent avoir lieu au niveau de l'infrastructure plutôt qu'au sein de l'application. Définissez `false` si votre application gère ses propres migrations de schéma au démarrage (par ex. via Flyway, Liquibase, les migrations Django ou Alembic). **Important :** les scripts sont réexécutés à chaque déploiement si `execute_on_apply` est configuré — concevez des scripts idempotents (pouvant être exécutés plusieurs fois sans risque) pour éviter les erreurs lors des exécutions répétées. |
| `custom_sql_scripts_bucket` | `""` | Nom de bucket GCS | Nom du bucket GCS contenant les fichiers de scripts SQL à exécuter. Le bucket doit exister avant le déploiement et le compte de service Cloud Run doit disposer au minimum de `roles/storage.objectViewer` sur ce bucket. Il peut s'agir du bucket applicatif provisionné par le module lui-même (par ex. `PROJECT-APPLICATION-data`) ou d'un bucket de scripts dédié partagé entre plusieurs déploiements. Obligatoire lorsque `enable_custom_sql_scripts` vaut `true`. |
| `custom_sql_scripts_path` | `""` | Chaîne de préfixe de chemin GCS | Préfixe de chemin, dans le bucket GCS, à partir duquel les scripts SQL sont récupérés. Tous les fichiers `.sql` trouvés sous ce préfixe sont exécutés dans l'**ordre lexicographique (alphabétique)**. Utilisez une convention de nommage telle que `001_create_tables.sql`, `002_add_indexes.sql`, `003_seed_data.sql` pour contrôler précisément l'ordre d'exécution. Exemples : `"init/"` — exécute tous les fichiers `.sql` du dossier `init/` ; `"migrations/v2/"` — exécute tous les fichiers `.sql` d'un sous-dossier versionné. Obligatoire lorsque `enable_custom_sql_scripts` vaut `true`. Assurez-vous qu'aucun fichier `.sql` indésirable ne se trouve sous ce préfixe, car tous les fichiers correspondants seront exécutés. |
| `custom_sql_scripts_use_root` | `false` | `true` / `false` | Détermine quel utilisateur de base de données exécute les scripts SQL personnalisés. **`false` (par défaut) :** les scripts s'exécutent avec l'utilisateur de base de données de l'application (`application_database_user`), dont les autorisations sont limitées à la base de données de l'application. C'est le **paramètre recommandé** pour la plupart des scripts. **`true` :** les scripts s'exécutent avec le compte root (superutilisateur) de la base de données. À activer uniquement lorsque les scripts requièrent des privilèges élevés dont l'utilisateur de l'application ne dispose pas — par exemple pour créer des extensions PostgreSQL (`CREATE EXTENSION`), créer des rôles supplémentaires (`CREATE ROLE`) ou modifier la configuration au niveau de la base de données. **À utiliser avec prudence :** exécuter du SQL arbitraire en tant que root comporte un risque accru de modifications accidentelles ou destructrices de l'instance de base de données. |

### Explorer dans GCP — Groupe 13 {#exploring-in-gcp--group-13}

**Console Google Cloud :**
- **Job d'exécution des scripts :** accédez à **Cloud Run → Jobs** et cherchez le job des scripts SQL (nommé d'après l'application). Sélectionnez le job et cliquez sur **Executions** pour voir l'historique des exécutions, leur état et leurs journaux.
- **Fichiers de scripts dans GCS :** accédez à **Cloud Storage → Buckets → *bucket de scripts*** et vérifiez que les fichiers `.sql` attendus existent au préfixe de chemin configuré.
- **Accès IAM au bucket :** dans les détails du bucket, sélectionnez l'onglet **Permissions** et vérifiez que le compte de service Cloud Run dispose au minimum de l'accès `Storage Object Viewer`.
- **Journaux d'exécution des scripts :** dans les détails de l'exécution du job, cliquez sur **Logs** pour voir la sortie SQL et vérifier que les scripts se sont exécutés avec succès ou diagnostiquer les échecs.

**CLI gcloud :**
```bash
# Confirm SQL script files exist in the GCS bucket at the configured path
gcloud storage ls gs://BUCKET_NAME/SCRIPTS_PATH \
  --recursive

# Check the Cloud Run service account has access to the scripts bucket
gcloud storage buckets get-iam-policy gs://BUCKET_NAME \
  --format="table(bindings.role,bindings.members)"

# List executions of the SQL scripts Cloud Run Job
gcloud run jobs executions list \
  --job=SQL_SCRIPTS_JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View logs from the most recent SQL scripts job execution
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=SQL_SCRIPTS_JOB_NAME" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Groupe 14 — Accès et réseau {#group-14--access--networking}

> **Choisir l'accès et le réseau.** Deux axes indépendants. **L'entrée (ingress)** détermine qui peut joindre le service : `"all"` pour une application publique ; `"internal"` pour des backends accessibles uniquement depuis le VPC ; `"internal-and-cloud-load-balancing"` dès qu'un équilibreur de charge est placé devant — et cette association est obligatoire avec `enable_cloud_armor` (groupe 16), car `"all"` laisse l'URL `*.run.app` joignable publiquement et contourne entièrement le WAF. **La sortie (egress)** détermine le trafic sortant : conservez `"PRIVATE_RANGES_ONLY"` si l'application ne communique qu'avec des ressources VPC privées (Cloud SQL, Memorystore, NFS) ; passez à `"ALL_TRAFFIC"` si elle appelle des API externes, des SaaS ou des webhooks, faute de quoi ces appels expirent silencieusement. Laissez `network_name` vide pour découvrir automatiquement l'unique VPC `Services_GCP` ; ne le définissez que lorsque le projet en comporte plusieurs.

Ces variables déterminent la manière dont le trafic atteint le service Cloud Run et dont le service se connecte en sortie aux autres ressources GCP. Une configuration correcte est ici essentielle tant pour la sécurité (limiter l'exposition à l'internet public) que pour la connectivité (garantir que le service peut joindre via le VPC les instances Cloud SQL privées, Memorystore ou les volumes NFS).

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `ingress_settings` | `"all"` | `all` / `internal` / `internal-and-cloud-load-balancing` | Détermine quelles sources de trafic sont autorisées à invoquer le service Cloud Run. **`all` :** le service est joignable publiquement depuis internet. À utiliser pour les applications exposées au public. **`internal` :** seul le trafic provenant du même réseau VPC ou d'autres services internes de Google (par ex. Cloud Tasks, push Pub/Sub) peut joindre le service. À utiliser pour les API de backend, les workers ou tout service qui ne doit pas être directement exposé à internet. **`internal-and-cloud-load-balancing` :** interdit l'accès direct depuis internet, mais autorise le trafic arrivant via un Google Cloud Load Balancer (GCLB). C'est le paramètre approprié avec `enable_cloud_armor = true`, car le GCLB est placé devant le service et assure la terminaison SSL, les règles WAF et le CDN. La modification de ce paramètre prend effet au déploiement suivant sans nécessiter de nouvelle révision. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | `ALL_TRAFFIC` / `PRIVATE_RANGES_ONLY` | Détermine quel trafic sortant du service Cloud Run est acheminé via le réseau VPC configuré. **`PRIVATE_RANGES_ONLY` (par défaut) :** seul le trafic à destination des plages d'IP privées RFC 1918 (par ex. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) passe par le VPC. Le trafic vers l'internet public sort directement de Cloud Run sans traverser le VPC. Convient à la plupart des charges de travail dans lesquelles l'application doit joindre Cloud SQL, Memorystore ou NFS via une IP privée tout en appelant des API publiques externes. **`ALL_TRAFFIC` :** tout le trafic sortant — y compris les requêtes vers l'internet public — est acheminé via le VPC. Requis lorsque l'accès sortant à internet doit être contrôlé via une passerelle Cloud NAT, lorsqu'une connectivité sur site est nécessaire via VPN ou Interconnect, ou lorsque des règles de sortie imposent que tout le trafic emprunte un chemin réseau précis. Notez que `ALL_TRAFFIC` peut augmenter la latence des appels vers les API Google publiques et les services externes. |
| `network_name` | `""` *(découvert automatiquement)* | Chaîne de nom de réseau VPC | Nom du réseau VPC auquel rattacher le service Cloud Run pour le routage sortant et le Direct VPC Egress. Laissez vide pour permettre au module de découvrir automatiquement l'unique réseau géré par Services GCP dans le projet. **Indiquez une valeur** lorsque le projet comporte plusieurs réseaux gérés par Services GCP, ou lorsque vous souhaitez rattacher le service à un réseau précis. Le réseau doit exister dans le même projet. La modification de cette valeur déclenche une nouvelle révision Cloud Run. |
| `prereq_subnet_cidr_override` | `""` | Chaîne CIDR | Remplace le CIDR du sous-réseau principal du VPC intégré, créé lorsqu'aucun réseau `Services GCP` n'existe. Lorsque la valeur est vide (par défaut), le socle dérive un `/24` unique par déploiement à partir de l'ID de déploiement aléatoire. Définissez la valeur précédemment appliquée (par ex. `"10.200.0.0/24"`) sur les déploiements autonomes existants pour éviter le remplacement des ressources. Sans effet lorsqu'un réseau géré par `Services GCP` est utilisé. |

### Explorer dans GCP — Groupe 14 {#exploring-in-gcp--group-14}

**Console Google Cloud :**
- **Paramètres d'entrée :** accédez à l'onglet **Cloud Run → Services → *votre service* → Details**. Sous **Networking**, vérifiez que le paramètre d'entrée correspond à la valeur configurée.
- **Sortie VPC :** dans la même section **Networking**, vérifiez que le rattachement au réseau VPC et le paramètre de sortie s'affichent correctement.

**CLI gcloud :**
```bash
# Confirm ingress and VPC egress settings on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations,spec.traffic)"

# List Direct VPC Egress configuration on the service revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.vpcAccess)"
```

---

## Groupe 15 — Identity-Aware Proxy {#group-15--identity-aware-proxy}

Ces variables configurent Identity-Aware Proxy (IAP) devant le service Cloud Run, en exigeant une authentification par identité Google avant que les utilisateurs puissent accéder à l'application. IAP applique le contrôle d'accès au niveau du proxy — aucune modification du code de l'application n'est nécessaire pour ajouter l'authentification. Il est recommandé pour les outils internes, les interfaces d'administration ou toute application dont l'accès doit être limité à des identités Google connues. `enable_iap` est l'interrupteur principal ; `iap_authorized_users` et `iap_authorized_groups` définissent qui est autorisé à accéder.

> **Remarque :** pour qu'IAP fonctionne correctement, `ingress_settings` (groupe 14) doit être défini sur `internal-and-cloud-load-balancing` lorsque le service est placé derrière un GCLB, ou sur `all` pour les services Cloud Run protégés directement par IAP.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_iap` | `false` | `true` / `false` | Active Identity-Aware Proxy (IAP) devant le service Cloud Run. Lorsque `true`, toutes les requêtes adressées au service doivent porter un identifiant d'identité Google valide — les requêtes non authentifiées sont redirigées vers une page de connexion Google. IAP applique le contrôle d'accès au niveau du proxy, ce qui signifie qu'**aucune modification du code de l'application n'est nécessaire** pour ajouter l'authentification. Utilisez IAP pour les outils internes, les interfaces d'administration ou toute application dont l'accès doit être limité à des identités Google connues. Une fois activé, configurez `iap_authorized_users` et `iap_authorized_groups` pour définir qui peut accéder à l'application. |
| `iap_authorized_users` | `[]` | Liste de chaînes `"user:email"` ou `"serviceAccount:email"` | Utilisateurs individuels ou comptes de service qui reçoivent le rôle `IAP-secured Web App User`, ce qui leur permet d'accéder à l'application via IAP. Actif uniquement lorsque `enable_iap` vaut `true`. Chaque entrée doit utiliser le format de membre IAM : `"user:alice@example.com"` pour un compte Google, ou `"serviceAccount:ci-runner@project.iam.gserviceaccount.com"` pour un compte de service (par ex. pour permettre aux pipelines CI/CD ou aux agents de contrôle de santé de contourner la page de connexion). Ajouter une adresse ici n'accorde **aucune** autre autorisation IAM GCP sur le projet — cela ne contrôle que l'accès à l'application protégée par IAP. Pour gérer l'accès au niveau des équipes, préférez `iap_authorized_groups` aux entrées d'utilisateurs individuels. |
| `iap_authorized_groups` | `[]` | Liste de chaînes `"group:name@domain"` | Google Groups qui reçoivent le rôle `IAP-secured Web App User`. Actif uniquement lorsque `enable_iap` vaut `true`. Chaque entrée doit utiliser le format de membre IAM : `"group:engineering@example.com"`. L'utilisation de groupes est l'approche recommandée pour donner accès à des équipes, car l'appartenance peut être gérée de manière centralisée dans Google Workspace ou Cloud Identity sans nécessiter de nouveau déploiement. La combinaison de `iap_authorized_groups` et `iap_authorized_users` est prise en charge — l'accès est accordé à l'union des deux listes. |

### Explorer dans GCP — Groupe 15 {#exploring-in-gcp--group-15}

**Console Google Cloud :**
- **État d'IAP :** accédez à **Security → Identity-Aware Proxy**. Le service Cloud Run doit apparaître dans la liste avec IAP activé. La colonne **Access** indique le nombre de comptes principaux autorisés.
- **Membres autorisés par IAP :** cliquez sur l'entrée du service dans la console IAP et sélectionnez l'onglet **Principals** pour vérifier que les utilisateurs, comptes de service et groupes attendus sont listés avec le rôle `IAP-secured Web App User`.

**CLI gcloud :**
```bash
# Check which principals have IAP access to the Cloud Run service
gcloud run services get-iam-policy SERVICE_NAME \
  --region=REGION \
  --format="table(bindings.role,bindings.members)"

# Verify IAP is enabled on the backend service (when using a load balancer)
gcloud compute backend-services list \
  --project=PROJECT_ID \
  --format="table(name,iap.enabled)"
```

---

## Groupe 16 — Cloud Armor et CDN {#group-16--cloud-armor--cdn}

Ces variables configurent un équilibreur de charge HTTPS global placé devant le service Cloud Run, avec une protection WAF Cloud Armor facultative, une terminaison SSL pour domaine personnalisé et une mise en cache en périphérie Cloud CDN. L'activation de ce groupe est requise dès que l'application a besoin d'un domaine personnalisé stable avec un certificat SSL géré par Google, d'une atténuation des attaques DDoS, de contrôles d'accès par adresse IP ou de contenu statique mis en cache à l'échelle mondiale. Les quatre variables fonctionnent ensemble comme un tout — `enable_cloud_armor` est l'interrupteur principal, et les autres variables affinent son comportement.

> **Remarque :** le provisionnement d'un équilibreur de charge HTTPS global et d'une règle Cloud Armor entraîne des coûts GCP supplémentaires au-delà de la tarification de Cloud Run. Consultez la [page de tarification de Cloud Armor](https://cloud.google.com/armor/pricing) avant de l'activer en production.

> **Remarque :** lorsque `enable_cloud_armor` vaut `true`, définissez `ingress_settings` (groupe 14) sur `internal-and-cloud-load-balancing` afin que le service Cloud Run n'accepte que le trafic passé par l'équilibreur de charge et la règle Cloud Armor.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_cloud_armor` | `false` | `true` / `false` | Interrupteur principal de la pile d'équilibrage de charge. Lorsque `true`, le module provisionne un équilibreur de charge HTTPS global avec un backend NEG serverless ciblant le service Cloud Run, un certificat SSL géré par Google pour chaque domaine de `application_domains` et une règle de sécurité Cloud Armor. Requis pour la **terminaison HTTPS de domaines personnalisés**, la **protection DDoS**, les **règles WAF** et le **CDN**. Lorsque `false`, le service Cloud Run est accessible directement via son URL `*.run.app` et toutes les autres variables de ce groupe sont sans effet. L'activer après le déploiement initial crée de nouvelles ressources GCP, mais n'affecte pas la révision du service Cloud Run elle-même. |
| `admin_ip_ranges` | `[]` | Liste de chaînes CIDR (par ex. `["203.0.113.0/24"]`) | Plages d'adresses IP CIDR qui bénéficient d'une règle Cloud Armor de priorité supérieure les exemptant des règles d'inspection WAF. Les requêtes provenant de ces plages sont autorisées sans condition, en contournant toute règle `deny` ou WAF de la règle de sécurité. À utiliser pour les réseaux de confiance tels que les IP de sortie des bureaux de l'entreprise, les IP des exécuteurs CI/CD ou les sources de sondes de supervision qui déclencheraient autrement les règles WAF. Laissez vide pour appliquer uniformément les règles WAF à tout le trafic. Effectif uniquement lorsque `enable_cloud_armor` vaut `true`. **N'ajoutez pas de plages trop larges** (par ex. `0.0.0.0/0`), car cela annulerait l'intérêt de la règle WAF. |
| `application_domains` | `[]` | Liste de noms de domaine (par ex. `["app.example.com", "www.example.com"]`) | Noms de domaine personnalisés à associer à l'équilibreur de charge. Un certificat SSL géré par Google est provisionné automatiquement pour chaque domaine ; il gère l'émission et le renouvellement du certificat sans intervention manuelle. Après le déploiement, l'adresse IP externe de l'équilibreur de charge est disponible dans les sorties du déploiement — **les enregistrements DNS A de chaque domaine doivent pointer vers cette IP** avant que le certificat puisse être émis et que le domaine serve du trafic. Le provisionnement du certificat prend généralement de 10 à 60 minutes après la propagation DNS. Laissez vide si vous n'avez pas besoin de domaine personnalisé et que l'URL `*.run.app` par défaut vous suffit. Utilisé uniquement lorsque `enable_cloud_armor` vaut `true`. |
| `enable_cdn` | `false` | `true` / `false` | Active Cloud CDN sur le backend de l'équilibreur de charge, ce qui met en cache les réponses HTTP sur le réseau périphérique mondial de Google. Lorsque `true`, les réponses pouvant être mises en cache (celles qui portent des en-têtes `Cache-Control` appropriés) sont servies depuis le PoP périphérique le plus proche, ce qui réduit la latence pour les utilisateurs répartis géographiquement et la charge sur l'origine Cloud Run. S'applique uniquement lorsque `enable_cloud_armor` vaut `true`. **Recommandé pour** les applications qui servent des ressources statiques, des images ou des réponses d'API publiques qui changent rarement. **Déconseillé pour** les applications aux réponses fondées sur la session ou fortement personnalisées, pour lesquelles la mise en cache ferait recevoir un contenu incorrect aux utilisateurs. Assurez-vous que votre application définit des en-têtes `Cache-Control` corrects pour contrôler ce qui est mis en cache ou non en périphérie. |

### Explorer dans GCP — Groupe 16 {#exploring-in-gcp--group-16}

**Console Google Cloud :**
- **Équilibreur de charge :** accédez à **Network services → Load balancing** et vérifiez qu'un équilibreur de charge HTTPS nommé d'après l'application figure dans la liste. Cliquez dessus pour voir les frontends, les backends et la règle Cloud Armor associée.
- **Certificats SSL :** dans les détails de l'équilibreur de charge, sélectionnez l'onglet **Frontend**. Chaque entrée de domaine doit afficher un certificat géré par Google à l'état `ACTIVE`. Un état `PROVISIONING` indique que le DNS ne s'est pas encore propagé ou que le certificat est toujours en cours d'émission.
- **Règle Cloud Armor :** accédez à **Network security → Cloud Armor policies** et vérifiez que la règle est associée au backend de l'équilibreur de charge. Examinez la liste des règles pour vérifier que les exemptions des plages d'IP d'administration et les règles WAF sont configurées comme prévu.
- **État du CDN :** dans les détails de l'équilibreur de charge, sélectionnez l'onglet **Backend** et vérifiez que **Cloud CDN** apparaît comme activé sur le service de backend.
- **IP de l'équilibreur de charge :** dans la configuration **Frontend**, notez l'adresse IP externe. Vérifiez que vos enregistrements DNS A résolvent vers cette IP à l'aide de `dig` ou `nslookup`.

**CLI gcloud :**
```bash
# List HTTPS load balancers in the project
gcloud compute forwarding-rules list \
  --project=PROJECT_ID \
  --filter="loadBalancingScheme=EXTERNAL_MANAGED" \
  --format="table(name,IPAddress,target)"

# Describe the backend service to confirm CDN and Cloud Armor policy attachment
gcloud compute backend-services describe BACKEND_SERVICE_NAME \
  --global \
  --format="yaml(enableCDN,securityPolicy)"

# List Cloud Armor security policies and their rules
gcloud compute security-policies describe POLICY_NAME \
  --project=PROJECT_ID \
  --format="yaml(rules)"

# Check SSL certificate status for custom domains
gcloud compute ssl-certificates list \
  --project=PROJECT_ID \
  --format="table(name,managed.domains,managed.status,managed.domainStatus)"

# Confirm DNS resolves to the load balancer IP
dig +short app.example.com
```

---

## Groupe 17 — VPC Service Controls et journalisation d'audit {#group-17--vpc-service-controls--audit-logging}

Ces variables contrôlent l'application d'un périmètre VPC Service Controls (VPC-SC) et la journalisation d'audit au niveau du projet. Définir `enable_vpc_sc = true` amène le module à **provisionner lui-même** un périmètre VPC-SC complet via `App_Common/modules/app_vpc_sc` — Services_GCP et une règle Access Context Manager préexistante **ne sont plus requis**. `enable_audit_logging` étend la capture par défaut des journaux d'audit, limitée à `ADMIN_WRITE`, à `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` pour tous les services GCP, avec des remplacements par service pour Secret Manager et Cloud KMS.

> **Remarque :** déployez VPC-SC **d'abord en mode simulation (dry-run)** (`vpc_sc_dry_run = true`, la valeur par défaut). Le périmètre est créé et les violations sont journalisées, mais les appels d'API ne sont pas bloqués. Examinez les journaux du mode simulation (voir l'extrait gcloud ci-dessous) avant de passer `vpc_sc_dry_run = false` pour appliquer le périmètre.

> **Remarque :** VPC-SC requiert une organisation GCP. Les projets autonomes (Qwiklab, comptes Google personnels) n'ont pas d'organisation, et `enable_vpc_sc = true` émet alors une ligne de journal `WARNING: VPC Service Controls skipped …` sans créer aucune ressource de périmètre. Les projets imbriqués dans un dossier requièrent que `organization_id` soit défini explicitement, car il ne peut pas être découvert automatiquement à partir des métadonnées du projet.

| Variable | Valeur par défaut | Options / Format | Description et conséquences |
|---|---|---|---|
| `enable_vpc_sc` | `false` | `true` / `false` | Lorsque `true`, le module provisionne un périmètre VPC-SC complet autour des API GCP qu'il consomme — une règle d'accès (réutilisée s'il en existe déjà une au niveau de l'organisation), quatre niveaux d'accès (réseau VPC, IP d'administration, agent de service IAP, compte de service Cloud Build de la CI/CD) et un périmètre de service `PERIMETER_TYPE_REGULAR` qui restreint Cloud Run, Cloud SQL, Secret Manager, Cloud Storage, Artifact Registry, Cloud Build, KMS, Pub/Sub, Redis, Filestore, Firestore, IAP, Certificate Manager et Compute. Il s'agit avant tout d'un contrôle de **prévention de l'exfiltration de données** — il bloque l'accès aux API depuis l'extérieur du périmètre, quelles que soient les autorisations IAM. Ignoré automatiquement avec un avertissement lorsque le projet n'a pas d'organisation (autonome), lorsqu'il est imbriqué dans un dossier sans `organization_id` explicite, ou lorsque `admin_ip_ranges` est vide (protection contre le verrouillage). Les noms du périmètre et des niveaux d'accès sont suffixés par `deployment_id` pour éviter les collisions entre déploiements. |
| `vpc_sc_dry_run` | `true` | `true` / `false` | Lorsque `true`, les violations du périmètre sont journalisées mais **non appliquées** — recommandé pour le premier déploiement de chaque déploiement. Vérifiez que le journal du mode simulation ne contient aucun appel refusé avant de passer à `false` pour activer l'application. Revenir à `true` désactive l'application sans supprimer le périmètre. Effectif uniquement lorsque `enable_vpc_sc = true`. |
| `vpc_cidr_ranges` | `[]` | Liste de chaînes CIDR | Plages CIDR explicites de sous-réseaux VPC à inclure dans le niveau d'accès du réseau VPC. Lorsque la liste est vide (par défaut), le module découvre automatiquement les sous-réseaux du réseau VPC utilisé pour ce déploiement (voir `network_name` dans le groupe 14) et utilise leurs plages CIDR. Revient à `10.0.0.0/8` si ni liste explicite ni réseau découvrable automatiquement ne sont disponibles. Effectif uniquement lorsque `enable_vpc_sc = true`. |
| `organization_id` | `""` | ID numérique d'organisation GCP (par ex. `"123456789012"`) | ID d'organisation GCP utilisé comme parent de la règle Access Context Manager. Découvert automatiquement à partir du projet lorsque celui-ci se trouve directement sous une organisation. **Doit être défini explicitement lorsque le projet est imbriqué dans un dossier** — l'ID d'organisation ne peut pas être découvert automatiquement pour les projets imbriqués dans un dossier, et `enable_vpc_sc = true` journalise un avertissement et ignore le provisionnement jusqu'à ce qu'il soit fourni. Laissez vide pour les projets sans organisation (autonomes) — VPC-SC est alors indisponible dans tous les cas. |
| `enable_audit_logging` | `false` | `true` / `false` | Lorsque `true`, le module active des Cloud Audit Logs détaillés pour l'ensemble du projet : `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` pour tous les services GCP, avec des remplacements explicites par service pour Secret Manager et Cloud KMS afin de garantir que les accès sensibles sont toujours journalisés. Équivaut à `Services GCP enable_audit_logging = true`. **Recommandé pour** les environnements soumis à des exigences de conformité (PCI, HIPAA, SOC 2). **Contrepartie :** augmente sensiblement le volume de stockage de Cloud Logging et les coûts associés — les applications à fort débit de requêtes ou faisant un usage intensif de Secret Manager / KMS doivent prévoir un budget pour l'ingestion de journaux supplémentaire. Peut être activé ou désactivé sans risque à tout moment ; n'affecte pas les charges de travail en cours d'exécution. |

> **Remarque :** `admin_ip_ranges` (groupe 16) a un **double usage** : en plus d'exempter les IP de confiance des règles WAF de Cloud Armor, ces mêmes CIDR servent de CIDR du niveau d'accès d'administration dans le périmètre VPC-SC lorsque `enable_vpc_sc = true`. Un `admin_ip_ranges` vide amène `enable_vpc_sc = true` à ignorer le provisionnement avec un avertissement, afin d'éviter un verrouillage des administrateurs.

### Explorer dans GCP — Groupe 17 {#exploring-in-gcp--group-17}

**Console Google Cloud :**
- **Périmètre VPC-SC :** accédez à **Security → VPC Service Controls**. Vérifiez qu'un périmètre nommé `perimeter_<project_id>_<deployment_id>` existe et que sa liste **Restricted services** inclut les API utilisées par ce module (Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry, Cloud Build, KMS, Pub/Sub, etc.).
- **État du mode simulation :** sur la page de détails du périmètre, la bannière **Dry-run** indique si le périmètre est en mode journalisation seule. Passez `vpc_sc_dry_run = false` après avoir examiné les journaux pour basculer en mode d'application.
- **Appartenance au périmètre :** dans les détails du périmètre, vérifiez que le projet figure sous **Projects** et que les quatre niveaux d'accès attendus (`vpc_access_*`, `admin_access_*`, `iap_access_*`, `cicd_access_*`) sont associés.
- **Journaux d'audit VPC-SC :** accédez à **Logging → Logs Explorer** et filtrez sur `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"` pour identifier les appels d'API refusés par le périmètre.
- **Journalisation d'audit du projet :** lorsque `enable_audit_logging = true`, accédez à **IAM & Admin → Audit Logs** et vérifiez que **Admin Read**, **Data Read** et **Data Write** sont activés pour les services concernés.

**CLI gcloud :**
```bash
# List VPC-SC access policies in the organisation
gcloud access-context-manager policies list \
  --organization=ORGANIZATION_ID

# List VPC-SC perimeters under the access policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"

# Describe a specific perimeter to verify restricted services and project membership
gcloud access-context-manager perimeters describe PERIMETER_NAME \
  --policy=POLICY_NAME \
  --format="yaml(status.resources,status.restrictedServices,status.accessLevels,useExplicitDryRunSpec)"

# Check VPC-SC dry-run / enforcement violation logs for this project
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName,protoPayload.metadata.vpcServiceControlsUniqueId,protoPayload.metadata.dryRun)"

# Confirm project-level audit config (enable_audit_logging)
gcloud projects get-iam-policy PROJECT_ID \
  --format="yaml(auditConfigs)"
```

---

## Isolation dans un projet partagé — compte dédié et clôture {#isolation-in-a-shared-project--dedicated-account-and-fence}

Les applications qui partagent un projet s'exécutaient sous un unique compte de service partagé par le tenant (`cloudrun-sa-<tenant>`). Ce compte détient des droits à l'échelle du projet sur chaque secret et chaque bucket, ainsi que le droit de déployer par-dessus n'importe quel service Cloud Run ; n'importe quelle application pouvait donc lire les identifiants et les données de n'importe quelle autre. Deux paramètres donnent à une application un espace à elle, sans projet à elle.

| Variable | Valeur par défaut | Effet |
|---|---|---|
| `dedicated_service_account_id` | `""` | L'application s'exécute sous son propre compte de service, avec uniquement les rôles réseau, client Cloud SQL et journalisation à l'échelle du projet, plus l'accès à ses propres secrets, buckets et jobs. L'application n'a plus *besoin* des droits du compte partagé. |
| `fence_enabled` | `false` | Empêche tous les autres de *détenir* ces droits sur ce que possède l'application (`fence.tf`). Requiert un compte dédié. |
| `fence_administrators` | `[]` | Personnes (e-mails) qui peuvent toujours accéder aux ressources clôturées de l'application : la personne qui la déploie et les administrateurs d'accès d'urgence (break-glass). |
| `fence_secret_ids` | `[]` | Secrets que le module appelant crée pour l'application en plus de son mot de passe de base de données. N'y listez jamais un secret qu'une autre application lit aussi. |

**Ce que fait la clôture :**

1. **Elle étiquette ce que possède l'application.** Une clé de tag limitée au projet, `fence-<service>` = `fenced`, est liée :
   - au service Cloud Run de l'application et à chacun de ses jobs ;
   - à ses buckets et, à travers eux, à leurs objets ;
   - au secret de son mot de passe de base de données et à `fence_secret_ids`.
2. **Elle ajoute au projet une règle de refus IAM** nommée `fence-<service>`. Sur tout ce qui porte ce tag, personne d'autre que le compte dédié de l'application et `fence_administrators` ne peut :
   - lire ou modifier un secret ;
   - lire ou écrire un objet ;
   - signer avec une clé ;
   - mettre à jour, exécuter ou rediriger le service ou ses jobs.

   Un refus l'emporte sur toute autorisation, y compris les autorisations accordées à l'échelle du projet.

**Ressources possédées par un module appelant.** Si le module appelant crée d'autres ressources pour l'application (un trousseau de clés KMS, par exemple), liez-leur la sortie `fence_tag_value` une fois qu'elles existent, à l'aide de `google_tags_location_tag_binding`. RadFarm_CloudRun le fait pour son trousseau de clés de signature dans `console.tf`.

**Adoption, une application à la fois :**

1. Définissez `dedicated_service_account_id`, appliquez, puis vérifiez que l'application fonctionne toujours. Chaque job et chaque planificateur doit s'exécuter sous le compte dédié : `gcloud run jobs describe` l'indique.
2. Définissez `fence_enabled = true` et `fence_administrators = ["you@example.com"]`, puis appliquez. La personne qui déploie a besoin de `roles/resourcemanager.tagAdmin` et `roles/iam.denyAdmin` sur le projet.
3. Testez depuis l'extérieur de la clôture. En empruntant l'identité du compte partagé, la lecture de l'un des secrets de l'application doit échouer avec `PERMISSION_DENIED`.

**Ce qu'aucune application ne peut clôturer seule :** un identifiant partagé par plusieurs applications.
- **Le mot de passe root de l'instance Cloud SQL partagée**, que les jobs de base de données de chaque application utilisent.
- **Les secrets lus par plusieurs applications**, comme un mot de passe SMTP.

Ceux-ci restent en dehors de toute clôture tant que chaque application en a besoin. Pour la base de données, cela signifie que les jobs de schéma de chaque application doivent s'exécuter sous son propre propriétaire de base de données plutôt qu'en tant que `root`.

## Prérequis du déploiement et analyse des dépendances {#deployment-prerequisites--dependency-analysis}

Cette section récapitule toutes les dépendances externes du déploiement de `App CloudRun`. Les dépendances sont regroupées par mode de défaillance pour vous aider à identifier ce qui doit être en place avant le déploiement, ce qui ne fonctionnera pas sans le signaler, et ce qui requiert une action manuelle après le déploiement.

> **Notation :** *Auto-provisionné* signifie que le module (ou sa bibliothèque `App Common`) crée la ressource automatiquement lors du premier déploiement — aucun prérequis manuel n'est nécessaire.

---

### Niveau 1 — Prérequis bloquants {#tier-1--hard-prerequisites}

Ces configurations empêchent le déploiement de réussir, ou empêchent le service Cloud Run d'atteindre un état sain, si le prérequis indiqué n'est pas satisfait.

| Fonctionnalité | Variable(s) | Exigence |
|---|---|---|
| **Références Secret Manager** | `secret_environment_variables` | Chaque secret nommé dans la map doit exister dans Secret Manager **avant le déploiement**. Créez d'abord le secret dans Secret Manager, puis déployez. |
| **Scripts SQL personnalisés** | `enable_custom_sql_scripts = true` | Le bucket GCS indiqué dans `custom_sql_scripts_bucket` doit exister et tous les fichiers `.sql` doivent être téléversés dans `custom_sql_scripts_path` avant le déploiement. Le bucket applicatif du module lui-même peut servir de bucket de scripts, mais les fichiers de scripts doivent y être placés manuellement avant le premier déploiement. |
| **Import de sauvegarde de base de données** | `enable_backup_import = true` | Le fichier de sauvegarde nommé dans `backup_file` doit exister à la source configurée — le bucket GCS de sauvegarde du module ou un emplacement Google Drive — avant le déploiement. Un fichier manquant fait échouer le Cloud Run Job d'import immédiatement après son déclenchement. |
| **Pipeline CI/CD** | `enable_cicd_trigger = true` | Un dépôt GitHub doit être accessible et un Personal Access Token GitHub (portées : `repo` et `admin:repo_hook`) ou un ID d'installation de GitHub App doit être fourni. Sans identifiants valides, la connexion GitHub de Cloud Build ne peut pas être établie et le déploiement échoue. |
| **Build de conteneur personnalisé** | `container_image_source = "custom"` | Requiert la même connexion au dépôt GitHub et les mêmes identifiants que `enable_cicd_trigger`. Cloud Build échoue pendant le déploiement si le dépôt est injoignable ou si les identifiants sont absents. |
| **VPC Service Controls (projets imbriqués dans un dossier)** | `enable_vpc_sc = true` + projet imbriqué dans un dossier | L'ID d'organisation du projet ne peut pas être découvert automatiquement lorsque le projet se trouve sous un dossier plutôt que directement sous une organisation. `organization_id` doit être fourni explicitement, faute de quoi le périmètre est ignoré avec un avertissement. Pour les projets situés directement sous une organisation ou pour les projets autonomes, ce prérequis ne s'applique pas — voir le §17 pour la matrice complète des cas d'exclusion automatique. |
| **VPC Service Controls (protection contre le verrouillage des administrateurs)** | `enable_vpc_sc = true` | `admin_ip_ranges` doit contenir au moins une plage CIDR avant la création du périmètre. Une liste vide fait ignorer le périmètre avec un avertissement, afin d'éviter un scénario de verrouillage des administrateurs dans lequel aucune identité extérieure au VPC ne pourrait joindre les API. |

---

### Niveau 2 — Défaillances silencieuses {#tier-2--silent-failures}

Ces configurations se déploient avec succès, mais ne fonctionnent pas correctement à l'exécution. Aucune erreur immédiate ne signale le problème.

| Fonctionnalité | Variable(s) | Mode de défaillance | Résolution |
|---|---|---|---|
| **Cache Redis** | `enable_redis = true` + `redis_host` explicite | Les variables d'environnement `REDIS_HOST` et `REDIS_PORT` sont injectées dans le conteneur, mais l'application ne peut pas se connecter si aucun service Redis n'existe à l'adresse indiquée. Le déploiement lui-même réussit sans erreur. | Provisionnez une instance Cloud Memorystore ou une VM Redis et définissez `redis_host` sur son IP privée — le module ne découvre **pas** Memorystore. Laisser `redis_host` vide ne fonctionne que lorsqu'une **VM GCE** NFS `Services GCP` existe (elle héberge aussi Redis) ; une instance Memorystore ou Filestore gérée n'est jamais découverte. |
| **Rotation des secrets** | `secret_rotation_period` | La notification de rotation Pub/Sub est planifiée et se déclenche à l'intervalle configuré, mais **aucune valeur de secret n'est réellement renouvelée**. La notification n'est qu'un déclencheur — le gestionnaire qui génère une nouvelle valeur et met à jour le secret doit être mis en œuvre séparément. | Utilisez `enable_auto_password_rotation = true` pour le mot de passe de la base de données (pris en charge automatiquement par ce module), ou déployez une Cloud Function ou un Cloud Run Job distinct abonné au sujet Pub/Sub de rotation. |

---

### Niveau 3 — Prérequis non bloquants {#tier-3--soft-prerequisites}

Ces fonctionnalités se déploient avec succès, mais requièrent une étape manuelle avant d'être pleinement opérationnelles.

| Fonctionnalité | Variable(s) | Action requise |
|---|---|---|
| **Domaine personnalisé** | `application_domains` (avec `enable_cloud_armor = true`) | Après le déploiement, créez des **enregistrements DNS A** pour chaque domaine, pointant vers l'adresse IP externe de l'équilibreur de charge (indiquée dans les sorties du déploiement). Le provisionnement du certificat SSL géré par Google démarre automatiquement après la propagation DNS et se termine généralement en 10 à 60 minutes. L'application ne sera pas joignable sur le domaine personnalisé tant que le certificat n'aura pas atteint l'état `ACTIVE`. |
| **Identity-Aware Proxy** | `enable_iap = true` | Le projet doit déjà disposer d'une marque OAuth IAP (écran de consentement). Une sonde au moment du plan (`data.external.iap_brand_probe`, reposant sur `scripts/check-iap-brand.sh`) fait échouer le **plan** lorsque le projet n'a pas de marque, car l'activation d'IAP supprime la liaison `allUsers`/`run.invoker` du service dans le même apply, et un échec ultérieur laisserait le service inaccessible à tous. Créez-en d'abord une avec `gcloud iap oauth-brands create --application_title=... --support_email=...`. La sonde renvoie `unknown` et laisse passer lorsqu'elle ne peut pas déterminer la réponse (pas de gcloud, pas d'autorisation, API désactivée). |
| **Préparation du fichier de sauvegarde** | `enable_backup_import = true` | Le fichier de sauvegarde doit être téléversé dans le bucket GCS de sauvegarde (ou Google Drive) **avant** le déploiement qui active cet indicateur. |

---

### Auparavant manuel — désormais auto-provisionné {#previously-manual--now-self-provisioned}

Les éléments suivants étaient documentés comme prérequis bloquants dans les versions antérieures de ce module. Ils sont désormais pris en charge automatiquement et ne requièrent aucune ressource préexistante.

| Fonctionnalité | Variable(s) | Prise en charge actuelle |
|---|---|---|
| **Attesteur, règle et clé KMS de Binary Authorization** | `enable_binary_authorization = true` | `App_Common/modules/app_security` crée de manière idempotente, via des scripts shell, le trousseau de clés de signature KMS (`${project_id}-binauthz-keyring`), la clé `binauthz-signer`, la note Container Analysis `pipeline-attestor`, l'attesteur et la règle Binary Authorization. Si `Services_GCP` a provisionné ces ressources en premier, les scripts détectent leur existence et ignorent leur création. La signature des images s'exécute automatiquement après chaque build. |
| **Trousseau CMEK pour le chiffrement du stockage** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` crée de manière idempotente le trousseau KMS `${project_id}-cmek-keyring` et sa CryptoKey `storage-key` avant l'application de la liaison IAM du stockage. Il est désormais sans risque de définir `manage_storage_kms_iam = true` dès le premier déploiement, sans aucune ressource KMS préexistante. Si `Services_GCP` est déployé avec `enable_cmek = true`, les deux modules ciblent le même nom de trousseau bien connu — celui qui s'exécute en premier le crée ; pour le second, l'opération est sans effet. La liaison KMS de l'agent de service GCS est réaffirmée de manière proactive par `assert_gcs_kms_binding.sh` — cela rompt le cercle vicieux dans lequel une liaison ayant dérivé provoquait auparavant des erreurs « Permission denied on Cloud KMS key » pendant le déploiement et bloquait l'opération même qui l'aurait rétablie. |
| **Agent de service PSA pour Cloud SQL intégré** | Cloud SQL intégré (`database_type != "NONE"`, sans VPC `Services GCP`) | GCP accorde automatiquement `roles/servicenetworking.serviceAgent` lorsque `servicenetworking.googleapis.com` est activé, mais cet octroi est asynchrone et peut dépasser l'attente de 60 s de l'activation de l'API sur les projets neufs (y compris Qwiklabs). Le module provisionne désormais explicitement `google_project_service_identity.servicenetworking_sa` et accorde `google_project_iam_member.servicenetworking_service_agent` avant de créer la connexion PSA, de sorte que l'appel interne `compute.globalAddresses.list` de l'API Service Networking n'est jamais bloqué par une liaison IAM manquante. |
| **Périmètre, règle d'accès et niveaux d'accès VPC Service Controls** | `enable_vpc_sc = true` | `App_Common/modules/app_vpc_sc` découvre automatiquement l'ID d'organisation, réutilise toute règle Access Context Manager existante (ou en crée une nouvelle), provisionne quatre niveaux d'accès par déploiement (VPC, IP d'administration, IAP, CI/CD) et crée un périmètre de service `PERIMETER_TYPE_REGULAR` couvrant chaque API GCP utilisée par ce module. Par défaut, `vpc_sc_dry_run = true`, de sorte que les violations sont seulement journalisées jusqu'à ce que vous validiez et basculiez en mode d'application. Ignoré automatiquement avec un avertissement explicite pour les projets autonomes, les projets imbriqués dans un dossier sans `organization_id` et les déploiements sans `admin_ip_ranges`. |

---

### Dépendance à `Services GCP` pour les ressources partagées {#dependency-on-services-gcp-for-shared-resources}

`Services GCP` est déclaré comme dépendance du module (dépendance à `Services GCP`), mais n'est **pas requis** pour un déploiement autonome. Le module provisionne lui-même toute l'infrastructure nécessaire en mode intégré lorsque `Services GCP` n'a pas été déployé. Il est toutefois fortement recommandé de déployer d'abord `Services GCP` lorsque plusieurs modules applicatifs partagent le même projet GCP — cela centralise l'infrastructure partagée, réduit le coût par déploiement et simplifie la gestion courante.

| Ressource | Sans `Services GCP` | Avec `Services GCP` |
|---|---|---|
| **Réseau VPC** | Le module provisionne automatiquement un VPC, un sous-réseau, un Cloud NAT et un Cloud Router intégrés. Les instances Cloud SQL intégrées rejoignent le VPC via Private Service Access (PSA). | Le module se rattache au VPC partagé géré de manière centralisée. Évite la consommation de quotas de VPC et d'adresses IP par projet ; simplifie la gestion du pare-feu pour tous les déploiements. Aucun VPC intégré ni aucune instance Cloud SQL intégrée ne sont créés dans ce mode — voir la remarque sous le tableau. |
| **Instance Cloud SQL** | Le module provisionne automatiquement une instance Cloud SQL dédiée par déploiement. Chaque déploiement supporte le coût complet d'une instance. | Le module découvre automatiquement l'instance Cloud SQL partagée et s'y connecte, en ne provisionnant qu'une base de données et un utilisateur distincts au sein de celle-ci. Élimine le coût d'instance par déploiement pour les projets comportant plusieurs déploiements d'applications. |
| **NFS / Filestore** | Le module provisionne automatiquement une VM GCE NFS intégrée lorsque `enable_nfs = true`. La VM est un point de défaillance unique, sans sauvegardes gérées. | Le module découvre automatiquement l'instance Filestore gérée de manière centralisée. Fournit un NFS de niveau entreprise avec un débit garanti et des instantanés gérés. |
| **Redis / Memorystore** | `enable_redis = true` avec un `redis_host` vide revient à l'adresse IP de la VM NFS — cela ne fonctionne que si un service compatible Redis s'exécute sur cette même VM. Un `redis_host` explicite doit être défini pour se connecter à une instance Redis dédiée. | Le module découvre automatiquement l'instance Memorystore partagée. `redis_host` peut être laissé vide. |
| **Artifact Registry** | Le module crée automatiquement un dépôt Artifact Registry par déploiement. | Le module découvre automatiquement et utilise le registre partagé, ce qui permet la réutilisation des images et des règles d'analyse des vulnérabilités cohérentes pour tous les déploiements. |
| **Binary Authorization** | `app_security` provisionne lui-même automatiquement l'attesteur, la clé KMS et la règle (voir ci-dessus). | `Services GCP` (avec `enable_binary_authorization = true`) provisionne les mêmes ressources de manière centralisée, avec un `binauthz_evaluation_mode` configurable (`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`). Recommandé pour les environnements de production qui exigent l'application des attestations. |
| **Chiffrement CMEK** | `app_cmek` provisionne lui-même automatiquement `${project_id}-cmek-keyring` et `storage-key` (voir ci-dessus). | `Services GCP` (avec `enable_cmek = true`) provisionne le trousseau avec une période de rotation configurable et applique CMEK simultanément à Cloud SQL, Artifact Registry et aux autres ressources partagées, offrant une base de chiffrement cohérente pour toute l'infrastructure partagée. |
| **Périmètre VPC Service Controls** | `app_vpc_sc` provisionne lui-même la règle d'accès, quatre niveaux d'accès et un périmètre `PERIMETER_TYPE_REGULAR` limité à ce déploiement (suffixé par `deployment_id`) — voir ci-dessus. | `Services GCP` peut héberger un unique périmètre partagé entre tous les déploiements du projet, offrant des règles d'entrée/sortie cohérentes et une application plus simple. Recommandé pour les organisations qui gèrent déjà VPC-SC de manière centralisée ; sinon, le périmètre auto-provisionné par déploiement suffit. |
| **Journalisation d'audit du projet** | `enable_audit_logging = true` configure `google_project_iam_audit_config` pour `allServices`, avec des remplacements pour Secret Manager et KMS. Ne requiert aucune infrastructure supplémentaire. | `Services GCP` (avec `enable_audit_logging = true`) provisionne les mêmes configurations d'audit une seule fois au niveau du projet — recommandé lorsque plusieurs déploiements partagent le projet, pour éviter des ressources de configuration d'audit IAM en double. |

> **Les deux colonnes s'excluent mutuellement ; il ne s'agit pas d'un repli ressource par ressource.** Le comportement « Sans `Services GCP` » ne s'applique que lorsqu'aucun réseau VPC n'est découvert. Sur le chemin par défaut (`network_name = ""`), la découverte cible spécifiquement un réseau géré par `Services GCP`, de sorte que « aucun réseau trouvé » et « aucun déploiement `Services GCP` » coïncident. Définir explicitement `network_name` sur n'importe quel VPC existant satisfait aussi la vérification du réseau, mais cela ne vous donne **pas** la colonne « Avec » : les replis intégrés sont supprimés alors que la découverte de Cloud SQL, du NFS et du registre ne trouve toujours rien (Cloud SQL et NFS filtrent sur `managed-by=services-gcp` ; la découverte du registre filtre sur `labels.module=services-gcp`, avec un repli sur une correspondance de nom `shared-repo-` sans filtre de libellé), de sorte qu'avec les valeurs par défaut (`database_type = "POSTGRES"`, `enable_nfs = true`), les préconditions ci-dessous font échouer le plan. Chaque garde est conditionnelle : un déploiement qui n'a besoin d'aucune de ces ressources — pas de base de données, pas de NFS, une image préconstruite, pas de CI/CD — n'en déclenche aucune et s'applique sur un VPC arbitraire. Une fois ce réseau trouvé, ce module ne crée jamais d'instance Postgres, d'instance MySQL, de VM NFS ni de dépôt Artifact Registry intégrés, même si `Services GCP` a été déployé sans cette ressource particulière. Chacune de ces ressources intégrées porterait exactement le même nom préfixé par le tenant que celle de `Services GCP`, si bien qu'un repli silencieux ressource par ressource risquerait une collision ultérieure lors de la destruction, l'apply de ce module supprimant la ressource partagée que `Services GCP` suit toujours dans son propre état. À la place, quatre préconditions font échouer le **plan** avec un message explicite vous invitant à redéployer `Services GCP` avec la ressource manquante activée (`create_postgres`, `create_mysql`, `create_network_filesystem` ou un registre partagé découvrable). Définissez `requires_services` (groupe 0) pour que la plateforme active les bons interrupteurs `create_*` lorsqu'elle provisionne automatiquement `Services GCP` pour vous.

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

> **De nombreuses combinaisons invalides sont détectées au moment du plan.** Le module comporte 29 préconditions croisées entre variables (`validation.tf`) ainsi que des blocs `validation` par variable, de sorte qu'une large catégorie d'erreurs de configuration fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource. Les lignes ci-dessous marquées **🛡 au plan** sont rejetées d'emblée — vous n'atteignez jamais la conséquence décrite. Les lignes non marquées sont des risques *d'exécution* ou *opérationnels* (un mauvais port, une sauvegarde obsolète laissée activée, un renommage destructeur) que le module ne peut pas trancher pour vous en toute sécurité — ils restent sous votre responsabilité. Un plan sans erreur confirme que les règles de valeurs et de combinaisons sont respectées ; il ne valide pas qu'un port correspond à votre application ni qu'un renommage est intentionnel.

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `container_image_source` + `container_image` | `"custom"` (build depuis les sources), ou `"prebuilt"` **avec** un `container_image` non vide | **Élevé** 🛡 au plan | `"prebuilt"` avec un `container_image` vide n'a aucune URI d'image à déployer — désormais rejeté au moment du plan. |
| `enable_cdn` + `enable_cloud_armor` | N'activer le CDN qu'avec Cloud Armor | **Moyen** 🛡 au plan | `enable_cdn = true` avec `enable_cloud_armor = false` n'a aucun équilibreur de charge auquel rattacher le CDN — le paramètre était ignoré silencieusement ; désormais rejeté au moment du plan. |
| `cicd_enable_cloud_deploy` + `enable_cloud_deploy` | Définir les deux ensemble, ou aucun | **Moyen** 🛡 au plan | Acheminer les builds CI/CD via Cloud Deploy sans `enable_cloud_deploy = true` laisse le build sans pipeline de livraison dans lequel publier — désormais rejeté au moment du plan. |
| `mount_nfs` (jobs/sidecars) + `enable_nfs` | Activer NFS dès qu'un job ou un sidecar le monte | **Élevé** 🛡 au plan | Un job/sidecar avec `mount_nfs = true` alors que `enable_nfs = false` (et sans serveur NFS découvrable) référence un volume qui n'existe pas — désormais rejeté au moment du plan. |
| `enable_postgres_extensions` / `enable_mysql_plugins` + `database_type` | Faire correspondre l'interrupteur à la famille de moteur | **Moyen** 🛡 au plan | Activer des extensions Postgres sur un moteur MySQL (ou l'inverse) est rejeté au moment du plan. *(Défaut corrigé : les listes autorisées incluent désormais correctement `POSTGRES_15` et `MYSQL_8_0`, qui étaient auparavant rejetés à tort.)* |
| `application_name` | Court, en minuscules, compatible avec les traits d'union (par ex. `"myapp"`, `"payments-api"`) | **Critique** | Intégré au nom de chaque ressource GCP (service Cloud Run, secrets, instance SQL, buckets GCS). **Ne le modifiez jamais après le premier déploiement** — toutes les ressources nommées sont détruites puis recréées, ce qui entraîne une perte totale des données et une nouvelle base de données vide. |
| `tenant_id` | Correspondant à l'environnement : `"prod"`, `"staging"`, `"dev"` | **Critique** | Intégré à tous les noms de ressources avec `application_name`. **Ne le modifiez jamais après le premier déploiement** — même conséquence que la modification de `application_name` : recréation complète des ressources et perte de données. |
| `enable_cloudsql_volume` | `true` (injecter le sidecar Cloud SQL Auth Proxy — la voie sécurisée) | **Élevé** | La valeur par défaut est `true` — correcte pour les applications qui utilisent Cloud SQL. **Définissez `false` pour les applications qui n'utilisent pas Cloud SQL** (par ex. services sans état ou applications avec une base de données externe) : le laisser à `true` injecte un conteneur sidecar inutilisé, ce qui augmente le temps de démarrage à froid et la consommation de ressources. Définir `false` alors que Cloud SQL est nécessaire oblige les applications à joindre directement l'IP privée — les règles de pare-feu doivent l'autoriser et l'authentification IAM est perdue. |
| `container_port` | Doit correspondre exactement au port sur lequel le serveur d'application se lie (par ex. `8080`, `3000`, `5000`) | **Critique** | Incohérence de port : la sonde de démarrage de Cloud Run échoue immédiatement sur chaque instance. Toutes les requêtes renvoient HTTP 502. Le service ne devient jamais sain et redémarre en continu. |
| `execution_environment` | `"gen2"` (toujours ; requis pour les montages NFS et GCS Fuse) | **Élevé** 🛡 au plan | `"gen1"` avec `enable_nfs = true` ou `gcs_volumes` configuré est rejeté au moment du plan (gen1 ne prend pas en charge les montages NFS/GCS Fuse), au lieu de faire échouer silencieusement le montage du volume au démarrage du conteneur. |
| `ingress_settings` | `"internal-and-cloud-load-balancing"` lorsque `enable_cloud_armor = true` ; `"all"` pour les services publics sans équilibreur de charge | **Élevé** | `"all"` avec `enable_cloud_armor = true` : l'URL `*.run.app` de Cloud Run reste accessible publiquement, contournant entièrement l'équilibreur de charge et le WAF Cloud Armor. Des attaquants peuvent joindre l'application directement, ce qui rend l'investissement dans le WAF inutile. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` pour les applications qui n'ont besoin que de ressources VPC privées ; `"ALL_TRAFFIC"` pour les applications qui appellent des API externes via Cloud NAT | **Élevé** | `"PRIVATE_RANGES_ONLY"` bloque tout le trafic sortant vers des IP publiques, y compris un Redis externe, des API tierces et des webhooks SaaS. Les applications qui appellent des services externes doivent définir `"ALL_TRAFFIC"`. Symptôme : expirations de connexion silencieuses vers tout ce qui se trouve hors RFC 1918. |
| `enable_iap` + `iap_authorized_users` / `iap_authorized_groups` | Ne définir `enable_iap = true` qu'après avoir renseigné au moins un utilisateur ou un groupe | **Critique** 🛡 au plan | `enable_iap = true` avec les deux listes vides bloquerait tout le monde (100 % de HTTP 403, vous compris) — désormais rejeté au moment du plan, de sorte que vous ne pouvez pas déployer un service inaccessible. Ajoutez au moins votre propre e-mail à `iap_authorized_users`. |
| `enable_cloud_armor` + `ingress_settings` | Toujours associer `enable_cloud_armor = true` à `ingress_settings = "internal-and-cloud-load-balancing"` | **Élevé** | `enable_cloud_armor = true` avec `ingress_settings = "all"` : Cloud Armor protège le chemin de l'équilibreur de charge, mais l'URL `*.run.app` le contourne entièrement. Les clients qui découvrent l'URL directe échappent à toutes les règles WAF et limites de débit. |
| `min_instance_count` | `1` pour les applications de production sensibles à la latence ou avec état ; `0` pour le développement/le traitement par lots | **Élevé** | `0` pour les applications avec état (bases de données, sessions persistantes) : avec le scale-to-zero, tout état en mémoire ou sur disque local est perdu à l'arrêt de l'instance. À la requête suivante, la nouvelle instance démarre à froid sans aucun état antérieur. Risque de perte de données ou de corruption de l'état des sessions. |
| `enable_backup_import` | `false` (par défaut) — ne définir `true` que pour effectuer une restauration | **Critique** | Laisser `enable_backup_import = true` après une restauration réussie : le job d'import se réexécute à chaque déploiement ultérieur et écrase la base de données active avec le fichier de sauvegarde obsolète. **Repassez toujours à `false` immédiatement après une restauration réussie.** |
| `backup_file` | Doit correspondre exactement au nom de fichier présent dans la source de sauvegarde (extension comprise) | **Élevé** | Incohérence de nom de fichier : le Cloud Run Job d'import échoue immédiatement avec une erreur « file not found ». Aucune donnée n'est importée, mais l'apply du déploiement réussit — l'échec n'est visible que dans les journaux d'exécution du job. |
| `secret_rotation_period` | `"2592000s"` (30 jours) — doit inclure le suffixe `s` | **Élevé** 🛡 au plan | L'omission du suffixe `s` (par ex. `"2592000"`) est rejetée au moment du plan par la validation de format de la variable, au lieu d'être acceptée puis de ne pas enregistrer silencieusement la notification de rotation. |
| `enable_auto_password_rotation` + `rotation_propagation_delay_sec` | N'activer qu'après avoir validé le pipeline de rotation ; conserver `rotation_propagation_delay_sec` ≥ `90` | **Élevé** | `rotation_propagation_delay_sec` trop court (par ex. `10`) : l'ancienne version du mot de passe de la base de données est désactivée avant que tous les pods en cours d'exécution n'aient redémarré avec le nouvel identifiant. L'épuisement du pool de connexions provoque des erreurs HTTP 500 jusqu'à ce que tous les pods aient achevé un cycle de redémarrage complet. |
| `enable_binary_authorization` + `binauthz_evaluation_mode` | Commencer par `"ALWAYS_ALLOW"` ; passer à `"REQUIRE_ATTESTATION"` uniquement une fois que le pipeline CI produit des attestations valides | **Critique** | `"REQUIRE_ATTESTATION"` sans pipeline CI qui atteste les images : **le déploiement de toutes les nouvelles révisions échoue** avec `Image is not attested`. Les retours arrière sont également bloqués. `"ALWAYS_DENY"` bloque immédiatement tous les déploiements, y compris les correctifs d'urgence. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | Toujours activer d'abord avec `vpc_sc_dry_run = true` ; examiner les journaux d'audit avant d'appliquer | **Critique** | `vpc_sc_dry_run = false` dès la première activation : tout compte principal, IP ou service qui ne figure pas explicitement dans le niveau d'accès est immédiatement bloqué. Le compte de service Cloud Build, le compte de service Cloud Run et votre IP d'administration doivent tous figurer dans un niveau d'accès avant l'application — sinon Cloud Build, les déploiements et l'application en cours d'exécution échouent tous simultanément. |
| `organization_id` | Requis pour les projets imbriqués dans un dossier lorsque `enable_vpc_sc = true` | **Élevé** | Projet imbriqué dans un dossier sans `organization_id` : le périmètre VPC-SC est ignoré silencieusement avec un avertissement. Aucune erreur n'est levée, mais aucun périmètre n'est créé — le contrôle de sécurité que vous visiez est absent. |
| Étape prod de `cloud_deploy_stages` | `require_approval = true` sur l'étape de production | **Critique** | `require_approval = false` combiné à `auto_promote = true` sur l'étape prod : un déploiement réussi en préproduction est automatiquement promu en production sans aucune revue humaine. Un build défectueux ou une mauvaise migration atteint automatiquement la production. |
| `enable_image_mirroring` | `true` (par défaut ; fortement recommandé) | **Élevé** | `false` : Cloud Run télécharge les images directement depuis des registres externes (Docker Hub, GHCR). Soumis aux limites de débit de téléchargement (HTTP 429 pendant les déploiements). Dans les environnements VPC-SC, l'accès aux registres externes est bloqué — les nouvelles révisions échouent avec `ImagePullBackOff` et le service ne peut pas être mis à jour. |
| `database_type` | Valeur à version fixée en production (par ex. `"POSTGRES_15"`) plutôt que le générique `"POSTGRES"` | **Critique** | **Modifier `database_type` après le premier déploiement remplace l'instance Cloud SQL** — toutes les données de la base de données existante sont détruites. Ne le modifiez jamais après le premier apply sans une sauvegarde validée et un plan de restauration testé. |
| `application_database_name` | En minuscules, lié à l'application (par ex. `"myappdb"`) — ne jamais le modifier après le premier déploiement | **Critique** | Le modifier crée une nouvelle base de données vide sous le nouveau nom ; la base de données d'origine, avec toutes ses données, reste orpheline sur l'instance. L'application démarre sur un schéma vide et échoue à chaque appel à la base de données. |
| `storage_buckets[].force_destroy` | `false` pour les buckets de production contenant des données utilisateur | **Critique** | `true` sur un bucket de production : le retrait du déploiement supprime définitivement tout le contenu du bucket, sans récupération possible. `false` sur un bucket temporaire qui doit être supprimé : le retrait du déploiement échoue tant que le bucket n'a pas été vidé manuellement. |
| `startup_probe_config.path` | Un point de terminaison rapide et léger qui renvoie HTTP 200 lorsque l'application est prête (par ex. `"/healthz"`) | **Critique** | Chemin incorrect (renvoie 404 ou 500) : Cloud Run ne considère jamais l'instance comme saine et ne lui achemine jamais de trafic. L'instance redémarre en continu. Le service est hors ligne pour tous les utilisateurs. |
| `enable_redis` | `false` pour les applications qui n'utilisent pas Redis | **Moyen** | Laissé à la valeur par défaut `true` pour une application sans Redis : `REDIS_HOST` prend par défaut l'IP du serveur NFS. Si aucun service compatible Redis ne s'y exécute, l'application journalise des erreurs de connexion à chaque démarrage. Définissez explicitement `false` pour les applications qui n'utilisent pas Redis. |
| `max_revisions_to_retain` | `7` (par défaut) — suffisant pour la plupart des besoins de retour arrière | **Faible** | `0` : toutes les anciennes révisions sont supprimées immédiatement. Le retour arrière vers une révision antérieure est impossible — seule la révision servant actuellement le trafic est conservée. Trop élevé (par ex. `100`) : le quota d'API de liste des révisions Cloud Run est consommé plus vite et la console devient difficile à parcourir. |
| `secret_propagation_delay` | `30` secondes (par défaut) ; augmenter à `60`–`90` pour les déploiements multirégionaux | **Moyen** | Trop court dans les configurations multirégionales : une nouvelle révision Cloud Run démarre avant que la nouvelle version du secret ne se soit répliquée globalement. L'instance lit l'ancien identifiant (potentiellement tout juste renouvelé) et échoue à s'authentifier. Augmentez-le si vous constatez des erreurs intermittentes de secret introuvable lors de nouveaux déploiements. |

---

## Sorties {#outputs}

Le module expose les sorties suivantes après un déploiement réussi.

### Informations sur le service {#service-information}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run |
| `service_url` | URL HTTPS du service Cloud Run (URL `.run.app`) |
| `service_location` | Région GCP dans laquelle le service Cloud Run est déployé |
| `stage_services` | Map nom d'étape → `{ name, uri }` pour les déploiements multi-étapes Cloud Deploy ; map vide lorsque `enable_cloud_deploy` vaut `false` |

### Équilibreur de charge {#load-balancer}

| Sortie | Description |
|---|---|
| `load_balancer_ip` | Adresse IP externe statique de l'équilibreur de charge HTTPS ; `null` lorsque `enable_cloud_armor` vaut `false` |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge ; utilise un domaine de développement `nip.io` lorsqu'aucun domaine personnalisé n'est défini ; `null` lorsqu'aucun équilibreur de charge n'existe |

### Base de données {#database}

| Sortie | Description |
|---|---|
| `database_instance_name` | Nom de l'instance Cloud SQL ; `null` lorsque `database_type = "NONE"` |
| `database_name` | Nom de la base de données de l'application au sein de l'instance |
| `database_user` | Nom de l'utilisateur de base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `database_host` | IP interne de l'instance Cloud SQL *(sensible)* |
| `database_port` | Port sur lequel la base de données écoute |

### Stockage {#storage}

| Sortie | Description |
|---|---|
| `storage_buckets` | Map nom logique du bucket → nom du bucket pour tous les buckets GCS provisionnés ; map vide lorsque `create_cloud_storage` vaut `false` |

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
| `nfs_instance_tags` | Tags réseau, séparés par des virgules, de la VM GCE NFS ; vide pour les instances Filestore |
| `nfs_mount_path` | Chemin du système de fichiers du conteneur où le volume NFS est monté |
| `nfs_share_path` | Chemin d'export sur le serveur NFS |

### Conteneur et registre {#container--registry}

| Sortie | Description |
|---|---|
| `container_image` | URI pleinement qualifiée de l'image de conteneur utilisée par le service déployé |
| `container_registry` | Nom du dépôt Artifact Registry ; `null` lorsqu'aucun build personnalisé n'est configuré |

### Supervision {#monitoring}

| Sortie | Description |
|---|---|
| `monitoring_enabled` | Indique si Cloud Monitoring est configuré (`true`/`false`) |
| `monitoring_notification_channels` | Liste des noms des canaux de notification Cloud Monitoring |
| `uptime_check_names` | Liste des noms de configuration des tests de disponibilité ; vide lorsque le test de disponibilité est désactivé ou que le point de terminaison n'est pas joignable publiquement |

### Métadonnées du déploiement {#deployment-metadata}

| Sortie | Description |
|---|---|
| `deployment_id` | Identifiant unique du déploiement (suffixe hexadécimal aléatoire généré automatiquement) |
| `tenant_id` | Identifiant du tenant dérivé de `tenant_id` |
| `resource_prefix` | Préfixe de nommage appliqué aux ressources GCP de ce déploiement |
| `project_id` | ID du projet GCP |
| `project_number` | Numéro du projet GCP |

### Jobs {#jobs}

| Sortie | Description |
|---|---|
| `initialization_jobs` | Map clé du job → nom du Cloud Run Job pour tous les jobs d'initialisation provisionnés |
| `nfs_setup_job` | Nom du Cloud Run Job de configuration NFS ; `null` lorsqu'il n'est pas créé |

### CI/CD {#cicd}

| Sortie | Description |
|---|---|
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté à Cloud Build |
| `github_repository_owner` | Propriétaire / organisation du dépôt GitHub |
| `github_repository_name` | Nom du dépôt GitHub |
| `artifact_registry_repository` | Objet contenant `name`, `location` et `url` du dépôt Artifact Registry ; `null` lorsque ni un build personnalisé ni la CI/CD ne sont activés |
| `cloudbuild_trigger_name` | Nom du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` vaut `false` |
| `cloudbuild_trigger_id` | ID du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` vaut `false` |
| `cicd_configuration` | Objet contenant tous les détails de la CI/CD (nom/ID du déclencheur, informations du dépôt, motif de branche, URL du registre, e-mail du compte de service) ; `null` lorsqu'aucun déclencheur n'existe |

### VPC Service Controls {#vpc-service-controls}

| Sortie | Description |
|---|---|
| `vpc_sc_enabled` | Indique si le périmètre VPC-SC a été créé avec succès |
| `vpc_sc_perimeter_name` | Nom de ressource du périmètre de service VPC-SC ; `null` lorsqu'il n'est pas activé |
| `vpc_sc_dry_run_mode` | Indique si VPC-SC est en mode simulation (`true`) ou en application active (`false`) |
| `audit_logging_enabled` | Indique si les Cloud Audit Logs au niveau du projet sont activés (reflète `enable_audit_logging`) |
| `artifact_registry_cmek_enabled` | Indique si le chiffrement CMEK d'Artifact Registry est configuré (reflète `enable_artifact_registry_cmek`) |
## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 serverless {#known-deletion-issue-serverless-ipv4-address-release}

Lors du retrait d'un déploiement Cloud Run, GCP peut conserver des adresses IPv4 serverless sur le sous-réseau VPC pendant 20 à 30 minutes après la suppression du service Cloud Run. Si cela se produit pendant le nettoyage, attendez 20 à 30 minutes et relancez le retrait. La seconde tentative réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : App CloudRun](../labs/App_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module App GKE — Guide de configuration](App_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [App Common — Guide de configuration](App_Common.md) — la configuration commune aux deux cibles de déploiement.
