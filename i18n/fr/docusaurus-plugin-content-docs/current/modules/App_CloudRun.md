---
title: "Module App CloudRun — Guide de configuration"
description: "Référence de configuration pour le déploiement d'applications sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/App_CloudRun.md @ 40c83c3f sha256:64583a019088 -->

# Module App CloudRun — Guide de configuration {#app-cloudrun-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/App_CloudRun.png" alt="Module App CloudRun — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `App CloudRun`, organisée en groupes fonctionnels. Pour chaque variable, il explique les options disponibles, les implications de chaque choix et comment valider la configuration résultante dans la console Google Cloud ou à l'aide de la CLI `gcloud`.

---

## Services GCP déployés {#deployed-gcp-services}

Un déploiement `App CloudRun` entièrement configuré provisionne et intègre les services GCP suivants :

- **Cloud Run v2** — Environnement d'exécution de conteneurs entièrement géré et sans serveur, avec mise à l'échelle automatique, répartition du trafic et gestion des révisions.
- **Cloud Build** — Pipeline de build d'images de conteneurs et déclencheur CI/CD connecté à GitHub.
- **Artifact Registry** — Dépôt d'images de conteneurs avec politiques de nettoyage configurables et chiffrement CMEK facultatif.
- **Cloud SQL** — Instance de base de données gérée PostgreSQL, MySQL ou SQL Server avec sidecar Cloud SQL Auth Proxy.
- **Cloud Storage (GCS)** — Buckets d'application avec montages GCS Fuse facultatifs à l'intérieur des conteneurs Cloud Run.
- **Cloud Filestore / VM NFS GCE** — Stockage NFS persistant partagé accessible simultanément par toutes les instances Cloud Run.
- **Secret Manager** — Stockage sécurisé pour les mots de passe de base de données, les jetons GitHub et les secrets d'application ; injectés dans les conteneurs en tant que variables d'environnement.
- **Cloud Monitoring** — Tests de disponibilité, politiques d'alerte et canaux de notification pour `support_users`.
- **Cloud Deploy** *(facultatif)* — Pipeline de livraison progressive multi-étapes avec portes de promotion et approbations manuelles facultatives.
- **Cloud Armor** *(facultatif)* — Politique de sécurité WAF attachée à l'équilibreur de charge HTTPS devant Cloud Run.
- **Identity-Aware Proxy** *(facultatif)* — Authentification par identité Google appliquée au niveau de l'équilibreur de charge.
- **Certificate Manager** *(facultatif)* — Certificats SSL gérés par Google pour les domaines personnalisés.
- **VPC Service Controls** *(facultatif)* — Périmètre d'API restreignant l'accès aux services GCP aux identités au sein du VPC et approuvées.
- **Binary Authorization** *(facultatif)* — Application de politiques exigeant des images de conteneurs attestées avant le déploiement.

---

## Prérequis {#prerequisites}

Avant de déployer App CloudRun :

1. **Projet GCP** avec facturation activée.
2. **Module Services GCP** (fournit Cloud SQL partagé, NFS partagé, Artifact Registry partagé et VPC partagé). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme le provisionne automatiquement avant votre déploiement s'il n'existe pas déjà dans le projet cible. App CloudRun peut également fonctionner en mode autonome entièrement intégré sans Services GCP (`require_services_gcp_module = false`), mais chaque déploiement provisionne alors son propre VPC, sa propre VM NFS et sa propre instance Cloud SQL.
3. **Permissions IAM** : Le compte de service de déploiement nécessite des permissions étendues au niveau du projet (Éditeur de projet ou équivalent) pour créer des services Cloud Run, des utilisateurs Cloud SQL, des buckets GCS et des secrets Secret Manager.
4. Les **secrets Secret Manager** référencés dans `secret_environment_variables` doivent exister avant le déploiement — le déploiement échoue si un secret référencé est absent.
5. Pour la **CI/CD** (`enable_cicd_trigger = true`) : un dépôt GitHub et soit un jeton d'accès personnel GitHub (scopes : `repo`, `admin:repo_hook`), soit un ID d'installation d'application GitHub.
6. Pour **IAP** (`enable_iap = true`) : un client OAuth 2.0 pré-créé (ID client et secret) depuis **API et services → Identifiants** et un écran de consentement OAuth configuré.
7. Pour l'**importation de sauvegarde** (`enable_backup_import = true`) : le fichier de sauvegarde doit être téléchargé dans le bucket de sauvegarde GCS avant le déploiement.

---

## Groupe 0 — Métadonnées du module et câblage de la plateforme {#group-0--module-metadata--platform-wiring}

Ces variables sont consommées par la plateforme de déploiement plutôt que par les ressources Terraform elles-mêmes. Les variables préfixées par `module_*` (`module_storage_buckets`, `module_env_vars`, `module_secret_env_vars`, `module_writable_secret_ids`, `module_explicit_secret_values`) et `scripts_dir` sont renseignées par un module d'application (wrapper) — tel que `Ghost_CloudRun` — qui appelle `App_CloudRun` en tant que module enfant ; elles doivent être laissées à leurs valeurs par défaut vides lors du déploiement de `App_CloudRun` en mode autonome. `additional_cloudrun_sa_roles` est une véritable variable fonctionnelle (elle accorde des rôles IAM supplémentaires) qui se trouve partager ce groupe.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `module_description` | *(description du module)* | Toute chaîne de caractères | Description lisible par l'homme de l'objectif du module, affichée dans l'interface utilisateur de la plateforme. Métadonnées uniquement — ne pas modifier sauf si vous personnalisez le module pour un fork. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/modules/App_CloudRun"` | Chaîne d'URL | Lien vers la documentation externe de ce module, affiché dans l'interface utilisateur de la plateforme comme référence d'aide. Métadonnées uniquement. |
| `module_dependency` | `["Services_GCP"]` | Liste de chaînes de noms de modules | Autres modules de plateforme qui doivent être déployés avant celui-ci. Utilisé par la plateforme pour faire respecter l'ordre de déploiement. Métadonnées uniquement. |
| `module_services` | `["Cloud Run", …]` | Liste de chaînes de noms de services GCP | Services GCP activés ou consommés par ce module. Utilisé pour la documentation et la visibilité des services de la plateforme. Métadonnées uniquement. |
| `credit_cost` | `0` | Entier | Crédits de plateforme consommés lors du déploiement de ce module. Utilisé par le système de facturation de la plateforme. Métadonnées uniquement. |
| `require_credit_purchases` | `false` | `true` / `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts ou événementiels. |
| `enable_purge` | `true` | `true` / `false` | Permet la suppression complète de toutes les ressources gérées par le module lors de la destruction. Définir `false` pour conserver les ressources après la suppression du module, protégeant ainsi contre la perte accidentelle de données. Métadonnées uniquement. |
| `public_access` | `true` | `true` / `false` | Contrôle si ce module est publiquement listé dans le catalogue de la plateforme. Métadonnées uniquement. |
| `require_services_gcp_module` | `true` | `true` / `false` | Lorsque `true`, le déploiement échoue au moment de la planification avec une erreur claire si aucun réseau VPC géré par `Services_GCP` n'est détecté dans le projet. Définir `false` pour autoriser un déploiement autonome avec des ressources prérequises intégrées. |
| `requires_services` | `{ create_postgres = true, create_network_filesystem = true, … }` | Objet de booléens `create_*` | Carte explicite des ressources provisionnées par `Services_GCP` dont ce module a besoin, indépendamment des valeurs par défaut actuelles des variables de `Services_GCP`. La plateforme lit cette carte — et non `module_services`, qui n'est qu'une liste lisible par l'homme pour l'interface utilisateur de confirmation de déploiement — pour décider quels toggles `Services_GCP` `create_*` doivent être activés lorsqu'elle provisionne ou met à jour automatiquement le déploiement `Services_GCP` partagé pour le projet de destination. Les clés reflètent les noms de variables booléennes de `Services_GCP` 1:1 : `create_postgres`, `create_mysql`, `create_redis`, `create_network_filesystem`, `create_filestore_nfs`, `create_google_kubernetes_engine`, `create_firestore`, `enable_alloydb`. Par défaut, `create_postgres = true` et `create_network_filesystem = true` avec tous les autres `false`. `create_redis` et `create_filestore_nfs` restent délibérément `false` sur le chemin automatisé : la VM NFS+Redis gratuite de Compute Engine (`create_network_filesystem`) est ce que chaque déploiement automatisé obtient, et le passage à Cloud Memorystore/Filestore géré est une optimisation manuelle post-déploiement plutôt que quelque chose qu'une chaîne de dépendances automatisée demande d'elle-même. |
| `shared_users` | `[]` | Liste d'adresses e-mail | Utilisateurs qui peuvent afficher et déployer ce module quelle que soit la configuration `public_access`. |
| `technical_support_users` | `[]` | Liste d'adresses e-mail | Utilisateurs responsables de la fourniture du support technique pour ce module. Le portail de déploiement achemine les demandes de support vers ces adresses. Métadonnées uniquement. |
| `resource_creator_identity` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | E-mail du compte de service | Compte de service utilisé par Terraform pour créer et gérer les ressources. À remplacer par un compte de service spécifique au projet pour les déploiements de production. |
| `impersonation_service_account` | `""` | E-mail du compte de service | Compte de service à emprunter lorsque les scripts shell (découverte, mise en miroir d'images, configuration NFS) appellent les API GCP. Requis pour les déploiements inter-projets ; laisser vide pour utiliser les propres identifiants de l'exécuteur. |
| `job_execution_wait_timeout` | `900` | Entier (secondes) | Nombre maximal de secondes pendant lesquelles un déploiement attend qu'une exécution de job d'initialisation ou de configuration de base de données se termine avant d'avorter. Limite les provisionneurs `gcloud run jobs execute --wait` afin qu'un job bloqué fasse échouer l'apply rapidement. |
| `module_storage_buckets` | `[]` | Liste d'objets de définition de bucket | Définitions de buckets GCS supplémentaires injectées par un module wrapper ; fusionnées avec `storage_buckets` à l'exécution. Laisser vide lors du déploiement autonome. |
| `module_env_vars` | `{}` | Carte de `"VAR_NAME" = "value"` | Variables d'environnement en texte brut supplémentaires injectées par un module wrapper ; fusionnées avec `environment_variables`. Laisser vide lors du déploiement autonome. |
| `module_secret_env_vars` | `{}` | Carte de `"VAR_NAME" = "secret-name"` | Références de variables d'environnement Secret Manager supplémentaires injectées par un module wrapper ; fusionnées avec `secret_environment_variables`. Laisser vide lors du déploiement autonome. |
| `module_writable_secret_ids` | `{}` | Carte de clé secrète → ID secret | ID de secrets Secret Manager où le compte de service de la charge de travail a besoin d'un accès `secretVersionAdder` (écriture). Définis par les modules d'application dont les hooks post-installation écrivent des valeurs dans Secret Manager. |
| `module_service_needs_root_password` | `false` | `true` / `false` | Défini par un wrapper d'application dont le **service en cours d'exécution** lit `ROOT_PASSWORD`, le mot de passe root de l'instance Cloud SQL partagée. Par défaut, il n'atteint que les jobs de base de données (db-create, init, cron, extensions, plugins, backup, cleanup), jamais le service principal : une application en cours d'exécution ne détient pas l'identifiant qui peut lire ou supprimer la base de données de toutes les autres applications sur l'instance. Seul Nextcloud le définit (son point d'entrée amorce l'utilisateur de la base de données en tant que root lorsque db-init n'a pas été exécuté). |
| `module_explicit_secret_values` | `{}` | Carte de `"VAR_NAME" = "value"` | Valeurs secrètes brutes fournies directement par un module wrapper. Les clés doivent correspondre aux entrées de `module_secret_env_vars`. Lorsqu'elles sont fournies, la recherche de la source de données Secret Manager au moment de la planification est ignorée pour ces clés, ce qui permet au premier apply de réussir avant que les secrets n'existent. |
| `scripts_dir` | `""` | Chemin du système de fichiers | Répertoire contenant les scripts d'initialisation et utilitaires. Par défaut, le répertoire des scripts intégrés du module s'il est laissé vide. À remplacer lorsqu'un module wrapper fournit des scripts personnalisés. |
| `additional_cloudrun_sa_roles` | `[]` | Liste de chaînes de rôles IAM | Rôles IAM supplémentaires accordés au compte de service Cloud Run en plus de l'ensemble standard. À utiliser lorsqu'un module d'application nécessite des permissions GCP non incluses dans la liste des rôles de base (par exemple, `roles/datastore.owner` pour la gestion des utilisateurs Firestore). |

---

## Groupe 1 — Projet et identité {#group-1--project--identity}

Ces variables établissent le contexte du projet GCP et les paramètres d'identité partagés qui s'appliquent à toutes les ressources créées par le module. Elles doivent être configurées correctement avant qu'un déploiement puisse réussir.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `project_id` | *(requis)* | `[a-z][a-z0-9-]{4,28}[a-z0-9]` | L'ID du projet GCP où toutes les ressources seront provisionnées. Tous les prérequis GCP nécessaires (API, réseau, IAM) sont provisionnés automatiquement s'ils ne sont pas déjà présents. En option, `Services GCP` peut être déployé en premier pour provisionner des ressources de plateforme partagées (telles qu'une instance Cloud SQL partagée, un serveur NFS ou un réseau VPC) que plusieurs déploiements dans le même projet peuvent ensuite réutiliser. **Tous les noms de ressources, les liaisons IAM, les secrets et les appels d'API sont limités à ce projet.** Modifier cela après le déploiement initial entraînera la recréation de toutes les ressources dans le nouveau projet. |
| `region` | `"us-central1"` | Chaîne de région GCP | La région GCP utilisée lorsqu'aucun mappage de sous-réseau `Services GCP` ne peut être auto-découvert pour le projet. Remplacez cette valeur lors du déploiement vers un projet dont la région principale n'est pas `us-central1` et où `Services GCP` n'a pas été déployé (ou ses données de région ne sont pas encore propagées). Exemple : `"europe-west1"`, `"asia-northeast1"`. N'a aucun effet lorsqu'un sous-réseau géré par `Services GCP` est auto-découvert avec succès, car la région est déduite du sous-réseau. |
| `tenant_id` | `"demo"` | `[a-z0-9-]{1,20}` | Une courte étiquette ajoutée aux noms de ressources (par exemple, service Cloud Run, secrets, instance SQL) pour distinguer ce déploiement des autres dans le même projet. Utilisez des valeurs telles que `prod`, `staging`, `dev`, ou un identifiant client/locataire. **Ne modifiez pas cela après le déploiement initial** — c'est intégré aux noms de ressources et le modifier entraînera la recréation de toutes les ressources avec de nouveaux noms, laissant les anciens orphelins. |
| `support_users` | `[]` | Liste d'adresses e-mail | Adresses e-mail qui reçoivent les notifications d'alerte Cloud Monitoring (échecs de disponibilité, latence élevée, pics de taux d'erreur). Ces adresses sont ajoutées à un canal de notification dans Cloud Monitoring. Laisser vide pour supprimer tous les e-mails d'alerte. L'ajout d'adresses ici n'accorde aucune permission IAM GCP. |
| `resource_labels` | `{}` | Carte de paires `key = "value"` | Étiquettes clé-valeur appliquées à chaque ressource GCP créée par ce module (service Cloud Run, instance Cloud SQL, buckets GCS, secrets, etc.). Utilisez les étiquettes pour appliquer les politiques de marquage organisationnelles — par exemple, centre de coûts, environnement, propriété d'équipe ou classification de conformité. Les étiquettes sont visibles dans les rapports de facturation et peuvent être utilisées pour filtrer les ressources dans la console. Les clés et valeurs d'étiquettes GCP doivent être en minuscules, de 1 à 63 caractères, et peuvent contenir des lettres, des chiffres, des tirets et des underscores. |

### Exploration dans GCP — Groupe 1 {#exploring-in-gcp--group-1}

**Console Google Cloud :**
- **Confirmation du projet :** Le nom et l'ID du projet sont affichés dans la barre de navigation supérieure. Accédez à **Accueil → Tableau de bord** pour confirmer que vous êtes dans le bon projet.
- **Étiquettes :** Accédez à n'importe quelle ressource (par exemple, **Cloud Run → Services → *votre service***) et sélectionnez l'onglet **Détails** pour vérifier que les étiquettes sont appliquées correctement.
- **Canaux de notification d'alerte :** Accédez à **Surveillance → Alertes → Canaux de notification** pour confirmer que les adresses e-mail des utilisateurs du support sont enregistrées.

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

Ces variables définissent l'identité de l'application déployée. Elles contrôlent la façon dont l'application est nommée dans les services GCP, comment elle apparaît dans la console et les tableaux de bord de surveillance, et comment les déploiements sont versionnés et suivis.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `application_name` | `"crapp"` | `[a-z][a-z0-9-]{0,19}` (1–20 caractères) | L'identifiant interne de l'application. Utilisé comme nom de base pour le service Cloud Run, le dépôt Artifact Registry, les secrets Secret Manager, la base de données Cloud SQL et les buckets GCS. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des tirets. **Ne modifiez pas cela après le déploiement initial** — c'est intégré aux noms de ressources et le modifier entraînera la recréation de toutes les ressources nommées, laissant les originales orphelines. Choisissez un identifiant court et significatif tel que `crm-app`, `payments-api` ou `customer-portal`. |
| `application_display_name` | `"App_CloudRun Application"` | Toute chaîne de caractères | Un nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme, la liste des services Cloud Run et les tableaux de bord de surveillance. Contrairement à `application_name`, cela peut être mis à jour librement à tout moment sans affecter les noms de ressources. Utilisez un titre descriptif qui aide les opérateurs à identifier le service en un coup d'œil, par exemple `Customer Portal`, `Payment Processing API`. |
| `application_description` | `"App CloudRun Custom Application…"` | Toute chaîne de caractères | Une brève description de l'objectif de l'application. Renseignée dans le champ de description du service Cloud Run et utilisée dans la documentation de la plateforme. Visible dans la console Cloud Run sous les détails du service. Mettez à jour cela pour décrire précisément votre application — c'est particulièrement utile à des fins d'audit et de gouvernance lorsque plusieurs services existent dans le même projet. |
| `application_version` | `"1.0.0"` | Toute chaîne de caractères (par exemple `v1.2.3`, `latest`, `sha-8f2b1a`) | L'étiquette de version appliquée à l'image du conteneur et utilisée pour le suivi du déploiement. Lorsque `container_image_source` est `custom`, l'incrémentation de cette valeur déclenche une nouvelle exécution Cloud Build et crée une nouvelle image étiquetée dans Artifact Registry. Lors de l'utilisation de `prebuilt`, cette valeur est uniquement informative. L'utilisation d'une convention de versioning telle que [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) est fortement recommandée pour maintenir une trace d'audit claire de ce qui est déployé. Évitez d'utiliser `latest` en production car cela rend impossible de déterminer exactement quel code est en cours d'exécution. |

### Exploration dans GCP — Groupe 2 {#exploring-in-gcp--group-2}

**Console Google Cloud :**
- **Nom du service Cloud Run :** Accédez à **Cloud Run → Services** et confirmez que le service est listé avec le nom attendu (dérivé de `application_name`).
- **Description du service et nom d'affichage :** Cliquez sur le service, puis sélectionnez l'onglet **Détails** pour afficher la description.
- **Dépôt Artifact Registry :** Accédez à **Artifact Registry → Dépôts** pour confirmer qu'un dépôt nommé d'après `application_name` a été créé.
- **Versions d'image :** Dans le dépôt Artifact Registry, sélectionnez le dépôt pour afficher toutes les versions d'image étiquetées et confirmez que l'étiquette `application_version` attendue est présente.

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

Ces variables contrôlent la manière dont le conteneur de l'application est sourcé, construit, déployé et mis à l'échelle sur Cloud Run. Ce sont les paramètres essentiels qui déterminent le comportement d'exécution de votre application.

> **Choisir l'exécution et la mise à l'échelle.** Trois décisions dominent le coût et le comportement. **Source de l'image :** `"custom"` construit à partir de votre dépôt via Cloud Build (nécessite la connexion GitHub) ; `"prebuilt"` déploie directement une URI d'image existante et *nécessite* `container_image` (appliqué au moment de la planification). **Plancher de mise à l'échelle :** `min_instance_count = 0` permet une mise à l'échelle à zéro — le moins cher, mais chaque requête froide subit une pénalité de démarrage et tout état en mémoire/disque local est perdu entre les requêtes ; définissez `1+` pour les applications sensibles à la latence ou avec état. `max_instance_count` est votre plafond de coût. **Environnement d'exécution :** conservez la valeur par défaut `gen2` — `gen1` ne peut pas monter NFS ou GCS Fuse (une combinaison `gen1` + `enable_nfs`/`gcs_volumes` est rejetée au moment de la planification). `cpu_always_allocated` est par défaut `false` (facturation basée sur les requêtes), de sorte que les économies de mise à l'échelle à zéro sont réalisées dès le départ ; définissez-le `true` uniquement lorsque le travail en arrière-plan doit s'exécuter entre les requêtes (planificateurs, workers de file d'attente, WebSockets).

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | Lorsque `true`, le service Cloud Run est déployé dans le cadre de cette configuration. Définissez sur `false` pour provisionner toute l'infrastructure de support (VPC, Cloud SQL, buckets GCS, secrets) sans déployer le conteneur de l'application. Ceci est utile pour les **workflows axés sur l'infrastructure** où la base de données et le stockage doivent être amorcés ou configurés avant le démarrage de l'application, ou pour les déploiements échelonnés où l'infrastructure est d'abord validée indépendamment. |
| `container_image_source` | `"custom"` | `prebuilt` / `custom` | Détermine comment l'image du conteneur est obtenue. **`prebuilt`** : déploie une image existante directement depuis n'importe quel registre de conteneurs accessible (par exemple, Docker Hub, Artifact Registry, GitHub Container Registry) en utilisant l'URI dans `container_image`. Aucune étape de build n'est effectuée. Utilisez ceci pour les images fournies par des fournisseurs ou les images construites en externe. **`custom`** : utilise Cloud Build pour construire l'image à partir du code source dans le dépôt GitHub connecté en utilisant la configuration dans `container_build_config`. L'image construite est poussée vers Artifact Registry puis déployée. |
| `container_image` | `""` | URI complète de l'image du conteneur | L'URI entièrement qualifiée de l'image du conteneur à déployer. Requise lorsque `container_image_source` est `prebuilt`, ou lorsque `enable_image_mirroring` est `true` (en tant qu'image source à mettre en miroir). Exemples : `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:1.25`, `ghcr.io/my-org/my-app:latest`. Lors de l'utilisation d'une image de registre public telle que Docker Hub, l'activation de `enable_image_mirroring` est fortement recommandée pour éviter les limitations de débit et garantir la reproductibilité. |
| `container_build_config` | `{ enabled = true }` | Objet | Configuration passée à Cloud Build lorsque `container_image_source` est `custom`. Champs clés : **`enabled`** (`true`/`false`) — définissez sur `false` pour ignorer complètement l'étape de build et déployer la dernière image construite. **`dockerfile_path`** — chemin relatif vers le Dockerfile dans le dépôt (par défaut : `Dockerfile`). **`dockerfile_content`** — contenu Dockerfile intégré sous forme de chaîne ; lorsqu'il est défini, ce contenu est écrit dans un fichier au moment du build plutôt que de lire un Dockerfile depuis le dépôt. **`context_path`** — répertoire de contexte de build (par défaut : `.`). **`build_args`** — carte de valeurs `ARG` passées au build Docker (par exemple, `{ ENV = "prod" }`). **`artifact_repo_name`** — nom du dépôt Artifact Registry vers lequel pousser l'image construite ; laisser vide pour utiliser le dépôt auto-créé nommé d'après `application_name`. |
| `enable_image_mirroring` | `true` | `true` / `false` | Lorsque `true`, l'image spécifiée dans `container_image` est copiée dans le dépôt Artifact Registry du projet avant le déploiement. **Fortement recommandé lors de l'utilisation d'images publiques externes** (Docker Hub, GitHub Container Registry, etc.) pour trois raisons : (1) évite les limites de débit de tirage du registre à grande échelle ; (2) garantit que l'image reste disponible même si le registre en amont est indisponible ; (3) vous donne une copie vérifiable et limitée au projet à des fins d'audit et de conformité. N'a aucun effet lorsque `container_image_source` est `custom`, car l'image est déjà construite dans Artifact Registry. |
| `min_instance_count` | `0` | Entier `0`–`1000` | Le nombre minimum d'instances de conteneurs maintenues en cours d'exécution en permanence. **`0` (mise à l'échelle à zéro) :** les instances sont arrêtées lorsqu'il n'y a pas de trafic, éliminant les coûts de calcul inactifs. Le compromis est un délai de **démarrage à froid** (généralement 1 à 10 secondes) sur la première requête après une période d'inactivité. **`1` ou plus :** au moins une instance est toujours chaude, éliminant les démarrages à froid. Recommandé pour les applications sensibles à la latence, les API avec des exigences de SLA, ou les services qui maintiennent des connexions à Cloud SQL ou Redis. Pour `cpu_always_allocated = false`, la définition de `min_instance_count` > 0 entraîne des coûts d'instance continus même en cas d'inactivité. |
| `max_instance_count` | `1` | Entier `1`–`1000` | Le nombre maximal d'instances de conteneurs que Cloud Run est autorisé à mettre à l'échelle sous charge. Agit comme un plafond de coûts et une protection contre une mise à l'échelle incontrôlée causée par des pics de trafic ou des événements de déni de service. Chaque instance gère les requêtes simultanément (la valeur par défaut de Cloud Run est de 80 requêtes concurrentes par instance). **Définissez cette valeur en fonction de votre trafic de pointe attendu et de vos limites de ressources en aval** — par exemple, une instance Cloud SQL a une limite de connexion maximale, donc `max_instance_count` × connexions par instance ne doit pas la dépasser. |
| `cpu_always_allocated` | `false` | `true` / `false` | **`true` :** le CPU est alloué au conteneur en permanence, même lorsqu'il ne traite pas de requête. Cela permet le traitement en arrière-plan, les tâches planifiées dans le conteneur et les connexions WebSocket. Les coûts sont encourus en continu par instance. **`false` (par défaut) :** le CPU n'est alloué que pendant le traitement des requêtes ; il est limité à près de zéro entre les requêtes. Réduit les coûts pour les charges de travail à faible trafic mais empêche tout calcul en arrière-plan. Définissez `true` pour les applications qui exécutent des threads en arrière-plan ou maintiennent des connexions persistantes (par exemple, les consommateurs de files d'attente de messages). |
| `container_port` | `8080` | Entier `1`–`65535` | Le port TCP sur lequel votre serveur d'applications écoute à l'intérieur du conteneur. Cloud Run achemine tout le trafic HTTP(S) entrant vers ce port. **Cela doit correspondre au port auquel votre application se lie réellement** — une non-concordance entraînera l'échec de toutes les requêtes avec une erreur de connexion. Valeurs courantes : `8080` (valeurs par défaut Java, Go, Node.js), `3000` (Node.js/Express), `5000` (Flask/Python), `80` (nginx). |
| `container_protocol` | `"http1"` | `http1` / `h2c` | La version du protocole HTTP que Cloud Run utilise pour communiquer avec votre conteneur. **`http1` :** HTTP/1.1 standard. Compatible avec tous les frameworks web. Utilisez ceci pour les API REST, les applications web et tout service qui ne nécessite pas spécifiquement HTTP/2. **`h2c` :** HTTP/2 en clair (non chiffré). Utilisez pour les **services gRPC** (qui nécessitent HTTP/2) ou les services qui bénéficient du multiplexage et de la compression d'en-têtes, tels que ceux qui envoient de grandes charges utiles ou utilisent le streaming serveur. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Objet | Limites de ressources CPU et mémoire pour le conteneur. **`cpu_limit`** : spécifié en millicores — `1000m` = 1 vCPU, `2000m` = 2 vCPU. Cloud Run prend en charge `1000m`, `2000m`, `4000m`, `6000m` et `8000m`. **`memory_limit`** : spécifié en `Mi` (mébioctets) ou `Gi` (gibioctets), par exemple `512Mi`, `1Gi`, `2Gi`, `4Gi`. Cloud Run prend en charge jusqu'à `32Gi`. **Conseils de dimensionnement :** commencez par `1000m` / `512Mi` et augmentez en fonction de l'utilisation observée du CPU et de la mémoire dans Cloud Monitoring. Notez que le CPU fractionnaire (inférieur à `1000m`) n'est valide qu'avec `cpu_always_allocated = false` (facturation basée sur les requêtes) ; le CPU toujours alloué nécessite une valeur entière d'au moins 1 vCPU. `cpu_request` et `mem_request` sont facultatifs et prennent par défaut les valeurs limites s'ils ne sont pas spécifiés. |
| `execution_environment` | `"gen2"` | `gen1` / `gen2` | La génération de l'environnement d'exécution Cloud Run. **`gen2` (recommandé) :** s'exécute sur un environnement Linux complet, prend en charge les montages de volumes NFS, les montages GCS Fuse, des tampons réseau plus grands et des temps de démarrage plus rapides. Requis lorsque `enable_nfs` ou `gcs_volumes` sont utilisés. **`gen1` :** l'environnement hérité. À utiliser uniquement si votre image de conteneur repose sur un comportement spécifique à la génération 1 (par exemple, certains appels système non pris en charge dans la génération 2). La génération 1 ne prend pas en charge les montages NFS. |
| `timeout_seconds` | `300` | Entier `0`–`3600` | La durée maximale en secondes pendant laquelle Cloud Run attendra qu'une seule requête HTTP se termine avant de renvoyer un `504 Gateway Timeout`. **Augmentez** cette valeur pour les opérations de longue durée telles que le traitement de fichiers, les migrations de bases de données, la génération de rapports ou les importations de grandes quantités de données. **Maintenez-la basse** pour les API interactives afin de signaler rapidement les réponses lentes et de libérer rapidement les ressources. La valeur maximale autorisée est `3600` (1 heure). |
| `enable_cloudsql_volume` | `true` | `true` / `false` | Lorsque `true`, un sidecar Cloud SQL Auth Proxy est injecté dans le service Cloud Run. Le proxy crée un socket Unix sécurisé au chemin défini par `cloudsql_volume_mount_path`, que l'application utilise au lieu d'une connexion TCP directe. C'est le moyen **recommandé et le plus sécurisé** de se connecter à Cloud SQL — il utilise l'authentification IAM et chiffre la connexion sans exposer la base de données à l'internet public. Définissez sur `false` uniquement si votre application se connecte à Cloud SQL via une adresse IP privée sur TCP directement. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Chemin du système de fichiers | Le chemin à l'intérieur du conteneur où le socket Unix du Cloud SQL Auth Proxy est monté. La chaîne de connexion de la base de données de votre application doit référencer ce chemin. Par exemple, une chaîne de connexion PostgreSQL serait `host=/cloudsql/PROJECT:REGION:INSTANCE`. Pertinent uniquement lorsque `enable_cloudsql_volume` est `true`. Ne modifiez cela que si votre framework d'application s'attend à ce que le socket se trouve à un chemin spécifique non par défaut. |
| `traffic_split` | `[]` *(tout le trafic vers la dernière version)* | Liste d'objets | Définit comment le trafic entrant est distribué entre les révisions Cloud Run. Laissez vide pour envoyer 100 % du trafic à la dernière révision (comportement par défaut). Configurez ceci pour les **déploiements canary** (par exemple, 90 % vers la version stable, 10 % vers la nouvelle révision) ou les **déploiements bleu-vert** (basculez 100 % vers une révision spécifique à la demande). Chaque entrée nécessite : **`type`** — `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST` (dernière révision) ou `TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION` (une révision nommée). **`percent`** — pourcentage de trafic (0–100 ; toutes les entrées doivent totaliser exactement 100). **`revision`** — requis lorsque le type est `REVISION` ; le nom de la révision Cloud Run. **`tag`** — étiquette d'URL stable facultative (par exemple, `canary`, `stable`) qui crée une URL dédiée pour cette révision à des fins de test avant de déplacer le trafic. |
| `max_revisions_to_retain` | `7` | Entier `0`–`100` | Le nombre maximal de révisions Cloud Run à conserver après chaque déploiement. Après chaque déploiement, les anciennes révisions sont automatiquement élaguées au-delà de cette limite (triées de la plus ancienne à la plus récente). Les révisions servant activement du trafic ne sont jamais supprimées. Définissez sur `0` pour désactiver complètement l'élagage automatique et conserver toutes les révisions indéfiniment. La réduction de cette valeur limite la consommation de quota d'API et maintient la liste des révisions gérable. S'applique uniquement aux déploiements non gérés par Cloud Deploy ; les services gérés par Cloud Deploy sont traités séparément par étape. Doit être compris entre `0` et `100`. |

### Exploration dans GCP — Groupe 3 {#exploring-in-gcp--group-3}

**Console Google Cloud :**
- **Déploiement et mise à l'échelle du service :** Accédez à **Cloud Run → Services → *votre service*** pour confirmer que le service est déployé. L'onglet **Révisions** affiche toutes les révisions déployées, leur répartition du trafic et leur configuration de mise à l'échelle.
- **Image du conteneur :** L'onglet **Révisions** affiche l'URI de l'image du conteneur utilisée par chaque révision.
- **Limites de ressources et mise à l'échelle :** Cliquez sur une révision et sélectionnez **Conteneur(s)** pour afficher les paramètres de CPU, de mémoire, d'instances min/max et de concurrence.
- **Environnement d'exécution :** Visible dans l'onglet **Conteneur(s)** des détails de la révision sous **Environnement d'exécution**.
- **Images Artifact Registry :** Accédez à **Artifact Registry → Dépôts → *nom_application*** pour afficher toutes les étiquettes d'image disponibles.

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

Ces variables contrôlent la manière dont la configuration et les identifiants sensibles sont fournis au conteneur en cours d'exécution. Un principe clé ici est la séparation de la **configuration en texte clair** (paramètres non sensibles injectés directement comme variables d'environnement) des **identifiants sensibles** (injectés de manière sécurisée via des références Secret Manager, jamais stockés en texte clair).

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `environment_variables` | `{}` | Map de `"VAR_NAME" = "value"` | Variables d'environnement en texte clair injectées dans chaque instance de conteneur au démarrage. À utiliser pour la configuration non sensible comme les indicateurs de fonctionnalité, les niveaux de journalisation, les URL de base d'API ou les paramètres de mode d'application. Exemples : `{ LOG_LEVEL = "info", FEATURE_NEW_UI = "true", API_BASE_URL = "https://api.example.com" }`. **Ne stockez pas de mots de passe, de jetons, de clés API ou de valeurs sensibles ici** — ils seront visibles dans la configuration de la révision Cloud Run et dans la configuration de la plateforme. Utilisez `secret_environment_variables` pour les valeurs sensibles à la place. Les modifications de cette map déclenchent une nouvelle révision Cloud Run. |
| `secret_environment_variables` | `{}` | Map de `"VAR_NAME" = "secret-name"` | Valeurs sensibles injectées comme variables d'environnement en utilisant des références Secret Manager. La clé de la map est le nom de la variable d'environnement exposée au conteneur ; la valeur de la map est le nom d'un secret Secret Manager existant dans le même projet. Cloud Run récupère la **dernière version active** du secret au démarrage de l'instance — la valeur en texte clair n'est jamais stockée dans la configuration ou l'état. Exemples : `{ DB_PASSWORD = "app-db-password", STRIPE_KEY = "stripe-api-key" }`. Le compte de service Cloud Run doit avoir le rôle IAM `roles/secretmanager.secretAccessor` sur chaque secret référencé (accordé automatiquement par ce module, par secret : aucun compte d'exécution ou de build ne détient un rôle Secret Manager au niveau du projet, donc un secret n'est lisible qu'une fois que ce module l'a accordé — y compris les secrets référencés uniquement par un job d'initialisation ou cron, un sibling `additional_services`, un sidecar `additional_containers`, ou une étape Cloud Deploy). Si un secret référencé n'existe pas, la révision Cloud Run échouera à se déployer. |
| `service_annotations` | `{}` | Map de `"annotation-key" = "value"` | Annotations de style Kubernetes appliquées directement à la ressource de service Cloud Run. Utilisées pour les paramètres Cloud Run avancés non exposés comme options de configuration de premier ordre. Rarement nécessaires pour les déploiements standards. Exemple d'utilisation : spécifier manuellement une chaîne de connexion d'instance Cloud SQL via `run.googleapis.com/cloudsql-instances`. Des annotations incorrectes peuvent empêcher le déploiement du service, donc n'utilisez que lorsque spécifiquement requis. |
| `service_labels` | `{}` | Map de `"key" = "value"` | Labels appliqués spécifiquement à la ressource de service Cloud Run, en plus de `resource_labels` qui s'appliquent à toutes les ressources. À utiliser pour l'attribution des coûts au niveau du service, le regroupement opérationnel ou les politiques de taggage qui s'appliquent uniquement au service Cloud Run. Exemple : `{ tier = "frontend", billing-code = "team-a" }`. Ces labels apparaissent dans les détails du service Cloud Run et peuvent être utilisés pour filtrer les services dans la console. |
| `secret_rotation_period` | `"2592000s"` *(30 jours)* | Chaîne de durée en secondes, par exemple `"2592000s"` | Fréquence à laquelle Secret Manager publie un événement de **notification de rotation** via Pub/Sub pour inviter l'application ou un gestionnaire de rotation à mettre à jour la valeur du secret. Valeurs courantes : `"604800s"` (7 jours), `"2592000s"` (30 jours), `"7776000s"` (90 jours). **Important :** ce paramètre ne fait pas pivoter le secret automatiquement — il déclenche seulement une notification. La logique de rotation réelle (générer une nouvelle valeur et mettre à jour le secret) doit être implémentée séparément, soit via `enable_auto_password_rotation` (pour le mot de passe de la base de données) soit via une Cloud Function/un Cloud Run Job personnalisé. S'applique à tous les secrets gérés par ce module. |
| `secret_propagation_delay` | `30` | Entier (secondes) | Le nombre de secondes à attendre après la création ou la mise à jour d'un secret avant de procéder aux opérations dépendantes (par exemple, le déploiement d'une nouvelle révision Cloud Run). Secret Manager utilise la réplication globale, et un bref délai garantit que la nouvelle version du secret s'est entièrement propagée à toutes les régions avant que les instances ne tentent de la lire. **Augmentez cette valeur** (par exemple à `60` ou `90`) si vous rencontrez des échecs de déploiement avec des erreurs indiquant qu'une version de secret ne peut pas être trouvée, en particulier dans les déploiements multirégionaux. |

### Exploration dans GCP — Groupe 4 {#exploring-in-gcp--group-4}

**Console Google Cloud :**
- **Variables d'environnement :** Naviguez vers **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Container(s)**. Les variables d'environnement en texte clair sont listées sous **Environment variables**. Les références de secrets sont listées séparément sous **Secrets**.
- **Secrets Secret Manager :** Naviguez vers **Security → Secret Manager** pour voir tous les secrets, leurs versions, les calendriers de rotation et les politiques d'accès.
- **Accès IAM aux secrets :** Dans Secret Manager, cliquez sur un secret et sélectionnez l'onglet **Permissions** pour confirmer que le compte de service Cloud Run a les permissions `Secret Accessor`.
- **Calendrier de rotation :** Dans Secret Manager, cliquez sur un secret et consultez l'onglet **Overview** — la période de rotation est affichée sous **Rotation**.

**gcloud CLI :**
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

Ces variables configurent la manière dont Cloud Run surveille la santé des instances de conteneurs individuelles et comment Cloud Monitoring observe l'application de l'extérieur. Des vérifications de santé correctement configurées empêchent les instances malsaines de servir du trafic ; les tests de disponibilité et les politiques d'alerte signalent les défaillances à votre équipe avant que les utilisateurs ne les remarquent.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Objet | Configure la **sonde de démarrage**, que Cloud Run utilise pour déterminer quand une instance de conteneur nouvellement démarrée est prête à recevoir du trafic. Cloud Run ne routera aucune requête vers l'instance tant que cette sonde n'aura pas réussi. Sous-champs : **`enabled`** (`true`/`false`) — désactiver uniquement pour les conteneurs qui démarrent instantanément et n'ont pas de phase d'initialisation. **`type`** — `HTTP` (par défaut ; envoie un HTTP GET à `path`) ou `TCP` (vérifie que le port accepte les connexions, à utiliser lorsqu'il n'y a pas de point de terminaison HTTP). **`path`** — le chemin HTTP à vérifier, par exemple `/healthz`, `/ready`, `/status`. **`initial_delay_seconds`** — secondes à attendre après le démarrage du conteneur avant la première tentative de sonde (par défaut : `10`). **`timeout_seconds`** — secondes à attendre la réponse de la sonde avant de la marquer comme échouée (par défaut : `5`). **`period_seconds`** — intervalle entre les tentatives de sonde (par défaut : `10`). **`failure_threshold`** — nombre d'échecs consécutifs avant que l'instance ne soit considérée comme défaillante et redémarrée (par défaut : `10`). Pour les applications à démarrage lent (par exemple, celles qui exécutent des migrations de base de données au démarrage), augmentez `failure_threshold` ou `period_seconds` plutôt que `initial_delay_seconds` pour donner au conteneur suffisamment de temps sans bloquer le trafic trop longtemps. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Objet | Configure la **sonde de vivacité**, que Cloud Run utilise pour vérifier périodiquement si une instance de conteneur en cours d'exécution est toujours saine. Si la sonde échoue `failure_threshold` fois consécutives, Cloud Run redémarre automatiquement le conteneur. Les sous-champs reflètent ceux de `startup_probe_config` : **`enabled`**, **`type`** (`HTTP` / `TCP`), **`path`**, **`initial_delay_seconds`** (par défaut : `15`), **`timeout_seconds`** (par défaut : `5`), **`period_seconds`** (par défaut : `30`), **`failure_threshold`** (par défaut : `3`). **Important :** le point de terminaison de vérification de santé doit répondre rapidement et ne doit pas effectuer d'opérations coûteuses (requêtes de base de données, appels d'API externes) — un point de terminaison de santé lent peut provoquer des redémarrages faux-positifs. Il doit renvoyer `HTTP 200` lorsque l'application est saine et un code non-2xx lorsqu'elle ne l'est pas. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Objet | Configure un **test de disponibilité Google Cloud Monitoring** qui envoie des requêtes HTTP périodiques à l'application depuis plusieurs emplacements mondiaux (généralement 6 points de présence Google dans le monde). Si l'application devient inaccessible depuis la majorité des emplacements, une alerte est déclenchée et envoyée à `support_users`. Désactivé par défaut — définissez `enabled = true` pour provisionner le test ; il n'est créé que lorsque le point de terminaison est publiquement accessible. Sous-champs : **`enabled`** (`true`/`false`). **`path`** — le chemin HTTP à sonder depuis l'extérieur, par exemple `/healthz` ou `/`. **`check_interval`** — la fréquence de sondage, en secondes avec un suffixe `s` (par défaut : `"60s"` ; minimum `"60s"`). **`timeout`** — temps de réponse maximal avant que le test ne soit marqué comme échoué (par défaut : `"10s"` ; doit être inférieur à `check_interval`). Contrairement aux sondes de démarrage et de vivacité — qui sont des vérifications internes au niveau du conteneur — le test de disponibilité valide l'accessibilité de bout en bout depuis l'internet public. Cela signifie qu'il valide également le DNS, les équilibreurs de charge et les règles Cloud Armor le cas échéant. |
| `alert_policies` | `[]` | Liste d'objets | Une liste de politiques d'alerte Cloud Monitoring qui déclenchent des notifications par e-mail à `support_users` lorsque les métriques de l'application dépassent les seuils définis. Laissez vide pour ne déployer aucune politique d'alerte personnalisée. Chaque objet de politique requiert : **`name`** — un libellé descriptif pour la politique (par exemple `"high-latency"`, `"5xx-errors"`). **`metric_type`** — la métrique Cloud Monitoring à surveiller (voir les valeurs courantes ci-dessous). **`comparison`** — `COMPARISON_GT` (supérieur à) ou `COMPARISON_LT` (inférieur à). **`threshold_value`** — le seuil numérique qui déclenche l'alerte. **`duration_seconds`** — combien de temps la condition doit être maintenue avant que l'alerte ne se déclenche (utilisez `0` pour alerter immédiatement). **`aggregation_period`** — la fenêtre de temps pour l'agrégation des métriques (par défaut : `"60s"`). Valeurs `metric_type` courantes pour Cloud Run : `run.googleapis.com/request_latencies` (latence des requêtes en ms), `run.googleapis.com/request_count` (requêtes par seconde, filtrez par `response_code_class` pour les 5xx), `run.googleapis.com/container/cpu/utilizations` (utilisation du CPU, 0–1), `run.googleapis.com/container/memory/utilizations` (utilisation de la mémoire, 0–1). |

### Exploration dans GCP — Groupe 5 {#exploring-in-gcp--group-5}

**Console Google Cloud :**
- **Sondes de démarrage et de vivacité :** Naviguez vers **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Container(s)**. La configuration des sondes est affichée sous **Health checks**.
- **Tests de disponibilité :** Naviguez vers **Monitoring → Uptime checks** pour voir les tests actifs, leur état actuel (réussite/échec) et les derniers résultats de chaque emplacement mondial.
- **Politiques d'alerte :** Naviguez vers **Monitoring → Alerting** pour voir toutes les politiques d'alerte configurées, leur état actuel (déclenchée/OK) et les canaux de notification.
- **Incidents :** Naviguez vers **Monitoring → Alerting → Incidents** pour voir l'historique des déclenchements d'alertes.

**gcloud CLI :**
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

Ces variables définissent les charges de travail qui s'exécutent en parallèle du service Cloud Run principal mais en dehors du cycle requête-réponse. Les jobs d'initialisation s'exécutent une fois au moment du déploiement pour amorcer l'application ; les jobs cron gèrent le travail de fond récurrent selon un calendrier ; les services supplémentaires déploient des services Cloud Run supplémentaires dont dépend l'application principale.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", … }]` | Liste d'objets | Cloud Run Jobs exécutés **une fois pendant ou après le déploiement** pour initialiser l'application. La valeur par défaut inclut un job `db-init` qui exécute des scripts d'initialisation de base de données. Chaque job s'exécute séquentiellement dans l'ordre de la liste, sauf si des dépendances sont spécifiées. Sous-champs clés : **`name`** — identifiant unique pour le job (utilisé comme nom du Cloud Run Job). **`description`** — libellé lisible par l'homme affiché dans la console. **`image`** — image de conteneur à utiliser pour le job ; utilise l'image de l'application si laissée vide. **`command`** / **`args`** — la commande et les arguments du point d'entrée à exécuter. **`script_path`** — chemin vers un fichier script relatif au répertoire des scripts du module ; utilisé à la place de `command`/`args` lors de l'exécution de scripts groupés. **`env_vars`** / **`secret_env_vars`** — variables d'environnement spécifiques au job et références Secret Manager (même format que le Groupe 4). **`cpu_limit`** / **`memory_limit`** — limites de ressources pour le conteneur du job (par défaut : `1000m` / `512Mi`). **`timeout_seconds`** — durée maximale pour le job (par défaut : `600`). **`max_retries`** — nombre de tentatives de réessai en cas d'échec (par défaut : `1`). **`task_count`** — nombre de tâches parallèles (par défaut : `1` ; augmenter pour les charges de travail parallèles). **`mount_nfs`** — si le volume NFS doit être monté (nécessite `enable_nfs = true`). **`mount_gcs_volumes`** — liste des noms de volumes GCS à monter. **`depends_on_jobs`** — liste des noms d'autres jobs qui doivent se terminer avec succès avant que ce job ne s'exécute. **`execute_on_apply`** — lorsque `true`, le job est réexécuté à chaque déploiement ; lorsque `false`, il ne s'exécute qu'une seule fois lors du premier déploiement. |
| `cron_jobs` | `[]` | Liste d'objets | Tâches planifiées récurrentes déployées en tant que Cloud Run Jobs et déclenchées par **Cloud Scheduler** selon un calendrier cron. Chaque job crée une ressource Cloud Run Job et un job Cloud Scheduler qui l'invoque. Sous-champs clés : **`name`** — identifiant unique pour le job. **`schedule`** — expression cron en UTC, par exemple `"0 2 * * *"` (quotidiennement à 02:00 UTC), `"*/15 * * * *"` (toutes les 15 minutes), `"0 9 * * 1"` (tous les lundis à 09:00 UTC). **`image`** — image de conteneur ; utilise l'image de l'application si vide. **`command`** / **`args`** / **`script_path`** — comme pour `initialization_jobs`. **`env_vars`** / **`secret_env_vars`** — configuration et secrets spécifiques au job. **`cpu_limit`** / **`memory_limit`** — limites de ressources (par défaut : `1000m` / `512Mi`). **`timeout_seconds`** — durée maximale (par défaut : `600`). **`max_retries`** — tentatives de réessai en cas d'échec (par défaut : `3`). **`task_count`** / **`parallelism`** — nombre de tâches et combien s'exécutent en parallèle (par défaut : `1` / `0` signifiant utiliser la valeur par défaut de Cloud Run). **`mount_nfs`** / **`mount_gcs_volumes`** — montages de volumes de stockage. **`paused`** — défini sur `true` pour désactiver le déclencheur du planificateur sans supprimer la définition du job. Utile pour suspendre temporairement un job pendant la maintenance. |
| `additional_services` | `[]` | Liste d'objets | Services Cloud Run supplémentaires déployés en parallèle de l'application principale. Utilisez ceci pour les **modèles de type sidecar** où un service séparé gère une fonction spécifique — par exemple un processus de travail dédié, un proxy de cache compatible Redis, un consommateur de file d'attente en arrière-plan, ou une interface d'administration interne. Chaque service supplémentaire est un service Cloud Run entièrement indépendant. Sous-champs clés : **`name`** — identifiant unique ajouté au nom de l'application (par exemple `worker` produit `APPLICATION_NAME-worker`). **`image`** — URI de l'image du conteneur (obligatoire). **`port`** — port sur lequel le service supplémentaire écoute. **`command`** / **`args`** — remplacement du point d'entrée. **`env_vars`** — variables d'environnement en texte clair pour ce service. **`cpu_limit`** / **`memory_limit`** — limites de ressources (par défaut : `1000m` / `512Mi`). **`min_instance_count`** / **`max_instance_count`** — limites de mise à l'échelle (par défaut : `0` / `1`). **`ingress`** — restriction de la source de trafic pour ce service ; la valeur par défaut est `INGRESS_TRAFFIC_INTERNAL_ONLY`, ce qui signifie que seuls le service principal et d'autres services GCP internes peuvent l'appeler — il n'est pas publiquement accessible. **`output_env_var_name`** — si défini, l'URL de ce service supplémentaire est automatiquement injectée dans le conteneur de l'application **principale** en tant que variable d'environnement avec ce nom, permettant à l'application principale de le découvrir et de l'appeler sans coder en dur les URL. **`volume_mounts`** — volumes NFS ou GCS à monter. **`startup_probe`** / **`liveness_probe`** — configuration de la vérification de santé par service (même structure que les sondes du Groupe 5). |
| `additional_containers` | `[]` | Liste d'objets | Conteneurs **sidecar in-pod** ajoutés au **même** service Cloud Run que l'application principale (révision multi-conteneurs), partageant `localhost` et le cycle de vie du pod — distincts de `additional_services`, qui se déploient en tant que services séparés. Utilisez ceci lorsque l'application ou une dépendance doit être atteinte via un protocole non-HTTP/loopback que la mise en réseau de service à service de Cloud Run ne peut pas transporter, par exemple un MongoDB auquel l'application se connecte à `127.0.0.1:27017`. Le conteneur principal (d'entrée) ne démarre qu'après que chaque sidecar dont `startup_tcp_port` est défini ait lui-même démarré. Sous-champs clés : **`name`** — nom du conteneur sidecar. **`image`** — URI de l'image du conteneur. **`command`** / **`args`** — remplacement du point d'entrée. **`env_vars`** — variables d'environnement en texte clair pour le sidecar. **`cpu_limit`** / **`memory_limit`** — limites de ressources. **`mount_nfs`** — monte le volume Filestore partagé (nécessite `enable_nfs = true`) à `nfs_mount_path`, par exemple pour un répertoire de données de base de données. **`startup_tcp_port`** — port TCP que Cloud Run interroge pour déterminer que le sidecar est prêt avant de démarrer le conteneur principal. Exemple : `[{ name = "mongo", image = "mongo:7", args = ["--dbpath", "/data/db"], mount_nfs = true, nfs_mount_path = "/data/db", startup_tcp_port = 27017 }]`. |

### Exploration dans GCP — Groupe 6 {#exploring-in-gcp--group-6}

**Console Google Cloud :**
- **Jobs d'initialisation et cron :** Naviguez vers **Cloud Run → Jobs** pour voir tous les Cloud Run Jobs, leur dernier statut d'exécution et l'historique d'exécution.
- **Historique d'exécution des jobs :** Cliquez sur un job, puis sélectionnez l'onglet **Executions** pour voir chaque exécution, son statut (réussie/échouée), sa durée et ses logs.
- **Déclencheurs Cloud Scheduler :** Naviguez vers **Cloud Scheduler** pour voir les déclencheurs de jobs cron, leur calendrier, leur dernière heure d'exécution et leur statut.
- **Services supplémentaires :** Naviguez vers **Cloud Run → Services** — les services supplémentaires apparaissent comme des services séparés nommés `APPLICATION_NAME-ADDITIONAL_NAME`.

**gcloud CLI :**
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

Ces variables configurent les pipelines de build et de déploiement automatisés. Le module prend en charge deux modèles de pipeline : un modèle **Cloud Build** simple où chaque push de code qualifiant construit et déploie directement sur Cloud Run, et un modèle **Cloud Deploy** plus avancé qui introduit un pipeline basé sur la promotion avec des étapes définies et des approbations manuelles facultatives entre elles.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | `true` / `false` | Interrupteur principal pour le pipeline CI/CD. Lorsque `true`, un déclencheur Cloud Build est créé qui surveille le dépôt GitHub connecté et construit et déploie automatiquement l'application lorsque du code est poussé vers la branche configurée. Nécessite que `github_repository_url` et au moins l'un de `github_token` ou `github_app_installation_id` soient définis. Lorsque `false`, les déploiements doivent être déclenchés manuellement (par exemple, en exécutant un build depuis la console Cloud Build ou en mettant à jour `application_version`). |
| `github_repository_url` | `""` | URL HTTPS complète | L'URL HTTPS du dépôt GitHub à connecter à Cloud Build. Obligatoire lorsque `enable_cicd_trigger` est `true`. Format : `https://github.com/ORG/REPO`. Le dépôt doit être accessible en utilisant les identifiants fournis dans `github_token` ou via l'application GitHub spécifiée dans `github_app_installation_id`. |
| `github_token` | `""` | Chaîne PAT GitHub *(sensible)* | Un **jeton d'accès personnel (PAT)** GitHub utilisé pour autoriser la connexion GitHub de Cloud Build. Obligatoire lors du **premier déploiement** lorsque `enable_cicd_trigger` est `true` — GCP utilise ce jeton pour établir la connexion. Portées requises : `repo` (accès complet au dépôt) et `admin:repo_hook` (pour créer des webhooks). **Une fois la connexion initiale établie**, le jeton est stocké dans Secret Manager et réutilisé automatiquement — vous n'avez pas besoin de le fournir à nouveau lors des déploiements ultérieurs. Pour les dépôts d'organisation, préférez `github_app_installation_id` (authentification par application GitHub) à un PAT pour une meilleure auditabilité et rotation des clés. Cette valeur est traitée comme sensible et n'est jamais stockée en texte clair. |
| `github_app_installation_id` | `""` | Chaîne numérique (par exemple `"12345678"`) | L'ID d'installation de l'**application GitHub Cloud Build**, utilisée lors de l'authentification via une application GitHub au lieu d'un PAT. Lorsqu'il est fourni avec `github_token`, la connexion utilise l'authentification par application GitHub (préférée pour les dépôts au niveau de l'organisation) avec le PAT utilisé uniquement comme identifiant d'autorisation lors de la configuration initiale de la connexion. L'ID d'installation se trouve dans les paramètres de votre organisation GitHub sous **Installed GitHub Apps → Cloud Build → Configure**. L'authentification par application GitHub est préférée aux PAT pour les équipes car elle lie la connexion à l'application plutôt qu'à un compte utilisateur individuel. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Objet | Configuration fine pour le déclencheur Cloud Build. Sous-champs : **`branch_pattern`** — une expression régulière correspondant à la ou aux branches qui activent le build (par défaut : `"^main$"` déclenche uniquement sur les pushes vers `main` ; utilisez `"^(main\|develop)$"` pour les deux). **`included_files`** — liste de motifs de chemins de fichiers ; le build ne se déclenche que si au moins un fichier correspondant a été modifié (par exemple `["src/**", "Dockerfile"]`). Laissez vide pour déclencher sur toute modification de fichier. **`ignored_files`** — liste de motifs de chemins de fichiers à exclure du déclenchement (par exemple `["**.md", "docs/**"]`). **`trigger_name`** — nom personnalisé pour le déclencheur Cloud Build (auto-généré si vide). **`description`** — description affichée dans la console Cloud Build. **`substitutions`** — map de paires `_VARIABLE = "value"` passées comme variables de substitution aux étapes de build Cloud Build (par exemple `{ _ENV = "prod", _REGION = "us-central1" }`). |
| `enable_cloud_deploy` | `false` | `true` / `false` | Bascule le pipeline CI/CD des **déploiements directs Cloud Build** vers un pipeline de livraison progressive géré **Google Cloud Deploy**. Lorsque `true`, un pipeline de livraison Cloud Deploy et des cibles sont créés sur la base de `cloud_deploy_stages`. Les versions sont promues à travers les étapes dans l'ordre (par exemple dev → staging → prod), avec des approbations manuelles facultatives avant la promotion. Nécessite que `enable_cicd_trigger` soit également `true` pour l'exécution automatisée du pipeline. Utilisez ceci pour les environnements de production où vous avez besoin de déploiements contrôlés, audités et multi-étapes plutôt que de déploiements directs en production. |
| `cicd_enable_cloud_deploy` | `false` | `true` / `false` | Contrôle si le déclencheur Cloud Build crée des **versions Cloud Deploy** (`true`) ou met à jour directement le service Cloud Run (`false`). Définissez sur `true` pour que le pipeline CI/CD alimente Cloud Deploy plutôt que de déployer directement. `enable_cloud_deploy` et `cicd_enable_cloud_deploy` doivent tous deux être `true` pour que le pipeline automatisé complet (build → version Cloud Deploy → promotion à travers les étapes) fonctionne de bout en bout. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | Liste d'objets | Liste ordonnée des étapes de promotion pour le pipeline de livraison Cloud Deploy. Chaque étape crée une cible Cloud Deploy et un service Cloud Run associé pour cet environnement. Les étapes sont promues dans l'ordre de la liste. Sous-champs clés : **`name`** — identifiant de l'étape (par exemple `"dev"`, `"staging"`, `"prod"`) ; utilisé pour nommer la cible et le service Cloud Run. **`target_name`** — remplace le nom de la cible Cloud Deploy (par défaut `PIPELINE-NAME`). **`service_name`** — remplace le nom du service Cloud Run pour cette étape (par défaut `APPLICATION_NAME-STAGE`). **`project_id`** — déploie cette étape vers un projet GCP différent (par défaut le projet actuel ; utile pour l'isolation de production inter-projets). **`region`** — déploie cette étape vers une région différente. **`require_approval`** — lorsque `true`, une approbation manuelle est requise dans la console Cloud Deploy avant qu'une version puisse être promue à cette étape. **Fortement recommandé pour `prod`**. **`auto_promote`** — lorsque `true`, la version est automatiquement promue à l'étape suivante après un déploiement réussi, sans intervention manuelle. |
| `enable_binary_authorization` | `false` | `true` / `false` | Applique l'**autorisation binaire** sur le service Cloud Run, exigeant que toutes les images de conteneurs portent une attestation cryptographique valide avant de pouvoir être déployées. Cela empêche l'exécution d'images non vérifiées, non signées ou altérées. Lorsque `true`, le sous-module `app_security` du module crée automatiquement le trousseau de clés de signature KMS, l'attestateur et la politique d'autorisation binaire s'ils n'existent pas déjà — aucune pré-configuration manuelle n'est requise. Si `Services GCP` a déjà provisionné ces ressources, elles sont détectées et réutilisées. À utiliser dans les environnements réglementés (services financiers, santé) où la sécurité de la chaîne d'approvisionnement et la provenance des images doivent être appliquées. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | `ALWAYS_ALLOW` / `REQUIRE_ATTESTATION` / `ALWAYS_DENY` | Mode d'application de la politique d'autorisation binaire. S'applique uniquement lorsque `enable_binary_authorization` est `true` et que `Services GCP` n'a pas déjà configuré la politique. **`ALWAYS_ALLOW` :** autorise toute image ; utile lors de la configuration du pipeline. **`REQUIRE_ATTESTATION` :** exige que chaque image déployée porte une signature cryptographique valide de l'attestateur du pipeline CI/CD. **`ALWAYS_DENY` :** bloque tous les déploiements ; à utiliser uniquement pour les scénarios de verrouillage. Commencez par `ALWAYS_ALLOW`, vérifiez que votre pipeline produit des attestations valides, puis passez à `REQUIRE_ATTESTATION` pour la production. |

### Exploration dans GCP — Groupe 7 {#exploring-in-gcp--group-7}

**Console Google Cloud :**
- **Déclencheurs Cloud Build :** Naviguez vers **Cloud Build → Triggers** pour voir le déclencheur, son dépôt connecté, le motif de branche et le dernier statut de build.
- **Historique des builds :** Naviguez vers **Cloud Build → History** pour voir tous les builds passés, leur statut, leur durée et leurs logs.
- **Connexion GitHub :** Naviguez vers **Cloud Build → Repositories (2nd gen)** pour confirmer que la connexion GitHub est établie et que le dépôt est lié.
- **Pipelines Cloud Deploy :** Naviguez vers **Cloud Deploy → Delivery Pipelines** pour voir le pipeline, ses étapes, la version actuelle et l'historique de promotion.
- **Approbations Cloud Deploy :** Les approbations en attente apparaissent dans la console Cloud Deploy sous la cible pertinente — les approbateurs reçoivent une notification par e-mail.
- **Politique d'autorisation binaire :** Naviguez vers **Security → Binary Authorization** pour voir la politique d'application actuelle.

**gcloud CLI :**
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

> **Choisir un modèle de stockage (Groupes 8 et 9).** Adaptez le type de stockage au modèle d'accès. **NFS (ce groupe)** offre un système de fichiers POSIX partagé en lecture-écriture simultanément sur toutes les instances — le bon choix lorsque l'application ou ses sidecars ont besoin d'un véritable système de fichiers montable partagé (médias téléchargés, un répertoire de données de base de données sur un sidecar). Le **stockage d'objets GCS (Groupe 9)** est destiné aux objets gérés par l'application, accessibles via l'API/SDK — moins cher, infiniment scalable, pas de montage. **GCS Fuse (Groupe 9)** fait le pont entre les deux : un bucket exposé comme un chemin de système de fichiers, bon pour les actifs principalement en lecture mais avec des mises en garde sur la sémantique du système de fichiers (pas de verrouillage POSIX, latence plus élevée). NFS et GCS Fuse nécessitent tous deux `execution_environment = "gen2"`. Avec une fondation `Services_GCP` présente, `enable_nfs` découvre automatiquement le Filestore partagé et géré ; seul, il provisionne une seule VM NFS inline (un point de défaillance unique) — préférez la fondation pour toute production.

Ces variables configurent le stockage partagé **Network File System (NFS)** pour l'application, basé sur Google Cloud Filestore. NFS fournit un système de fichiers partagé conforme à POSIX qui est simultanément accessible par toutes les instances Cloud Run, ce qui le rend adapté aux charges de travail qui nécessitent un état persistant partagé sur plusieurs instances de conteneurs — telles que les fichiers multimédias téléchargés par les utilisateurs, les caches partagés ou les données d'application qui doivent survivre aux redémarrages des conteneurs.

> **Prérequis :** Les montages de volumes NFS nécessitent que `execution_environment` soit défini sur `gen2`. Gen1 ne prend pas en charge les montages NFS.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | Lorsque `true`, un volume NFS est monté dans le service Cloud Run au chemin défini par `nfs_mount_path`. Le module utilisera une instance Filestore existante si une est découverte dans le projet (soit nommée via `nfs_instance_name`, soit auto-découverte à partir d'un déploiement `Services GCP`). Une VM GCE NFS inline est créée **uniquement lorsqu'aucun déploiement `Services GCP` n'existe du tout dans le projet** — si `Services GCP` est présent mais a été déployé sans NFS (`create_network_filesystem = false`), le plan échoue avec une erreur vous invitant à redéployer `Services GCP` avec NFS activé, plutôt que de créer une VM inline en conflit. **NFS fournit un stockage persistant partagé** — les fichiers écrits par une instance sont immédiatement visibles par toutes les autres instances. Ceci est essentiel pour les applications qui gèrent les téléchargements de fichiers, la configuration partagée ou toute donnée qui doit persister au-delà de la durée de vie d'un seul conteneur. Définissez sur `false` si votre application est entièrement sans état ou utilise GCS/Cloud SQL pour toute persistance. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin du système de fichiers | Le chemin à l'intérieur du conteneur où le volume NFS est monté. Votre application lit et écrit des fichiers partagés dans ce répertoire. Le chemin ne doit pas entrer en conflit avec un répertoire utilisé par l'image du conteneur elle-même. Choix courants : `/mnt/nfs`, `/data`, `/shared`, `/app/storage`. Utilisé uniquement lorsque `enable_nfs` est `true`. Assurez-vous que votre application est configurée pour lire/écrire dans ce chemin — les fichiers écrits ailleurs dans le système de fichiers du conteneur sont éphémères et perdus lorsque l'instance redémarre. |
| `nfs_volume_name` | `"nfs-data-volume"` | Chaîne | Le nom de volume Kubernetes/Cloud Run utilisé pour le montage NFS. Modifiez ceci lorsqu'un déploiement nécessite un deuxième partage NFS avec un nom de volume distinct — par exemple, séparer un volume multimédia (`nfs-media-volume`) d'un volume de données. Les jobs qui montent ce partage NFS référencent le volume par ce nom dans leur configuration `mount_nfs`. Pertinent uniquement lorsque `enable_nfs` est `true`. |
| `nfs_instance_name` | `""` *(auto-découverte)* | Chaîne | Le nom d'un serveur NFS existant spécifique (VM GCE) auquel se connecter. Lorsqu'il est défini, le module cible directement cette instance et ignore l'auto-découverte. Laissez vide pour permettre au module d'auto-découvrir une instance NFS gérée par `Services GCP` dans le projet, ou de créer une nouvelle VM NFS inline lorsqu'aucun déploiement `Services GCP` n'existe du tout dans le projet. Utilisez ceci lorsque vous avez plusieurs serveurs NFS dans le projet et que vous devez contrôler explicitement celui auquel ce déploiement se connecte, ou lorsque l'auto-découverte sélectionnerait la mauvaise instance. |
| `nfs_instance_base_name` | `"app-nfs"` | Chaîne | Le nom de base pour une nouvelle VM GCE NFS inline créée lorsqu'aucun serveur NFS existant n'est trouvé dans le projet. L'ID de déploiement est ajouté automatiquement pour garantir l'unicité (par exemple `app-nfs-prod`). Ne modifiez ceci que si le nom par défaut entre en conflit avec une ressource existante ou si votre convention de nommage nécessite un préfixe différent. Pertinent uniquement lorsqu'aucune instance NFS existante n'est découverte et que le module doit en provisionner une. |

### Exploration dans GCP — Groupe 8 {#exploring-in-gcp--group-8}

**Console Google Cloud :**
- **Instance NFS (Filestore) :** Si vous utilisez Cloud Filestore, naviguez vers **Filestore → Instances** pour confirmer que l'instance existe, son niveau, sa capacité et son adresse IP.
- **Instance NFS (VM GCE) :** Si vous utilisez une VM GCE NFS, naviguez vers **Compute Engine → VM Instances** et filtrez par le nom de l'instance pour confirmer qu'elle est en cours d'exécution.
- **Montage de volume sur Cloud Run :** Naviguez vers **Cloud Run → Services → *votre service* → Revisions**, sélectionnez la dernière révision, puis cliquez sur **Volumes** pour confirmer que le volume NFS est listé et monté au chemin attendu.
- **Test de connectivité NFS :** Vérifiez les logs Cloud Run (**Cloud Run → Services → *votre service* → Logs**) pour toute erreur de montage NFS au démarrage du conteneur.

**gcloud CLI :**
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

Ces variables configurent la gestion du cycle de vie des images **Google Cloud Storage (GCS)** et **Artifact Registry** pour l'application. GCS offre deux modèles d'intégration distincts : le **stockage d'objets** standard (des buckets que l'application lit et écrit via l'API GCS ou les bibliothèques clientes), et les montages **GCS Fuse** (des buckets exposés comme un chemin de système de fichiers POSIX directement dans le conteneur). Une option de chiffrement KMS est disponible pour les buckets qui nécessitent des clés de chiffrement gérées par le client. Les variables de politique de nettoyage d'Artifact Registry à la fin de ce groupe régissent l'élagage automatique des images pour le dépôt créé en ligne.

> **Prérequis :** Les montages de volumes GCS Fuse nécessitent que `execution_environment` soit défini sur `gen2`.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `create_cloud_storage` | `true` | `true` / `false` | Interrupteur principal pour le provisionnement des buckets GCS. Lorsque `true`, tous les buckets définis dans `storage_buckets` sont créés. Définir sur `false` lorsque les buckets sont gérés en externe, existent déjà, ou lorsque ce déploiement doit partager des buckets provisionnés par un autre module ou déploiement (par exemple, un déploiement `Services GCP` partagé). Lorsque `false`, la variable `storage_buckets` est ignorée mais `gcs_volumes` peut toujours référencer des buckets gérés en externe. |
| `storage_buckets` | `[]` | Liste d'objets | Définit les buckets GCS à provisionner pour l'application. Chaque nom de bucket est automatiquement préfixé par l'ID du projet et le nom de l'application pour garantir l'unicité. Utilisé uniquement lorsque `create_cloud_storage` est `true`. Sous-champs clés par entrée de bucket : **`name_suffix`** — le suffixe ajouté au nom de bucket auto-généré (par exemple, `"data"` produit `PROJECT-APPLICATION-data`). **`location`** — Emplacement GCS pour le bucket ; peut être une région (`"us-central1"`), une double région (`"US-EAST1+US-WEST1"`), ou une multirégion (`"US"`, `"EU"`, `"ASIA"`). La multirégion offre une disponibilité plus élevée mais à un coût plus élevé. **`storage_class`** — `"STANDARD"` (par défaut ; pour les données fréquemment consultées), `"NEARLINE"` (pour les données consultées moins d'une fois par mois), `"COLDLINE"` (consultées moins d'une fois par trimestre), `"ARCHIVE"` (pour la sauvegarde à long terme, rarement consultées). Choisissez en fonction de la fréquence d'accès pour optimiser les coûts. **`force_destroy`** — lorsque `true`, le bucket et tout son contenu sont supprimés lorsque le déploiement est détruit (par défaut : `true`). **Définir sur `false` pour les buckets contenant des données qui doivent être conservées** au-delà du cycle de vie du déploiement. **`versioning_enabled`** — lorsque `true`, GCS conserve les versions précédentes des objets lors de la mise à jour ou de la suppression, permettant la récupération après des écrasements accidentels. Recommandé pour les buckets stockant des données importantes. **`lifecycle_rules`** — liste des règles de cycle de vie des objets (par exemple, supprimer automatiquement les objets de plus de 90 jours, passer à Coldline après 30 jours). **`public_access_prevention`** — `"enforced"` (par défaut ; bloque tout accès public même si des ACL sont définies) ou `"inherited"` (défère à la politique de l'organisation). Laisser comme `"enforced"` sauf si le bucket doit explicitement servir du contenu public. **`uniform_bucket_level_access`** — lorsque `true`, désactive les ACL par objet et applique un contrôle d'accès basé uniquement sur IAM. Recommandé pour tous les nouveaux buckets. |
| `gcs_volumes` | `[]` | Liste d'objets | Buckets GCS à monter comme **volumes de système de fichiers** dans le conteneur à l'aide de GCS Fuse. Cela permet à l'application de lire et d'écrire des objets GCS en utilisant des opérations d'E/S de fichiers standard (ouvrir, lire, écrire, ls) sans utiliser directement l'API GCS. Sous-champs clés : **`name`** — un nom logique pour le volume (référencé dans `mount_gcs_volumes` dans les jobs). **`bucket_name`** — le nom du bucket GCS à monter ; peut être un bucket créé par `storage_buckets` ou tout bucket existant auquel le compte de service Cloud Run peut accéder. Laisser vide pour utiliser le bucket nommé automatiquement. **`mount_path`** — le chemin du système de fichiers dans le conteneur où le bucket apparaît (par exemple, `/mnt/gcs`, `/app/uploads`). **`readonly`** — lorsque `true`, le montage est en lecture seule ; le conteneur ne peut pas écrire dans le bucket via ce montage. **`mount_options`** — options avancées de GCS Fuse (valeurs par défaut : `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). **Note de performance :** GCS Fuse a une latence plus élevée qu'un système de fichiers natif et ne convient pas aux charges de travail qui nécessitent des lectures/écritures aléatoires à faible latence (par exemple, les bases de données). Il est bien adapté à la lecture de fichiers volumineux, à la diffusion de ressources statiques ou à l'écriture de fichiers journaux. |
| `manage_storage_kms_iam` | `false` | `true` / `false` | Contrôle si le module gère la liaison IAM qui accorde au compte de service Cloud Run `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur la clé Cloud KMS utilisée pour chiffrer les buckets de stockage. Il est maintenant sûr de définir cette valeur sur `true` lors du premier déploiement — le sous-module `app_cmek` du module crée automatiquement le trousseau de clés KMS `${project_id}-cmek-keyring` et la CryptoKey `storage-key` s'ils n'existent pas déjà avant d'appliquer la liaison IAM. Si `Services GCP` a été déployé avec `enable_cmek = true`, le même nom de trousseau de clés bien connu est partagé et aucune ressource en double n'est créée. |
| `enable_artifact_registry_cmek` | `false` | `true` / `false` | Lorsque `true`, crée une clé KMS Artifact Registry dans le trousseau de clés CMEK du projet et accorde à l'identité de service Artifact Registry le rôle `roles/cloudkms.cryptoKeyEncrypterDecrypter`, permettant le chiffrement au repos des images de conteneurs avec une clé gérée par le client. Sûr à activer lors du premier déploiement — la clé est créée automatiquement par le module. Fonctionne avec `manage_storage_kms_iam` pour fournir une base de chiffrement CMEK cohérente sur le stockage et le registre d'images. |
| `max_images_to_retain` | `7` | Entier `0`–`100` | Le nombre maximum des images de conteneurs les plus récentes à conserver dans le dépôt Artifact Registry **créé en ligne** pour ce déploiement. Il s'agit d'une politique de CONSERVATION qui agit comme un filet de sécurité — elle empêche les politiques de SUPPRESSION ci-dessous de supprimer les N images les plus récentes même si elles sont anciennes ou non étiquetées. S'applique uniquement au dépôt en ligne créé par ce module (pas un dépôt `Services GCP` partagé) et est limité aux images de ce déploiement par `package_name_prefix`. Définir sur `0` pour désactiver entièrement la protection de rétention. |
| `delete_untagged_images` | `true` | `true` / `false` | Lorsque `true`, supprime automatiquement les images de conteneurs non étiquetées (couches de build orphelines et artefacts intermédiaires) du dépôt Artifact Registry créé en ligne. Les images protégées par `max_images_to_retain` ne sont jamais supprimées quelle que soit l'état de l'étiquette. N'affecte que les images dont le nom d'application est celui de ce déploiement — les autres noms d'images dans le même dépôt ne sont pas touchés. Désactivez ceci (`false`) uniquement si votre pipeline de build s'appuie intentionnellement sur des manifestes non étiquetés comme intermédiaires. |
| `image_retention_days` | `30` | Entier `0`–`3650` | Nombre de jours après lesquels les images de conteneurs sont éligibles à la suppression du dépôt Artifact Registry créé en ligne. Les images dans le compte `max_images_to_retain` sont toujours conservées quelle que soit leur ancienneté. N'affecte que les images dont le nom d'application est celui de ce déploiement. Définir sur `0` pour désactiver la suppression basée sur l'âge. **Pour les environnements de production**, une valeur de `30`–`90` jours conserve un historique raisonnable pour le retour arrière tout en empêchant une croissance illimitée du registre. Doit être comprise entre `0` et `3650` (10 ans). |

### Exploration dans GCP — Groupe 9 {#exploring-in-gcp--group-9}

**Console Google Cloud :**
- **Buckets GCS :** Accédez à **Cloud Storage → Buckets** pour confirmer que les buckets sont créés avec les noms, emplacements et classes de stockage attendus. Cliquez sur un bucket pour afficher sa configuration, y compris la gestion des versions, les règles de cycle de vie et les paramètres d'accès.
- **Prévention de l'accès public :** Dans les détails du bucket, l'onglet **Autorisations** indique si la prévention de l'accès public est appliquée.
- **Montages GCS Fuse :** Accédez à **Cloud Run → Services → *votre service* → Révisions**, sélectionnez la dernière révision et cliquez sur **Volumes** pour confirmer que les volumes GCS sont montés aux chemins attendus.
- **Chiffrement KMS :** Dans les détails du bucket, l'onglet **Configuration** affiche le type de chiffrement et la clé si le chiffrement géré par le client est activé.
- **Politiques de nettoyage d'Artifact Registry :** Accédez à **Artifact Registry → Dépôts → *votre dépôt* → Politiques de nettoyage** pour confirmer que les politiques KEEP et DELETE sont configurées correctement pour ce déploiement.

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

Ces variables configurent la connectivité Redis pour l'application. Plutôt que de provisionner directement une instance Redis, le module injecte les détails de connexion Redis sous forme de variables d'environnement (`REDIS_HOST`, `REDIS_PORT` et, éventuellement, `REDIS_AUTH`) dans le conteneur Cloud Run. L'application est responsable de la lecture de ces variables et de l'établissement de la connexion. Cette conception permet au module de se connecter à n'importe quel service compatible Redis — Google Cloud Memorystore, une VM Redis auto-hébergée ou un fournisseur Redis tiers.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Lorsque `true`, les variables d'environnement `REDIS_HOST` et `REDIS_PORT` sont injectées dans le conteneur Cloud Run. L'application doit être configurée pour utiliser ces variables pour sa connexion Redis. Lorsque `false`, aucune variable d'environnement Redis n'est injectée et l'application doit gérer sa propre configuration de cache indépendamment. **Si `enable_redis` est `true` et `redis_host` est laissé vide**, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis — ceci est utile dans les déploiements où un service compatible Redis s'exécute sur la même VM que le serveur NFS (un modèle courant dans les environnements `Services GCP` partagés). |
| `redis_host` | `""` *(par défaut, IP du serveur NFS)* | Adresse IP ou nom d'hôte | Le nom d'hôte ou l'adresse IP du serveur Redis, injecté comme variable d'environnement `REDIS_HOST`. Utilisé uniquement lorsque `enable_redis` est `true`. **Laisser vide** pour revenir à l'IP du serveur NFS (convient aux environnements partagés à VM unique). **Définir explicitement** lors de la connexion à une instance Redis dédiée telle que : Google Cloud Memorystore pour Redis (utiliser l'IP privée de l'instance — la trouver dans **Memorystore → Redis → *instance* → Point de terminaison principal**), une VM Redis GCE ou un fournisseur Redis externe. Le service Cloud Run communique avec cet hôte via le réseau VPC — assurez-vous que l'instance est accessible depuis le VPC de Cloud Run à l'aide de `vpc_egress_setting` et que les règles de pare-feu autorisent le trafic sur `redis_port`. |
| `redis_port` | `"6379"` | Numéro de port sous forme de chaîne | Le port TCP du serveur Redis, injecté comme variable d'environnement `REDIS_PORT`. Le port par défaut `6379` est le port Redis standard et est correct pour la plupart des déploiements, y compris Cloud Memorystore. Ne le modifiez que si votre instance Redis est configurée pour écouter sur un port non standard. Utilisé uniquement lorsque `enable_redis` est `true`. |
| `redis_auth` | `""` *(pas d'authentification)* | Chaîne de mot de passe *(sensible)* | Le mot de passe d'authentification pour le serveur Redis. Lorsqu'il est défini, cette valeur est stockée dans Secret Manager et injectée en toute sécurité dans le conteneur — elle n'est jamais stockée en texte clair. Laisser vide si l'instance Redis ne nécessite pas d'authentification (acceptable pour les environnements de développement ou les instances accessibles uniquement dans un VPC privé). **Pour les déploiements de production utilisant Cloud Memorystore avec AUTH activé**, définissez cette valeur sur la chaîne d'authentification de l'instance (trouvée dans **Memorystore → Redis → *instance* → Chaîne AUTH**). Pour Redis auto-hébergé, définissez cette valeur sur la valeur configurée dans la directive `requirepass`. L'activation de l'authentification est fortement recommandée pour toute instance Redis accessible sur un réseau, même privé, car elle offre une défense en profondeur. |

### Exploration dans GCP — Groupe 10 {#exploring-in-gcp--group-10}

**Console Google Cloud :**
- **Instance Memorystore Redis :** Accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et son état AUTH.
- **Variables d'environnement Redis sur Cloud Run :** Accédez à **Cloud Run → Services → *votre service* → Révisions**, sélectionnez la dernière révision, cliquez sur **Conteneur(s)** et affichez la section **Variables d'environnement** pour confirmer la présence de `REDIS_HOST` et `REDIS_PORT`.
- **Connectivité VPC :** Accédez à **Réseau VPC → Pare-feu** et confirmez qu'une règle autorise le trafic TCP de la plage VPC du service Cloud Run vers l'IP de l'instance Redis sur le port configuré.

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

## Groupe 11 — Backend de base de données {#group-11--database-backend}

> **Choisir le backend de base de données.** Décidez d'abord *si* vous en avez besoin : `database_type = "NONE"` ignore tout provisionnement de base de données (et désactive les fonctionnalités dépendantes — importation de sauvegarde, SQL personnalisé, rotation automatique, le volume Cloud SQL — chacune étant rejetée au moment de la planification si elle est laissée activée avec `NONE`). Si vous avez besoin d'une base de données, choisissez le moteur requis par votre application (`POSTGRES`/`MYSQL`, ou une variante avec version épinglée comme `POSTGRES_15`). **Épinglez la version pour la production** — `database_type` est effectivement immuable : la modifier après le premier déploiement *remplace l'instance Cloud SQL et détruit ses données*. L'emplacement de l'instance est automatique : avec une fondation `Services_GCP`, le module ne crée qu'une base de données + un utilisateur dans l'instance partagée (pas de coût d'instance par déploiement) ; de manière autonome, il provisionne une instance dédiée. Les bascules de famille de moteurs (`enable_postgres_extensions`, `enable_mysql_plugins`) doivent correspondre au moteur choisi — une incompatibilité est détectée au moment de la planification.

Ces variables configurent le backend de base de données Cloud SQL pour l'application. Le module prend en charge PostgreSQL, MySQL et SQL Server. Il peut provisionner automatiquement une nouvelle instance Cloud SQL, se connecter à une instance existante ou ignorer entièrement le provisionnement de la base de données. Les identifiants de la base de données sont générés en toute sécurité et injectés dans l'application via Secret Manager — l'application reçoit `DB_HOST`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` comme variables d'environnement.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Voir les options ci-dessous | Le moteur de base de données Cloud SQL à provisionner. Utilisez `"NONE"` pour ignorer entièrement le provisionnement de la base de données (pour les applications sans état ou celles utilisant une base de données externe). Les **alias génériques** (`POSTGRES`, `MYSQL`) déploient la dernière version prise en charge gérée par Cloud SQL. Les **valeurs épinglées à une version** déploient une version spécifique du moteur et sont recommandées pour les environnements de production où la cohérence des versions entre les déploiements est importante. Options prises en charge : `NONE` — pas de base de données ; `POSTGRES` / `POSTGRESQL` / `POSTGRES_15` / `POSTGRES_14` / `POSTGRES_13` / `POSTGRES_12` / `POSTGRES_11` / `POSTGRES_10` / `POSTGRES_9_6` ; `MYSQL` / `MYSQL_8_0` / `MYSQL_5_7` / `MYSQL_5_6` ; `SQLSERVER` / `SQLSERVER_2019_ENTERPRISE` / `SQLSERVER_2019_STANDARD` / `SQLSERVER_2017_ENTERPRISE` / `SQLSERVER_2017_STANDARD`. **Remarque :** la modification de `database_type` après le déploiement initial tentera de remplacer l'instance Cloud SQL, ce qui entraînera une perte de données à moins qu'une sauvegarde ne soit restaurée au préalable. |
| `sql_instance_name` | `""` *(découverte automatique)* | Chaîne | Le nom d'une instance Cloud SQL existante spécifique à laquelle se connecter. Lorsqu'il est défini, le module utilise directement cette instance et ignore la découverte automatique et la création d'instance. Laisser vide pour permettre au module de découvrir automatiquement une instance gérée par `Services GCP` dans le projet, ou de créer une nouvelle instance si aucune n'est trouvée. Utilisez ceci lorsque vous avez plusieurs instances Cloud SQL dans le projet et que vous devez en cibler une explicitement, ou lorsque vous réutilisez une instance partagée sur plusieurs déploiements d'applications. L'instance nommée doit déjà exister et être d'un `database_type` compatible. |
| `sql_instance_base_name` | `"app-sql"` | Chaîne | Le nom de base d'une nouvelle instance Cloud SQL créée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté automatiquement pour garantir l'unicité (par exemple, `app-sql-prod`). Ne modifiez ceci que si le nom par défaut entre en conflit avec une ressource existante ou si votre convention de nommage exige un préfixe différent. Pertinent uniquement lorsque `sql_instance_name` est vide et qu'aucune instance existante n'est découverte automatiquement. |
| `application_database_name` | `"crappdb"` | `[a-z][a-z0-9_]{0,62}` (1 à 63 caractères) | Le nom de la base de données créée dans l'instance Cloud SQL. Injecté dans le conteneur de l'application comme variable d'environnement `DB_NAME`. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des tirets bas. Choisissez un nom qui reflète l'application et l'environnement, par exemple `crm_prod`, `payments_staging`. Utilisé uniquement lorsque `database_type` n'est pas `NONE`. **Ne pas modifier après le déploiement initial** — le renommage de la base de données nécessite une migration manuelle des données. |
| `application_database_user` | `"crappuser"` | `[a-z][a-z0-9_]{0,31}` (1 à 32 caractères) | Le nom d'utilisateur de la base de données créé pour l'application. Injecté dans le conteneur de l'application comme variable d'environnement `DB_USER`. Doit commencer par une lettre minuscule et ne contenir que des lettres minuscules, des chiffres et des tirets bas. Utilisez un nom significatif tel que `crm_svc` ou `app_user`. Le mot de passe correspondant est auto-généré, stocké dans Secret Manager et injecté comme `DB_PASSWORD`. Utilisé uniquement lorsque `database_type` n'est pas `NONE`. |
| `db_password_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel le secret du mot de passe de la base de données est également exposé, en plus du `DB_PASSWORD` standard. Destiné aux modules wrapper qui encapsulent des applications qui attendent un nom de variable de mot de passe non standard (par exemple, WordPress nécessite `WORDPRESS_DB_PASSWORD`). Laisser vide pour injecter le mot de passe uniquement comme `DB_PASSWORD`. Lorsqu'il est défini, `DB_PASSWORD` et la variable nommée pointent vers la même version secrète de Secret Manager — la modification de cette valeur sur un déploiement existant n'affecte pas le mot de passe de la base de données lui-même. |
| `database_password_length` | `32` | Entier `16`–`64` | La longueur en caractères du mot de passe utilisateur de la base de données généré aléatoirement. Les mots de passe plus longs offrent beaucoup plus d'entropie et sont plus difficiles à forcer. **Minimum recommandé pour la production : `32`**. Le mot de passe est généré une fois lors du premier déploiement, stocké dans Secret Manager et automatiquement renouvelé si `enable_auto_password_rotation` est activé. La modification de cette valeur lors d'un déploiement ultérieur génère un nouveau mot de passe uniquement si la rotation est déclenchée — elle ne modifie pas rétroactivement la longueur du mot de passe existant. |
| `enable_postgres_extensions` | `false` | `true` / `false` | Lorsque `true`, active l'installation d'extensions PostgreSQL dans la base de données de l'application après le provisionnement. S'applique uniquement lorsque `database_type` est une variante PostgreSQL. Définir sur `false` si aucune extension n'est requise ou si les extensions sont gérées par l'application au démarrage. |
| `postgres_extensions` | `[]` | Liste de chaînes de noms d'extensions | Les extensions PostgreSQL à installer dans la base de données de l'application. Nécessite `enable_postgres_extensions = true` et un `database_type` PostgreSQL. Extensions courantes : `postgis` (données géospatiales), `uuid-ossp` (génération d'UUID), `pg_trgm` (recherche de texte par trigrammes), `pgcrypto` (fonctions cryptographiques), `hstore` (stockage clé-valeur), `pg_stat_statements` (suivi des performances des requêtes). Assurez-vous que l'extension est prise en charge par la version de Cloud SQL PostgreSQL utilisée. |
| `enable_mysql_plugins` | `false` | `true` / `false` | Lorsque `true`, active l'installation de plugins MySQL dans la base de données de l'application après le provisionnement. S'applique uniquement lorsque `database_type` est une variante MySQL. Définir sur `false` si aucun plugin n'est requis ou si les plugins sont gérés par l'application au démarrage. |
| `mysql_plugins` | `[]` | Liste de chaînes de noms de plugins | Les plugins MySQL à installer dans la base de données de l'application. Nécessite `enable_mysql_plugins = true` et un `database_type` MySQL. Plugins courants : `audit_log` (journalisation d'audit pour la conformité), `validate_password` (application de la force du mot de passe). Vérifiez la disponibilité des plugins pour votre version spécifique de MySQL dans Cloud SQL avant d'activer. |
| `enable_auto_password_rotation` | `false` | `true` / `false` | Lorsque `true`, déploie un mécanisme de rotation de mot de passe automatisé composé d'un job de rotation Cloud Run et d'un déclencheur Eventarc qui se déclenche lorsque Secret Manager publie une notification de rotation. Le job de rotation génère un nouveau mot de passe de base de données, met à jour l'utilisateur Cloud SQL et le secret Secret Manager, puis redémarre le service Cloud Run pour récupérer les nouvelles informations d'identification. La fréquence de rotation est régie par `secret_rotation_period` (Groupe 4). **Recommandé pour les environnements de production** afin de limiter la portée d'une fuite d'identifiant de base de données. S'applique uniquement lorsque `database_type` n'est pas `NONE`. |
| `rotation_propagation_delay_sec` | `90` | Entier (secondes) | Le nombre de secondes à attendre après l'écriture d'un nouveau mot de passe de base de données dans Secret Manager avant de redémarrer le service Cloud Run. Ce délai permet à la réplication globale de Secret Manager de se terminer afin que la nouvelle version du secret soit disponible dans toutes les régions avant que les instances ne tentent de la lire. **Augmentez cette valeur** (par exemple, à `120`) dans les déploiements multirégionaux ou si vous observez des échecs de rotation où les instances démarrent avec les nouvelles informations d'identification avant que le secret ne soit entièrement propagé. Utilisé uniquement lorsque `enable_auto_password_rotation` est `true`. |
| `db_host_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel l'hôte de la base de données est également exposé, en plus du `DB_HOST` standard. Destiné aux modules wrapper qui encapsulent des applications qui attendent un nom de variable d'hôte non standard (par exemple, `NC_DB_HOST` de Nextcloud). Laisser vide pour injecter l'hôte uniquement comme `DB_HOST`. |
| `db_user_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel l'utilisateur de la base de données est également exposé, en plus du `DB_USER` standard. Laisser vide pour injecter l'utilisateur uniquement comme `DB_USER`. |
| `db_name_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel le nom de la base de données est également exposé, en plus du `DB_NAME` standard. Laisser vide pour injecter le nom uniquement comme `DB_NAME`. |
| `db_port_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel le port de la base de données est également exposé, en plus du `DB_PORT` standard. Laisser vide pour injecter le port uniquement comme `DB_PORT`. |
| `service_url_env_var_name` | `""` *(désactivé)* | Chaîne de nom de variable d'environnement | Un nom de variable d'environnement supplémentaire sous lequel l'URL du service Cloud Run est également exposée, en plus du `CLOUDRUN_SERVICE_URL` standard. Utile pour les applications qui construisent des URL absolues à partir d'une variable spécifique (par exemple, `NC_PUBLIC_URL`, `URL` d'Outline). Laisser vide pour injecter l'URL uniquement comme `CLOUDRUN_SERVICE_URL`. |

### Exploration dans GCP — Groupe 11 {#exploring-in-gcp--group-11}

**Console Google Cloud :**
- **Instance Cloud SQL :** Accédez à **SQL** pour confirmer l'existence de l'instance, son moteur de base de données, sa version, sa région et son nom de connexion.
- **Bases de données et utilisateurs :** Cliquez sur l'instance, puis sélectionnez les onglets **Bases de données** et **Utilisateurs** pour confirmer que la base de données et l'utilisateur de l'application ont été créés.
- **Identifiants de base de données dans Secret Manager :** Accédez à **Sécurité → Secret Manager** et filtrez par le nom de l'application pour trouver le secret `DB_PASSWORD`. Affichez ses versions et son calendrier de rotation.
- **Job de rotation de mot de passe :** Accédez à **Cloud Run → Jobs** et recherchez un job de rotation nommé d'après l'application. Accédez à **Eventarc → Déclencheurs** pour confirmer que le déclencheur de rotation est configuré.
- **Variables d'environnement de base de données sur Cloud Run :** Accédez à **Cloud Run → Services → *votre service* → Révisions → Conteneur(s)** et confirmez que `DB_HOST`, `DB_NAME`, `DB_USER` apparaissent comme des variables d'environnement en texte clair et que `DB_PASSWORD` apparaît comme une référence secrète.

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

Ces variables configurent la planification automatisée des sauvegardes de base de données et l'importation de sauvegardes ponctuelles. Le module provisionne un job Cloud Run pour effectuer des dumps de base de données, un déclencheur Cloud Scheduler pour l'exécuter selon un calendrier défini, et un bucket GCS pour stocker les fichiers de sauvegarde résultants. Un mécanisme d'importation ponctuelle distinct permet de restaurer une sauvegarde existante dans la base de données pendant le déploiement — utile pour amorcer un nouvel environnement avec des données de production.

> **Remarque :** Les opérations de sauvegarde et d'importation s'appliquent uniquement lorsque `database_type` n'est pas `NONE`.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Expression cron Unix (UTC) | Le calendrier cron qui contrôle l'exécution du job de sauvegarde de base de données automatisé. Toutes les heures sont en **UTC**. Le job de sauvegarde effectue un dump de base de données et écrit la sortie dans le bucket de sauvegarde GCS du module. Exemples de calendriers courants : `"0 2 * * *"` — tous les jours à 02:00 UTC ; `"0 */6 * * *"` — toutes les 6 heures ; `"0 2 * * 0"` — toutes les semaines le dimanche à 02:00 UTC ; `"0 2 1 * *"` — tous les mois le 1er à 02:00 UTC. **Choisissez un calendrier qui correspond à votre objectif de point de récupération (RPO)** — par exemple, une sauvegarde quotidienne signifie que vous pourriez perdre jusqu'à 24 heures de données dans le pire des cas. Pour les bases de données de production critiques, envisagez un calendrier horaire ou toutes les 6 heures. Planifiez la sauvegarde pendant les périodes de faible trafic pour minimiser l'impact sur les performances de la base de données. |
| `backup_retention_days` | `7` | Entier positif | Le nombre de jours pendant lesquels les fichiers de sauvegarde sont conservés dans le bucket de sauvegarde GCS avant d'être automatiquement supprimés par une règle de cycle de vie. La définition d'une période de rétention plus longue augmente les coûts de stockage mais offre une fenêtre de récupération plus longue. **Conseils par environnement :** développement — `7` jours est généralement suffisant ; staging — `14`–`30` jours ; production — `30`–`90` jours ou plus selon les exigences de conformité. Certains cadres réglementaires (par exemple, PCI-DSS, HIPAA) imposent des périodes de rétention minimales pour les sauvegardes — vérifiez vos exigences avant de réduire cette valeur. |
| `enable_backup_import` | `false` | `true` / `false` | Lorsque `true`, un job d'importation de base de données ponctuel est exécuté pendant le déploiement, restaurant le fichier de sauvegarde spécifié par `backup_file` à partir de la source définie dans `backup_source`. Ceci est conçu pour **amorcer un nouvel environnement** avec des données d'une sauvegarde existante — par exemple, peupler un environnement de staging avec une copie des données de production, ou restaurer une base de données après un nouveau déploiement. **Configurez `backup_source`, `backup_file` et `backup_format` avant d'activer.** Le job d'importation s'exécute après le provisionnement de la base de données. Si la base de données contient déjà des données, l'importation peut produire des erreurs ou des conflits selon le format de la sauvegarde — testez d'abord dans un environnement hors production. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | La source à partir de laquelle le fichier de sauvegarde est récupéré pour l'importation. **`gcs`** : récupère le fichier de sauvegarde du bucket de sauvegarde GCS provisionné par le module. Le fichier doit être téléchargé dans le bucket avant le déploiement. **`gdrive`** : récupère le fichier de sauvegarde à partir d'un emplacement Google Drive. Utile lorsque les fichiers de sauvegarde sont stockés dans un Google Drive partagé plutôt que dans GCS. Utilisé uniquement lorsque `enable_backup_import` est `true`. |
| `backup_file` | `"backup.sql"` | Chaîne de nom de fichier | Le nom du fichier de sauvegarde à importer dans la base de données. Le fichier doit exister à la source configurée (`backup_source`) avant le début du déploiement. Pour GCS, le fichier doit être présent dans le bucket de sauvegarde du module. Exemples : `"backup.sql"`, `"2024-01-15-dump.sql.gz"`, `"production-snapshot.tar"`. Utilisé uniquement lorsque `enable_backup_import` est `true`. Assurez-vous que le nom de fichier correspond exactement au fichier présent dans la source, y compris l'extension — une incompatibilité entraînera l'échec du job d'importation. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | Le format du fichier de sauvegarde à importer. Doit correspondre au format réel de `backup_file`. **`sql`** : dump SQL en texte clair (par exemple, sortie `pg_dump` ou `mysqldump`). **`gz`** : dump SQL compressé gzip. **`tar`** / **`tgz`** / **`tar.gz`** : archive tar (éventuellement compressée). **`zip`** : archive ZIP. **`auto`** : le job d'importation tente de détecter automatiquement le format à partir de l'extension du fichier — utilisez ceci lorsque le format peut varier entre les exécutions, mais les valeurs explicites sont préférées pour la fiabilité. Utilisé uniquement lorsque `enable_backup_import` est `true`. |

### Exploration dans GCP — Groupe 12 {#exploring-in-gcp--group-12}

**Console Google Cloud :**
- **Calendrier de sauvegarde (Cloud Scheduler) :** Accédez à **Cloud Scheduler** pour confirmer que le déclencheur du job de sauvegarde existe, son calendrier, l'heure de sa dernière exécution et son état (activé/en pause).
- **Job de sauvegarde (Cloud Run Jobs) :** Accédez à **Cloud Run → Jobs** pour confirmer que le job de sauvegarde existe. Cliquez sur le job et sélectionnez **Exécutions** pour afficher les exécutions passées, leur état et leur durée.
- **Fichiers de sauvegarde (bucket GCS) :** Accédez à **Cloud Storage → Buckets** et recherchez le bucket de sauvegarde (nommé d'après l'application avec un suffixe `-backup`). Cliquez sur le bucket pour confirmer que les fichiers de sauvegarde sont écrits et pour vérifier que les règles de cycle de vie sont appliquées.
- **Job d'importation :** Après avoir activé `enable_backup_import`, accédez à **Cloud Run → Jobs → Exécutions** pour confirmer que le job d'importation s'est exécuté avec succès. Affichez les journaux pour toute erreur.

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

Ces variables permettent l'exécution de scripts SQL personnalisés sur la base de données de l'application pendant le déploiement. Cela fournit un mécanisme flexible pour appliquer des modifications de schéma, installer des procédures stockées, créer des rôles ou charger des données initiales qui ne peuvent pas être gérées par le framework de migration de l'application. Les scripts sont récupérés d'un bucket GCS et exécutés dans l'ordre lexicographique (alphabétique), ce qui facilite la gestion des versions et le séquençage des migrations.

> **Note :** Les scripts SQL personnalisés ne s'exécutent que lorsque `database_type` n'est pas `NONE`. Le compte de service Cloud Run doit avoir un accès en lecture au bucket GCS contenant les scripts.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | `true` / `false` | Lorsque `true`, le module récupère les fichiers de script SQL du bucket GCS et du chemin spécifiés par `custom_sql_scripts_bucket` et `custom_sql_scripts_path`, puis les exécute sur la base de données de l'application dans l'ordre lexicographique. Les scripts s'exécutent dans le cadre du processus de déploiement via un job Cloud Run. Ceci est destiné aux **migrations de schéma, à l'installation de procédures stockées, à la création de rôles ou au chargement de données initiales** qui doivent se produire au niveau de l'infrastructure plutôt qu'au sein de l'application. Définissez sur `false` si votre application gère ses propres migrations de schéma au démarrage (par exemple, via Flyway, Liquibase, les migrations Django ou Alembic). **Important :** les scripts sont réexécutés à chaque déploiement si `execute_on_apply` est configuré — concevez des scripts idempotents (pouvant être exécutés plusieurs fois sans erreur) pour éviter les erreurs lors des exécutions répétées. |
| `custom_sql_scripts_bucket` | `""` | Nom du bucket GCS | Le nom du bucket GCS contenant les fichiers de script SQL à exécuter. Le bucket doit exister avant le déploiement et le compte de service Cloud Run doit avoir au minimum `roles/storage.objectViewer` sur ce bucket. Il peut s'agir du propre bucket d'application provisionné par le module (par exemple, `PROJECT-APPLICATION-data`) ou d'un bucket de scripts dédié partagé entre plusieurs déploiements. Requis lorsque `enable_custom_sql_scripts` est `true`. |
| `custom_sql_scripts_path` | `""` | Chaîne de préfixe de chemin GCS | Le préfixe de chemin dans le bucket GCS à partir duquel les scripts SQL sont récupérés. Tous les fichiers `.sql` trouvés sous ce préfixe sont exécutés dans l'**ordre lexicographique (alphabétique)**. Utilisez une convention de nommage telle que `001_create_tables.sql`, `002_add_indexes.sql`, `003_seed_data.sql` pour contrôler précisément l'ordre d'exécution. Exemples : `"init/"` — exécute tous les fichiers `.sql` du dossier `init/` ; `"migrations/v2/"` — exécute tous les fichiers `.sql` d'un sous-dossier versionné. Requis lorsque `enable_custom_sql_scripts` est `true`. Assurez-vous qu'aucun fichier `.sql` indésirable n'existe sous le préfixe, car tous les fichiers correspondants seront exécutés. |
| `custom_sql_scripts_use_root` | `false` | `true` / `false` | Contrôle quel utilisateur de base de données exécute les scripts SQL personnalisés. **`false` (par défaut) :** les scripts s'exécutent en tant qu'utilisateur de la base de données de l'application (`application_database_user`), qui a des permissions limitées à la base de données de l'application uniquement. C'est le **paramètre recommandé** pour la plupart des scripts. **`true` :** les scripts s'exécutent en tant que compte de base de données root (super-utilisateur). Activez uniquement lorsque les scripts nécessitent des privilèges élevés non disponibles pour l'utilisateur de l'application — par exemple, la création d'extensions PostgreSQL (`CREATE EXTENSION`), la création de rôles supplémentaires (`CREATE ROLE`) ou la modification de la configuration au niveau de la base de données. **Utilisez avec prudence :** l'exécution de SQL arbitraire en tant que root comporte un risque plus élevé de modifications accidentelles ou destructrices de l'instance de base de données. |

### Exploration dans GCP — Groupe 13 {#exploring-in-gcp--group-13}

**Console Google Cloud :**
- **Job d'exécution de script :** Accédez à **Cloud Run → Jobs** et recherchez le job de scripts SQL (nommé d'après l'application). Sélectionnez le job et cliquez sur **Executions** pour afficher l'historique des exécutions, l'état et les logs.
- **Fichiers de script dans GCS :** Accédez à **Cloud Storage → Buckets → *bucket de scripts*** et confirmez que les fichiers `.sql` attendus existent au préfixe de chemin configuré.
- **Accès IAM sur le bucket :** Dans les détails du bucket, sélectionnez l'onglet **Permissions** et confirmez que le compte de service Cloud Run a au minimum l'accès `Storage Object Viewer`.
- **Logs d'exécution de script :** Dans les détails d'exécution du job, cliquez sur **Logs** pour afficher la sortie SQL et confirmer que les scripts se sont exécutés avec succès ou diagnostiquer les échecs.

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

> **Choisir l'accès et le réseau.** Deux axes indépendants. L'**Ingress** contrôle qui peut atteindre le service : `"all"` pour une application publique ; `"internal"` pour les backends uniquement VPC ; `"internal-and-cloud-load-balancing"` chaque fois qu'un équilibreur de charge le précède — et c'est un couplage obligatoire avec `enable_cloud_armor` (Groupe 16), car `"all"` laisse l'URL `*.run.app` publiquement accessible et contourne entièrement le WAF. L'**Egress** contrôle le trafic sortant : conservez `"PRIVATE_RANGES_ONLY"` si l'application ne communique qu'avec des ressources VPC privées (Cloud SQL, Memorystore, NFS) ; passez à `"ALL_TRAFFIC"` si elle appelle des API externes/SaaS/webhooks, ou si ces appels expirent silencieusement. Laissez `network_name` vide pour découvrir automatiquement le VPC `Services_GCP` unique ; ne le définissez que lorsque le projet en a plus d'un.

Ces variables contrôlent la façon dont le trafic atteint le service Cloud Run et comment le service se connecte en sortie à d'autres ressources GCP. Une configuration correcte ici est essentielle à la fois pour la sécurité (restreindre l'exposition à l'internet public) et la connectivité (garantir que le service peut atteindre les instances Cloud SQL privées, Memorystore ou les volumes NFS via VPC).

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `ingress_settings` | `"all"` | `all` / `internal` / `internal-and-cloud-load-balancing` | Contrôle les sources de trafic autorisées à invoquer le service Cloud Run. **`all` :** Le service est publiquement accessible depuis Internet. À utiliser pour les applications grand public. **`internal` :** Seul le trafic provenant du même réseau VPC ou d'autres services internes Google (par exemple, Cloud Tasks, Pub/Sub push) peut atteindre le service. À utiliser pour les API backend, les workers ou tout service qui ne doit pas être directement exposé à Internet. **`internal-and-cloud-load-balancing` :** Restreint l'accès direct à Internet mais autorise le trafic arrivant via un équilibreur de charge Google Cloud (GCLB). C'est le paramètre correct lors de l'utilisation de `enable_cloud_armor = true`, car le GCLB précède le service et fournit la terminaison SSL, les règles WAF et le CDN. La modification de ce paramètre prend effet lors du prochain déploiement sans nécessiter de nouvelle révision. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | `ALL_TRAFFIC` / `PRIVATE_RANGES_ONLY` | Contrôle quel trafic sortant du service Cloud Run est acheminé via le réseau VPC configuré. **`PRIVATE_RANGES_ONLY` (par défaut) :** Seul le trafic destiné aux plages d'adresses IP privées RFC 1918 (par exemple, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) est envoyé via le VPC. Le trafic Internet public quitte Cloud Run directement sans traverser le VPC. Cela convient à la plupart des charges de travail où l'application doit atteindre Cloud SQL, Memorystore ou NFS via une IP privée tout en appelant des API publiques externes. **`ALL_TRAFFIC` :** Tout le trafic sortant — y compris les requêtes Internet publiques — est acheminé via le VPC. Requis lorsque l'accès Internet sortant doit être contrôlé via une passerelle Cloud NAT, lorsqu'une connectivité sur site est nécessaire via VPN ou Interconnect, ou lorsque les politiques d'égression imposent que tout le trafic sorte par un chemin réseau spécifique. Notez que `ALL_TRAFFIC` peut augmenter la latence pour les appels aux API Google publiques et aux services externes. |
| `network_name` | `""` *(découverte automatique)* | Chaîne de nom de réseau VPC | Le nom du réseau VPC auquel attacher le service Cloud Run pour le routage d'égression et l'égression VPC directe. Laissez vide pour permettre au module de découvrir automatiquement le réseau unique géré par Services GCP dans le projet. **Spécifiez une valeur** lorsque plus d'un réseau géré par Services GCP existe dans le projet, ou lorsque vous souhaitez attacher le service à un réseau spécifique. Le réseau doit exister dans le même projet. La modification de cette valeur déclenchera une nouvelle révision Cloud Run. |
| `prereq_subnet_cidr_override` | `""` | Chaîne CIDR | Remplacement du CIDR du sous-réseau primaire VPC intégré créé lorsqu'aucun réseau `Services GCP` n'existe. Lorsqu'il est vide (par défaut), la fondation dérive un `/24` unique par déploiement à partir de l'ID de déploiement aléatoire. Définissez-le sur la valeur précédemment appliquée (par exemple, `"10.200.0.0/24"`) sur les déploiements autonomes existants pour éviter le remplacement des ressources. N'a aucun effet lorsqu'un réseau géré par `Services GCP` est utilisé. |

### Exploration dans GCP — Groupe 14 {#exploring-in-gcp--group-14}

**Console Google Cloud :**
- **Paramètres d'entrée (Ingress) :** Accédez à **Cloud Run → Services → *votre service* → onglet Détails**. Sous **Mise en réseau**, confirmez que le paramètre d'entrée correspond à la valeur configurée.
- **Sortie VPC (Egress) :** Dans la même section **Mise en réseau**, confirmez que l'attachement au réseau VPC et le paramètre de sortie sont affichés correctement.

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

## Groupe 15 — Proxy d'authentification (Identity-Aware Proxy) {#group-15--identity-aware-proxy}

Ces variables configurent Identity-Aware Proxy (IAP) devant le service Cloud Run, exigeant une authentification par identité Google avant que les utilisateurs puissent accéder à l'application. IAP applique l'accès au niveau de la couche proxy — aucune modification du code de l'application n'est nécessaire pour ajouter l'authentification. Il est recommandé pour les outils internes, les interfaces d'administration ou toute application où l'accès doit être restreint aux identités Google connues. `enable_iap` est l'interrupteur principal ; `iap_authorized_users` et `iap_authorized_groups` définissent qui est autorisé à accéder.

> **Note :** Pour que l'IAP fonctionne correctement, `ingress_settings` (Groupe 14) doit être défini sur `internal-and-cloud-load-balancing` lorsque le service est précédé d'un GCLB, ou sur `all` pour les services Cloud Run directement protégés par l'IAP.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_iap` | `false` | `true` / `false` | Active Identity-Aware Proxy (IAP) devant le service Cloud Run. Lorsque `true`, toutes les requêtes vers le service doivent contenir un identifiant d'identité Google valide — les requêtes non authentifiées sont redirigées vers une page de connexion Google. IAP applique l'accès au niveau de la couche proxy, ce qui signifie qu'**aucune modification du code de l'application n'est nécessaire** pour ajouter l'authentification. Utilisez IAP pour les outils internes, les interfaces d'administration ou toute application où l'accès doit être restreint aux identités Google connues. Lorsqu'il est activé, configurez `iap_authorized_users` et `iap_authorized_groups` pour définir qui peut accéder à l'application. |
| `iap_authorized_users` | `[]` | Liste de chaînes `"user:email"` ou `"serviceAccount:email"` | Utilisateurs individuels ou comptes de service auxquels le rôle `IAP-secured Web App User` est attribué, leur permettant d'accéder à l'application via IAP. Actif uniquement lorsque `enable_iap` est `true`. Chaque entrée doit utiliser le format de membre IAM : `"user:alice@example.com"` pour un compte Google, ou `"serviceAccount:ci-runner@project.iam.gserviceaccount.com"` pour un compte de service (par exemple, pour permettre aux pipelines CI/CD ou aux agents de vérification de l'état de contourner la page de connexion). L'ajout d'une adresse ici n'accorde **pas** d'autres permissions IAM GCP sur le projet — il contrôle uniquement l'accès à l'application protégée par IAP. Pour la gestion de l'accès au niveau de l'équipe, préférez `iap_authorized_groups` aux entrées d'utilisateurs individuels. |
| `iap_authorized_groups` | `[]` | Liste de chaînes `"group:name@domain"` | Groupes Google auxquels le rôle `IAP-secured Web App User` est attribué. Actif uniquement lorsque `enable_iap` est `true`. Chaque entrée doit utiliser le format de membre IAM : `"group:engineering@example.com"`. L'utilisation de groupes est l'approche recommandée pour accorder l'accès aux équipes, car l'appartenance peut être gérée de manière centralisée dans Google Workspace ou Cloud Identity sans nécessiter un nouveau déploiement. La combinaison de `iap_authorized_groups` avec `iap_authorized_users` est prise en charge — l'accès est accordé à l'union des deux listes. |

### Exploration dans GCP — Groupe 15 {#exploring-in-gcp--group-15}

**Console Google Cloud :**
- **État de l'IAP :** Accédez à **Sécurité → Identity-Aware Proxy**. Le service Cloud Run devrait apparaître dans la liste avec l'IAP activé. La colonne **Accès** indique le nombre de principaux autorisés.
- **Membres autorisés par l'IAP :** Cliquez sur l'entrée du service dans la console IAP et sélectionnez l'onglet **Principaux** pour vérifier que les utilisateurs, comptes de service et groupes attendus sont listés avec le rôle `IAP-secured Web App User`.

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

Ces variables configurent un équilibreur de charge HTTPS global devant le service Cloud Run, avec une protection WAF Cloud Armor optionnelle, une terminaison SSL de domaine personnalisé et une mise en cache en périphérie Cloud CDN. L'activation de ce groupe est requise chaque fois que l'application a besoin d'un domaine personnalisé stable avec un certificat SSL géré par Google, d'une atténuation DDoS, de contrôles d'accès basés sur IP ou de contenu statique mis en cache globalement. Les quatre variables fonctionnent ensemble comme une unité — `enable_cloud_armor` est l'interrupteur principal, et les variables restantes affinent son comportement.

> **Note :** Le provisionnement d'un équilibreur de charge HTTPS global et d'une politique Cloud Armor entraîne des coûts GCP supplémentaires au-delà de la tarification Cloud Run. Consultez la [page de tarification de Cloud Armor](https://cloud.google.com/armor/pricing) avant d'activer en production.

> **Note :** Lorsque `enable_cloud_armor` est `true`, définissez `ingress_settings` (Groupe 14) sur `internal-and-cloud-load-balancing` pour vous assurer que le service Cloud Run n'accepte que le trafic qui a traversé l'équilibreur de charge et la politique Cloud Armor.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_cloud_armor` | `false` | `true` / `false` | Interrupteur principal pour la pile de l'équilibreur de charge. Lorsque `true`, le module provisionne un équilibreur de charge HTTPS global avec un backend NEG sans serveur ciblant le service Cloud Run, un certificat SSL géré par Google pour chaque domaine dans `application_domains`, et une politique de sécurité Cloud Armor. Ceci est requis pour la **terminaison HTTPS de domaine personnalisé**, la **protection DDoS**, les **règles WAF** et le **CDN**. Lorsque `false`, le service Cloud Run est accédé directement via son URL `*.run.app` et toutes les autres variables de ce groupe n'ont aucun effet. L'activation de ceci après le déploiement initial crée de nouvelles ressources GCP mais n'affecte pas la révision du service Cloud Run elle-même. |
| `admin_ip_ranges` | `[]` | Liste de chaînes CIDR (par exemple, `["203.0.113.0/24"]`) | Plages d'adresses IP CIDR auxquelles est accordée une règle Cloud Armor de priorité plus élevée les exemptant des règles d'inspection WAF. Les requêtes provenant de ces plages sont autorisées sans condition, contournant toutes les règles `deny` ou WAF de la politique de sécurité. Utilisez ceci pour les réseaux de confiance tels que les IP de sortie de bureau d'entreprise, les IP de runner CI/CD ou les sources de sondes de surveillance qui déclencheraient autrement les règles WAF. Laissez vide pour appliquer les règles WAF uniformément à tout le trafic. N'est efficace que lorsque `enable_cloud_armor` est `true`. **N'ajoutez pas de plages trop larges** (par exemple, `0.0.0.0/0`) car cela annulerait l'objectif de la politique WAF. |
| `application_domains` | `[]` | Liste de chaînes de noms de domaine (par exemple, `["app.example.com", "www.example.com"]`) | Noms de domaine personnalisés à associer à l'équilibreur de charge. Un certificat SSL géré par Google est provisionné automatiquement pour chaque domaine, gérant l'émission et le renouvellement des certificats sans intervention manuelle. Après le déploiement, l'adresse IP externe de l'équilibreur de charge est disponible dans les sorties de déploiement — **les enregistrements DNS A pour chaque domaine doivent pointer vers cette IP** avant que le certificat ne puisse être émis et que le domaine ne serve le trafic. Le provisionnement du certificat prend généralement 10 à 60 minutes après la propagation DNS. Laissez vide si vous n'avez pas besoin d'un domaine personnalisé et que vous êtes satisfait de l'URL `*.run.app` par défaut. Utilisé uniquement lorsque `enable_cloud_armor` est `true`. |
| `enable_cdn` | `false` | `true` / `false` | Active Cloud CDN sur le backend de l'équilibreur de charge, mettant en cache les réponses HTTP sur le réseau de périphérie global de Google. Lorsque `true`, les réponses cachables (celles avec les en-têtes `Cache-Control` appropriés) sont servies depuis le PoP de périphérie le plus proche, réduisant la latence pour les utilisateurs géographiquement distribués et réduisant la charge sur l'origine Cloud Run. S'applique uniquement lorsque `enable_cloud_armor` est `true`. **Recommandé pour** les applications servant des actifs statiques, des images ou des réponses d'API publiques qui changent peu fréquemment. **Non recommandé pour** les applications avec des réponses basées sur des sessions ou très personnalisées où la mise en cache entraînerait la réception de contenu incorrect par les utilisateurs. Assurez-vous que votre application définit des en-têtes `Cache-Control` corrects pour contrôler ce qui est et n'est pas mis en cache en périphérie. |

### Exploration dans GCP — Groupe 16 {#exploring-in-gcp--group-16}

**Console Google Cloud :**
- **Équilibreur de charge :** Accédez à **Services réseau → Équilibrage de charge** et confirmez qu'un équilibreur de charge HTTPS nommé d'après l'application est listé. Cliquez dessus pour afficher les frontends, les backends et la politique Cloud Armor associée.
- **Certificats SSL :** Dans les détails de l'équilibreur de charge, sélectionnez l'onglet **Frontend**. Chaque entrée de domaine doit afficher un certificat géré par Google avec le statut `ACTIVE`. Un statut de `PROVISIONING` indique que le DNS n'a pas encore propagé ou que le certificat est toujours en cours d'émission.
- **Politique Cloud Armor :** Accédez à **Sécurité réseau → Politiques Cloud Armor** et confirmez que la politique est attachée au backend de l'équilibreur de charge. Examinez la liste des règles pour confirmer que les exemptions de plage IP d'administration et les règles WAF sont configurées comme prévu.
- **Statut CDN :** Dans les détails de l'équilibreur de charge, sélectionnez l'onglet **Backend** et confirmez que **Cloud CDN** est affiché comme activé sur le service backend.
- **IP de l'équilibreur de charge :** Dans la configuration **Frontend**, notez l'adresse IP externe. Vérifiez que vos enregistrements DNS A se résolvent à cette IP en utilisant `dig` ou `nslookup`.

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

## Groupe 17 — Contrôles des services VPC et journalisation d'audit {#group-17--vpc-service-controls--audit-logging}

Ces variables contrôlent l'application du périmètre des contrôles des services VPC (VPC-SC) et la journalisation d'audit au niveau du projet. La définition de `enable_vpc_sc = true` fait en sorte que le module **provisionne automatiquement** un périmètre VPC-SC complet via `App_Common/modules/app_vpc_sc` — Services_GCP et une politique Access Context Manager préexistante ne sont **plus requis**. `enable_audit_logging` étend la capture de journal d'audit par défaut limitée à `ADMIN_WRITE` pour inclure `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` pour tous les services GCP, ainsi que des remplacements par service pour Secret Manager et Cloud KMS.

> **Note :** Déployez VPC-SC en **mode simulation d'abord** (`vpc_sc_dry_run = true`, la valeur par défaut). Le périmètre est créé et les violations sont enregistrées, mais les appels d'API ne sont pas bloqués. Examinez les logs de simulation (voir l'extrait gcloud ci-dessous) avant de passer `vpc_sc_dry_run = false` pour appliquer le périmètre.

> **Note :** VPC-SC nécessite une organisation GCP. Les projets autonomes (Qwiklab, comptes Google personnels) n'ont pas d'organisation et `enable_vpc_sc = true` émettra une ligne de log `WARNING: VPC Service Controls skipped …` et ne créera aucune ressource de périmètre. Les projets imbriqués dans des dossiers nécessitent que `organization_id` soit défini explicitement car il ne peut pas être découvert automatiquement à partir des métadonnées du projet.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_vpc_sc` | `false` | `true` / `false` | Lorsque `true`, le module provisionne un périmètre VPC-SC complet autour des API GCP qu'il consomme — politique d'accès (réutilisée si une existe déjà au niveau de l'organisation), quatre niveaux d'accès (réseau VPC, IP d'administration, agent de service IAP, SA Cloud Build CI/CD), et un périmètre de service `PERIMETER_TYPE_REGULAR` restreignant Cloud Run, Cloud SQL, Secret Manager, Cloud Storage, Artifact Registry, Cloud Build, KMS, Pub/Sub, Redis, Filestore, Firestore, IAP, Certificate Manager et Compute. Il s'agit principalement d'un contrôle de **prévention de l'exfiltration de données** — il bloque l'accès aux API depuis l'extérieur du périmètre, quelles que soient les permissions IAM. Ignoré automatiquement avec un avertissement lorsque le projet n'a pas d'organisation (autonome), lorsqu'il est imbriqué dans un dossier sans `organization_id` explicite, ou lorsque `admin_ip_ranges` est vide (protection contre le verrouillage). Les noms de périmètre et de niveau d'accès sont suffixés par `deployment_id` pour éviter les collisions entre les déploiements. |
| `vpc_sc_dry_run` | `true` | `true` / `false` | Lorsque `true`, les violations de périmètre sont enregistrées mais **non appliquées** — recommandé pour le déploiement initial de chaque déploiement. Validez que le log de simulation est exempt d'appels refusés avant de passer à `false` pour activer l'application. Revenir à `true` désactive l'application sans supprimer le périmètre. N'est efficace que lorsque `enable_vpc_sc = true`. |
| `vpc_cidr_ranges` | `[]` | Liste de chaînes CIDR | Plages CIDR de sous-réseaux VPC explicites à inclure dans le niveau d'accès du réseau VPC. Lorsqu'il est vide (par défaut), le module découvre automatiquement les sous-réseaux du réseau VPC utilisé pour ce déploiement (voir `network_name` dans le Groupe 14) et utilise leurs plages CIDR. Revient à `10.0.0.0/8` si ni une liste explicite ni un réseau auto-découvrable n'est disponible. N'est efficace que lorsque `enable_vpc_sc = true`. |
| `organization_id` | `""` | ID numérique d'organisation GCP (par exemple, `"123456789012"`) | ID d'organisation GCP utilisé pour le parent de la politique Access Context Manager. Découvert automatiquement à partir du projet lorsqu'il se trouve directement sous une organisation. **Doit être défini explicitement lorsque le projet est imbriqué dans un dossier** — l'ID d'organisation ne peut pas être découvert automatiquement pour les projets imbriqués dans des dossiers et `enable_vpc_sc = true` enregistrera un avertissement et ignorera le provisionnement tant qu'il n'est pas fourni. Laissez vide pour les projets sans organisation (autonomes) — VPC-SC n'est pas disponible dans ce cas, quoi qu'il arrive. |
| `enable_audit_logging` | `false` | `true` / `false` | Lorsque `true`, le module active des journaux d'audit Cloud détaillés pour l'ensemble du projet : `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` pour tous les services GCP, plus des remplacements explicites par service pour Secret Manager et Cloud KMS afin de garantir que les accès sensibles sont toujours enregistrés. Équivalent à `Services GCP enable_audit_logging = true`. **Recommandé pour** les environnements sensibles à la conformité (PCI, HIPAA, SOC 2). **Compromis :** Augmente considérablement le volume de stockage de Cloud Logging et les coûts associés — les applications avec un débit de requêtes élevé ou une utilisation intensive de Secret Manager / KMS devraient prévoir un budget pour l'ingestion de logs supplémentaire. Peut être activé/désactivé à tout moment ; n'affecte pas les charges de travail en cours d'exécution. |

> **Note :** `admin_ip_ranges` (Groupe 16) a une **double fonction** : en plus d'exempter les IP de confiance des règles WAF de Cloud Armor, ces mêmes CIDR sont utilisés comme CIDR de niveau d'accès administrateur dans le périmètre VPC-SC lorsque `enable_vpc_sc = true`. Un `admin_ip_ranges` vide entraînera l'omission du provisionnement de `enable_vpc_sc = true` avec un avertissement, afin d'éviter un verrouillage administrateur.

### Exploration dans GCP — Groupe 17 {#exploring-in-gcp--group-17}

**Console Google Cloud :**
- **Périmètre VPC-SC :** Accédez à **Sécurité → Contrôles des services VPC**. Confirmez qu'un périmètre nommé `perimeter_<project_id>_<deployment_id>` existe et que sa liste de **Services restreints** inclut les API utilisées par ce module (Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry, Cloud Build, KMS, Pub/Sub, etc.).
- **Statut de simulation :** Sur la page des détails du périmètre, la bannière **Simulation** indique si le périmètre est en mode journalisation uniquement. Basculez `vpc_sc_dry_run = false` après avoir examiné les journaux pour passer à l'application.
- **Appartenance au périmètre :** Dans les détails du périmètre, confirmez que le projet est listé sous **Projets** et que les quatre niveaux d'accès attendus (`vpc_access_*`, `admin_access_*`, `iap_access_*`, `cicd_access_*`) sont attachés.
- **Journaux d'audit VPC-SC :** Accédez à **Logging → Explorateur de journaux** et filtrez par `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"` pour identifier les appels d'API refusés par le périmètre.
- **Journalisation d'audit du projet :** Lorsque `enable_audit_logging = true`, accédez à **IAM et administration → Journaux d'audit** et confirmez que **Lecture d'administration**, **Lecture de données** et **Écriture de données** sont activés pour les services pertinents.

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

## Isolation dans un projet partagé — Compte dédié et clôture {#isolation-in-a-shared-project--dedicated-account-and-fence}

Les applications qui partagent un projet ont fonctionné avec un compte de service partagé par les locataires (`cloudrun-sa-<tenant>`). Ce compte détient des droits à l'échelle du projet sur chaque secret et chaque bucket, et pour déployer sur n'importe quel service Cloud Run, de sorte que n'importe quelle application pourrait lire les identifiants et les données de n'importe quelle autre application. Deux paramètres donnent à une application sa propre place, sans son propre projet.

| Variable | Valeur par défaut | Ce qu'elle fait |
|---|---|---|
| `dedicated_service_account_id` | `""` | L'application s'exécute avec son propre compte de service, avec uniquement les rôles réseau, client Cloud SQL et journalisation à l'échelle du projet, plus l'accès à ses propres secrets, buckets et jobs. L'application n'a plus *besoin* des droits du compte partagé. |
| `fence_enabled` | `false` | Empêche tous les autres d'*avoir* ces droits sur ce que l'application possède (`fence.tf`). Nécessite un compte dédié. |
| `fence_administrators` | `[]` | Personnes (adresses e-mail) qui peuvent toujours atteindre les ressources clôturées de l'application : quiconque la déploie, et les administrateurs "break-glass". |
| `fence_secret_ids` | `[]` | Secrets que le module appelant crée pour l'application au-delà de son mot de passe de base de données. Ne jamais lister un secret qu'une autre application lit également. |

**Ce que fait la clôture :**

1.  **Marque ce que l'application possède.** Une clé de tag limitée au projet, `fence-<service>` = `fenced`, est liée à :
    -   le service Cloud Run de l'application et chacun de ses jobs ;
    -   ses buckets, et à travers eux leurs objets ;
    -   son secret de mot de passe de base de données et `fence_secret_ids`.
2.  **Ajoute une politique de refus IAM** nommée `fence-<service>` au projet. Sur tout ce qui porte ce tag, personne d'autre que le compte dédié de l'application et `fence_administrators` ne peut :
    -   lire ou modifier un secret ;
    -   lire ou écrire un objet ;
    -   signer avec une clé ;
    -   mettre à jour, exécuter ou rediriger le service ou ses jobs.

    Le refus l'emporte sur toutes les autorisations, y compris les autorisations à l'échelle du projet.

**Ressources qu'un module appelant possède.** Si le module appelant crée d'autres ressources pour l'application (un trousseau de clés KMS, par exemple), liez la sortie `fence_tag_value` à celles-ci une fois qu'elles existent, avec `google_tags_location_tag_binding`. RadFarm_CloudRun le fait pour son trousseau de clés de signature dans `console.tf`.

**L'adopter, une application à la fois :**

1.  Définissez `dedicated_service_account_id`, appliquez, et vérifiez que l'application fonctionne toujours. Chaque job et planificateur doit s'exécuter avec le compte dédié : `gcloud run jobs describe` le montre.
2.  Définissez `fence_enabled = true` et `fence_administrators = ["you@example.com"]`, puis appliquez. Le déployeur a besoin de `roles/resourcemanager.tagAdmin` et `roles/iam.denyAdmin` sur le projet.
3.  Testez depuis l'extérieur de la clôture. En usurpant l'identité du compte partagé, la lecture d'un des secrets de l'application doit échouer avec `PERMISSION_DENIED`.

**Ce qu'aucune application seule ne peut clôturer :** un identifiant partagé par plusieurs applications.
-   **Le mot de passe root de l'instance Cloud SQL partagée**, que les jobs de base de données de chaque application utilisent.
-   **Les secrets lus par plusieurs applications**, tels qu'un mot de passe SMTP.

Ceux-ci restent en dehors de toute clôture jusqu'à ce que chaque application n'en ait plus besoin. Pour la base de données, cela signifie que les jobs de schéma de chaque application s'exécutent en tant que propriétaire de sa propre base de données plutôt qu'en tant que `root`.

## Prérequis de déploiement et analyse des dépendances {#deployment-prerequisites--dependency-analysis}

Cette section résume toutes les dépendances externes pour le déploiement de `App CloudRun`. Les dépendances sont regroupées par mode de défaillance pour vous aider à identifier ce qui doit être en place avant le déploiement, ce qui ne fonctionnera pas silencieusement et ce qui nécessite une action manuelle après le déploiement.

> **Notation :** *Auto-provisionné* signifie que le module (ou sa bibliothèque `App Common`) crée la ressource automatiquement lors du premier déploiement — aucun prérequis manuel n'est requis.

---

### Niveau 1 — Prérequis stricts {#tier-1--hard-prerequisites}

Ces configurations empêcheront le déploiement de réussir, ou empêcheront le service Cloud Run d'atteindre un état sain, si le prérequis listé n'est pas satisfait.

| Fonctionnalité | Variable(s) | Exigence |
|---|---|---|
| **Références Secret Manager** | `secret_environment_variables` | Chaque secret nommé dans la carte doit exister dans Secret Manager **avant le déploiement**. Créez d'abord le secret dans Secret Manager, puis déployez. |
| **Scripts SQL personnalisés** | `enable_custom_sql_scripts = true` | Le bucket GCS spécifié dans `custom_sql_scripts_bucket` doit exister et tous les fichiers `.sql` doivent être téléchargés vers `custom_sql_scripts_path` avant le déploiement. Le propre bucket d'application du module peut servir de bucket de scripts, mais les fichiers de script doivent y être placés manuellement avant le premier déploiement. |
| **Importation de sauvegarde de base de données** | `enable_backup_import = true` | Le fichier de sauvegarde nommé dans `backup_file` doit exister à la source configurée — soit le bucket de sauvegarde GCS du module, soit un emplacement Google Drive — avant le déploiement. Un fichier manquant entraîne l'échec immédiat du job Cloud Run d'importation après son déclenchement. |
| **Pipeline CI/CD** | `enable_cicd_trigger = true` | Un dépôt GitHub doit être accessible et soit un jeton d'accès personnel GitHub (scopes : `repo` et `admin:repo_hook`), soit un ID d'installation d'application GitHub doit être fourni. Sans identifiants valides, la connexion GitHub de Cloud Build ne peut pas être établie et le déploiement échouera. |
| **Build de conteneur personnalisé** | `container_image_source = "custom"` | Nécessite la même connexion et les mêmes identifiants de dépôt GitHub que `enable_cicd_trigger`. Cloud Build échouera pendant le déploiement si le dépôt est inaccessible ou si les identifiants sont absents. |
| **Contrôles des services VPC (projets imbriqués dans des dossiers)** | `enable_vpc_sc = true` + projet imbriqué dans un dossier | L'ID d'organisation du projet ne peut pas être découvert automatiquement lorsque le projet se trouve sous un dossier plutôt que directement sous une organisation. `organization_id` doit être fourni explicitement ou le périmètre est ignoré avec un avertissement. Pour les projets directement sous une organisation ou pour les projets autonomes, ce prérequis ne s'applique pas — voir §17 pour la matrice complète d'auto-saut. |
| **Contrôles des services VPC (protection contre le verrouillage administrateur)** | `enable_vpc_sc = true` | `admin_ip_ranges` doit contenir au moins une plage CIDR avant la création du périmètre. Une liste vide entraîne l'ignorance du périmètre avec un avertissement, afin d'éviter un scénario de verrouillage administrateur où aucune identité en dehors du VPC ne peut atteindre les API. |

---

### Niveau 2 — Échecs silencieux {#tier-2--silent-failures}

Ces configurations se déploient avec succès mais ne fonctionneront pas correctement à l'exécution. Il n'y a pas d'erreur immédiate pour indiquer le problème.

| Fonctionnalité | Variable(s) | Mode de défaillance | Résolution |
|---|---|---|---|
| **Cache Redis** | `enable_redis = true` + `redis_host` explicite | Les variables d'environnement `REDIS_HOST` et `REDIS_PORT` sont injectées dans le conteneur, mais l'application ne peut pas se connecter si aucun service Redis n'existe à l'adresse spécifiée. Le déploiement lui-même réussira sans erreur. | Provisionnez une instance Cloud Memorystore ou une VM Redis et définissez `redis_host` sur son IP privée — le module ne découvre **pas** Memorystore. Laisser `redis_host` vide ne fonctionne que si une VM GCE NFS `Services GCP` existe (elle co-héberge Redis) ; une instance Memorystore ou Filestore gérée n'est jamais découverte. |
| **Rotation des secrets** | `secret_rotation_period` | La notification de rotation Pub/Sub est planifiée et se déclenche à l'intervalle configuré, mais **aucune valeur de secret n'est réellement tournée**. La notification n'est qu'un déclencheur — le gestionnaire qui génère une nouvelle valeur et met à jour le secret doit être implémenté séparément. | Utilisez `enable_auto_password_rotation = true` pour le mot de passe de la base de données (géré automatiquement par ce module), ou déployez une fonction Cloud séparée ou un job Cloud Run qui s'abonne au sujet Pub/Sub de rotation. |

---

### Niveau 3 — Prérequis souples {#tier-3--soft-prerequisites}

Ces fonctionnalités se déploient avec succès mais nécessitent une étape manuelle avant d'être pleinement opérationnelles.

| Fonctionnalité | Variable(s) | Action requise |
|---|---|---|
| **Domaine personnalisé** | `application_domains` (avec `enable_cloud_armor = true`) | Après le déploiement, créez des **enregistrements DNS A** pour chaque domaine pointant vers l'adresse IP externe de l'équilibreur de charge (affichée dans les sorties de déploiement). Le provisionnement du certificat SSL géré par Google commence automatiquement après la propagation DNS et se termine généralement en 10 à 60 minutes. L'application ne sera pas accessible sur le domaine personnalisé tant que le certificat n'aura pas atteint le statut `ACTIVE`. |
| **Proxy d'authentification (Identity-Aware Proxy)** | `enable_iap = true` | Le projet doit déjà avoir une marque OAuth IAP (écran de consentement). Une sonde au moment de la planification (`data.external.iap_brand_probe`, soutenue par `scripts/check-iap-brand.sh`) échoue la **planification** lorsque le projet n'a pas de marque, car l'activation de l'IAP détruit la liaison `allUsers`/`run.invoker` du service dans la même application et un échec ultérieur laisserait le service accessible à personne. Créez-en une d'abord avec `gcloud iap oauth-brands create --application_title=... --support_email=...`. La sonde renvoie `unknown` et est autorisée à passer lorsqu'elle ne peut pas déterminer la réponse (pas de gcloud, pas de permission, API désactivée). |
| **Préparation du fichier de sauvegarde** | `enable_backup_import = true` | Le fichier de sauvegarde doit être téléchargé vers le bucket de sauvegarde GCS (ou Google Drive) **avant** le déploiement qui active cet indicateur. |

---

### Auparavant manuel — Maintenant auto-provisionné {#previously-manual--now-self-provisioned}

Les éléments suivants étaient documentés comme des prérequis stricts dans les versions antérieures de ce module. Ils sont maintenant gérés automatiquement et ne nécessitent aucune ressource préexistante.

| Fonctionnalité | Variable(s) | Comment c'est géré maintenant |
|---|---|---|
| **Attestateur, politique et clé KMS d'autorisation binaire** | `enable_binary_authorization = true` | `App_Common/modules/app_security` crée de manière idempotente le trousseau de clés de signature KMS (`${project_id}-binauthz-keyring`), la clé `binauthz-signer`, la note d'analyse de conteneur `pipeline-attestor`, l'attestateur et la politique d'autorisation binaire via des scripts shell. Si `Services_GCP` a provisionné ces ressources en premier, les scripts détectent leur existence et ignorent la création. La signature d'image s'exécute automatiquement après chaque build. |
| **Trousseau de clés CMEK pour le chiffrement du stockage** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` crée de manière idempotente le trousseau de clés KMS `${project_id}-cmek-keyring` et sa clé de chiffrement `storage-key` avant l'application de la liaison IAM de stockage. Il est maintenant sûr de définir `manage_storage_kms_iam = true` lors du premier déploiement sans aucune ressource KMS préexistante. Si `Services_GCP` est déployé avec `enable_cmek = true`, les deux modules ciblent le même nom de trousseau de clés bien connu — celui qui s'exécute en premier le crée ; le second est une opération nulle. La liaison KMS de l'agent de service GCS est réaffirmée de manière proactive par `assert_gcs_kms_binding.sh` — cela résout le problème de l'œuf et de la poule où une liaison décalée causait auparavant des erreurs "Permission denied on Cloud KMS key" pendant le déploiement et bloquait l'opération même qui la restaurerait. |
| **Agent de service PSA pour Cloud SQL intégré** | Cloud SQL intégré (`database_type != "NONE"`, pas de VPC `Services GCP`) | GCP accorde automatiquement `roles/servicenetworking.serviceAgent` lorsque `servicenetworking.googleapis.com` est activé, mais l'octroi est asynchrone et peut prendre du retard par rapport à l'attente de 60 s d'activation de l'API sur les nouveaux projets (y compris Qwiklabs). Le module provisionne maintenant explicitement `google_project_service_identity.servicenetworking_sa` et accorde `google_project_iam_member.servicenetworking_service_agent` avant de créer la connexion PSA, de sorte que l'appel interne `compute.globalAddresses.list` de l'API Service Networking n'est jamais bloqué par une liaison IAM manquante. |
| **Périmètre, politique d'accès et niveaux d'accès des contrôles des services VPC** | `enable_vpc_sc = true` | `App_Common/modules/app_vpc_sc` découvre automatiquement l'ID d'organisation, réutilise toute politique Access Context Manager existante (ou en crée une nouvelle), provisionne quatre niveaux d'accès par déploiement (VPC, IP d'administration, IAP, CI/CD) et crée un périmètre de service `PERIMETER_TYPE_REGULAR` couvrant toutes les API GCP que ce module touche. Par défaut à `vpc_sc_dry_run = true` afin que les violations ne soient que journalisées jusqu'à ce que vous validiez et passiez à l'application. Ignoré automatiquement avec un avertissement clair pour les projets autonomes, les projets imbriqués dans des dossiers sans `organization_id` et les déploiements sans `admin_ip_ranges`. |

---

### Dépendance à `Services GCP` pour les ressources partagées {#dependency-on-services-gcp-for-shared-resources}

`Services GCP` est déclaré comme une dépendance de module (dépendance à `Services GCP`) mais n'est **pas requis** pour un déploiement autonome. Le module auto-provisionne toute l'infrastructure nécessaire en ligne lorsque `Services GCP` n'a pas été déployé. Cependant, le déploiement de `Services GCP` en premier est fortement recommandé lorsque plusieurs modules d'application partagent le même projet GCP — il centralise l'infrastructure partagée, réduit les coûts par déploiement et simplifie la gestion continue.

| Ressource | Sans `Services GCP` | Avec `Services GCP` |
|---|---|---|
| **Réseau VPC** | Le module auto-provisionne un VPC, un sous-réseau, un Cloud NAT et un Cloud Router intégrés. Les instances Cloud SQL intégrées rejoignent le VPC via Private Service Access (PSA). | Le module se connecte au VPC partagé géré de manière centralisée. Évite la consommation de quotas VPC et d'adresses IP par projet ; simplifie la gestion des pare-feu sur tous les déploiements. Aucun VPC intégré et aucune instance Cloud SQL intégrée ne sont créés dans ce mode — voir la note sous le tableau. |
| **Instance Cloud SQL** | Le module auto-provisionne une instance Cloud SQL dédiée par déploiement. Chaque déploiement entraîne le coût total de l'instance. | Le module découvre automatiquement et se connecte à l'instance Cloud SQL partagée, ne provisionnant qu'une base de données et un utilisateur séparés à l'intérieur. Élimine le coût d'instance par déploiement pour les projets avec plusieurs déploiements d'applications. |
| **NFS / Filestore** | Le module auto-provisionne une VM GCE NFS intégrée lorsque `enable_nfs = true`. La VM est un point de défaillance unique sans sauvegardes gérées. | Le module découvre automatiquement l'instance Filestore gérée de manière centralisée. Fournit un NFS de qualité entreprise avec un débit garanti et des instantanés gérés. |
| **Redis / Memorystore** | `enable_redis = true` avec un `redis_host` vide revient à l'adresse IP de la VM NFS — ne fonctionne que si un service compatible Redis est co-localisé sur cette VM. Un `redis_host` explicite doit être défini pour se connecter à toute instance Redis dédiée. | Le module découvre automatiquement l'instance Memorystore partagée. `redis_host` peut être laissé vide. |
| **Artifact Registry** | Le module crée automatiquement un dépôt Artifact Registry par déploiement. | Le module découvre automatiquement et utilise le registre partagé, permettant la réutilisation d'images et des politiques d'analyse de vulnérabilités cohérentes sur tous les déploiements. |
| **Autorisation binaire** | `app_security` auto-provisionne l'attestateur, la clé KMS et la politique automatiquement (voir ci-dessus). | `Services GCP` (avec `enable_binary_authorization = true`) provisionne les mêmes ressources de manière centralisée avec `binauthz_evaluation_mode` configurable (`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`). Recommandé pour les environnements de production nécessitant l'application de l'attestation. |
| **Chiffrement CMEK** | `app_cmek` auto-provisionne le `${project_id}-cmek-keyring` et le `storage-key` automatiquement (voir ci-dessus). | `Services GCP` (avec `enable_cmek = true`) provisionne le trousseau de clés avec une période de rotation configurable et applique CMEK sur Cloud SQL, Artifact Registry et d'autres ressources partagées simultanément, fournissant une base de chiffrement cohérente sur toute l'infrastructure partagée. |
| **Périmètre des contrôles des services VPC** | `app_vpc_sc` auto-provisionne la politique d'accès, quatre niveaux d'accès et le périmètre `PERIMETER_TYPE_REGULAR` limité à ce déploiement (suffixé par `deployment_id`) — voir ci-dessus. | `Services GCP` peut héberger un périmètre partagé unique sur tous les déploiements du projet, fournissant des règles d'entrée/sortie cohérentes et une application plus simple. Recommandé pour les organisations qui gèrent déjà VPC-SC de manière centralisée ; sinon, le périmètre auto-provisionné par déploiement est suffisant. |
| **Journalisation d'audit du projet** | `enable_audit_logging = true` configure `google_project_iam_audit_config` pour `allServices` plus les remplacements Secret Manager et KMS. Ne nécessite aucune infrastructure supplémentaire. | `Services GCP` (avec `enable_audit_logging = true`) provisionne les mêmes configurations d'audit une fois au niveau du projet — recommandé lorsque plusieurs déploiements partagent le projet, pour éviter les ressources de configuration d'audit IAM dupliquées. |

> **Les deux colonnes sont mutuellement exclusives, pas un repli par ressource.** Le comportement "Sans `Services GCP`" s'applique uniquement lorsqu'aucun réseau VPC n'est découvert. Sur le chemin par défaut (`network_name = ""`), la découverte correspond spécifiquement à un réseau géré par `Services GCP`, de sorte que "aucun réseau trouvé" et "aucun déploiement `Services GCP`" coïncident. Définir `network_name` explicitement sur n'importe quel VPC existant satisfait également la vérification du réseau, mais cela ne vous donne **pas** la colonne "Avec" : les replis intégrés sont supprimés tandis que la découverte de Cloud SQL, NFS et du registre ne trouve toujours rien (Cloud SQL et NFS filtrent sur `managed-by=services-gcp` ; la découverte du registre filtre sur `labels.module=services-gcp`, revenant à une correspondance de nom `shared-repo-` sans filtre d'étiquette), donc sur les valeurs par défaut (`database_type = "POSTGRES"`, `enable_nfs = true`), les préconditions ci-dessous échouent le plan. Chaque garde est conditionnelle, de sorte qu'un déploiement n'ayant besoin d'aucune de ces ressources — pas de base de données, pas de NFS, une image pré-construite, pas de CI/CD — n'en déclenche aucune et s'applique à un VPC arbitraire. Une fois ce réseau trouvé, ce module ne créera jamais d'instance Postgres, d'instance MySQL, de VM NFS ou de dépôt Artifact Registry intégrés, même si `Services GCP` a été déployé sans cette ressource particulière. Chacune de ces ressources intégrées partagerait le nom exact préfixé par le locataire de `Services GCP`, de sorte qu'un repli silencieux par ressource risque une collision de destruction ultérieure dans laquelle l'application de ce module supprime la ressource partagée que `Services GCP` suit toujours dans son propre état. Au lieu de cela, quatre préconditions échouent le **plan** avec un message explicite vous indiquant de redéployer `Services GCP` avec la ressource manquante activée (`create_postgres`, `create_mysql`, `create_network_filesystem`, ou un registre partagé découvrable). Définissez `requires_services` (Groupe 0) afin que la plateforme active les bons commutateurs `create_*` lorsqu'elle auto-provisionne `Services GCP` pour vous.

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

> **De nombreuses combinaisons invalides sont détectées au moment du plan.** Le module contient 29 préconditions inter-variables (`validation.tf`) ainsi que des blocs `validation` par variable, de sorte qu'une grande catégorie de mauvaises configurations échoue au **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée. Les lignes ci-dessous marquées **🛡 plan-time** sont rejetées d'emblée — vous n'atteignez jamais la conséquence décrite. Les lignes non marquées sont des risques *d'exécution* ou *opérationnels* (un mauvais port, une sauvegarde obsolète laissée activée, un renommage destructeur) que le module ne peut pas décider en toute sécurité pour vous — ils restent votre responsabilité. Un plan propre confirme que les règles de valeur/combinaison ont été respectées ; il ne valide pas qu'un port corresponde à votre application ou qu'un renommage soit intentionnel.

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `container_image_source` + `container_image` | `"custom"` (build à partir de la source), ou `"prebuilt"` **avec** un `container_image` non vide | **Élevé** 🛡 plan-time | `"prebuilt"` avec un `container_image` vide n'a pas d'URI d'image à déployer — maintenant rejeté au moment du plan. |
| `enable_cdn` + `enable_cloud_armor` | Activer le CDN uniquement avec Cloud Armor | **Moyen** 🛡 plan-time | `enable_cdn = true` avec `enable_cloud_armor = false` n'a pas de load balancer auquel attacher le CDN — le paramètre était silencieusement ignoré ; maintenant rejeté au moment du plan. |
| `cicd_enable_cloud_deploy` + `enable_cloud_deploy` | Définir les deux ensemble, ou aucun | **Moyen** 🛡 plan-time | Acheminer les builds CI/CD via Cloud Deploy sans `enable_cloud_deploy = true` laisse le build sans pipeline de livraison pour le déploiement — maintenant rejeté au moment du plan. |
| `mount_nfs` (jobs/sidecars) + `enable_nfs` | Activer NFS lorsqu'un job ou un sidecar le monte | **Élevé** 🛡 plan-time | Un job/sidecar avec `mount_nfs = true` alors que `enable_nfs = false` (et aucun serveur NFS détectable) référence un volume qui n'existe pas — maintenant rejeté au moment du plan. |
| `enable_postgres_extensions` / `enable_mysql_plugins` + `database_type` | Faire correspondre le commutateur à la famille de moteurs | **Moyen** 🛡 plan-time | L'activation des extensions Postgres sur un moteur MySQL (ou vice-versa) est rejetée au moment du plan. *(Défaut corrigé : les listes d'autorisation incluent maintenant correctement `POSTGRES_15` et `MYSQL_8_0`, qui étaient auparavant rejetées par erreur.)* |
| `application_name` | Court, en minuscules, sans trait d'union (par exemple `"myapp"`, `"payments-api"`) | **Critique** | Intégré dans chaque nom de ressource GCP (service Cloud Run, secrets, instance SQL, buckets GCS). **Ne jamais modifier après le premier déploiement** — toutes les ressources nommées sont détruites et recréées, entraînant une perte complète de données et une nouvelle base de données vide. |
| `tenant_id` | Correspondre à l'environnement : `"prod"`, `"staging"`, `"dev"` | **Critique** | Intégré dans tous les noms de ressources avec `application_name`. **Ne jamais modifier après le premier déploiement** — même conséquence que la modification de `application_name` : recréation complète des ressources et perte de données. |
| `enable_cloudsql_volume` | `true` (injecter le sidecar Cloud SQL Auth Proxy — le chemin sécurisé) | **Élevé** | La valeur par défaut est `true` — correcte pour les applications qui utilisent Cloud SQL. **Définir sur `false` pour les applications qui n'utilisent pas Cloud SQL** (par exemple, les services sans état ou les applications avec une base de données externe) : le laisser à `true` injecte un conteneur sidecar inutilisé, augmentant le temps de démarrage à froid et la consommation de ressources. La définition de `false` lorsque Cloud SQL est nécessaire exige que les applications atteignent directement l'IP privée — les règles de pare-feu doivent le permettre et l'authentification IAM est perdue. |
| `container_port` | Doit correspondre exactement à ce que le serveur d'applications lie (par exemple `8080`, `3000`, `5000`) | **Critique** | Inadéquation de port : la sonde de démarrage Cloud Run échoue immédiatement sur chaque instance. Toutes les requêtes renvoient HTTP 502. Le service ne devient jamais sain et redémarre continuellement. |
| `execution_environment` | `"gen2"` (toujours ; requis pour les montages NFS et GCS Fuse) | **Élevé** 🛡 plan-time | `"gen1"` avec `enable_nfs = true` ou `gcs_volumes` configuré est rejeté au moment du plan (gen1 ne prend pas en charge les montages NFS/GCS Fuse), plutôt que d'échouer silencieusement le montage de volume au démarrage du conteneur. |
| `ingress_settings` | `"internal-and-cloud-load-balancing"` lorsque `enable_cloud_armor = true` ; `"all"` pour les services publics sans load balancer | **Élevé** | `"all"` avec `enable_cloud_armor = true` : l'URL `*.run.app` de Cloud Run reste accessible publiquement, contournant complètement le load balancer et le WAF Cloud Armor. Les attaquants peuvent atteindre l'application directement, rendant l'investissement WAF inutile. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` pour les applications n'ayant besoin que de ressources VPC privées ; `"ALL_TRAFFIC"` pour les applications appelant des API externes via Cloud NAT | **Élevé** | `"PRIVATE_RANGES_ONLY"` bloque tout le trafic sortant vers les IP publiques, y compris Redis externe, les API tierces et les webhooks SaaS. Les applications qui appellent des services externes doivent définir `"ALL_TRAFFIC"`. Symptôme : délais d'attente de connexion silencieux vers tout ce qui est en dehors de RFC 1918. |
| `enable_iap` + `iap_authorized_users` / `iap_authorized_groups` | Définir `enable_iap = true` seulement après avoir rempli au moins un utilisateur ou un groupe | **Critique** 🛡 plan-time | `enable_iap = true` avec les deux listes vides bloquerait tout le monde (100 % HTTP 403, y compris vous) — maintenant rejeté au moment du plan, vous ne pouvez donc pas déployer un service inaccessible. Ajoutez au moins votre propre e-mail à `iap_authorized_users`. |
| `enable_cloud_armor` + `ingress_settings` | Toujours associer `enable_cloud_armor = true` à `ingress_settings = "internal-and-cloud-load-balancing"` | **Élevé** | `enable_cloud_armor = true` avec `ingress_settings = "all"` : Cloud Armor protège le chemin du load balancer, mais l'URL `*.run.app` le contourne entièrement. Les clients qui découvrent l'URL directe échappent à toutes les règles WAF et aux limites de débit. |
| `min_instance_count` | `1` pour les applications de production sensibles à la latence ou avec état ; `0` pour le développement/batch | **Élevé** | `0` pour les applications avec état (bases de données, sessions persistantes) : lors de la mise à l'échelle à zéro, tout état en mémoire ou sur disque local est perdu lorsque l'instance s'arrête. Lors de la prochaine requête, la nouvelle instance démarre à froid sans état antérieur. Risque de perte de données ou d'état de session corrompu. |
| `enable_backup_import` | `false` (par défaut) — définir `true` uniquement lorsque vous souhaitez restaurer | **Critique** | Laisser `enable_backup_import = true` après une restauration réussie : le job d'importation se réexécute à chaque déploiement ultérieur, écrasant la base de données en direct avec le fichier de sauvegarde obsolète. **Toujours remettre à `false` immédiatement après une restauration réussie.** |
| `backup_file` | Doit correspondre exactement au nom de fichier présent dans la source de sauvegarde (y compris l'extension) | **Élevé** | Inadéquation de nom de fichier : le job d'importation Cloud Run échoue immédiatement avec une erreur "fichier non trouvé". Aucune donnée n'est importée mais l'apply du déploiement réussit — l'échec n'est visible que dans les logs d'exécution du job. |
| `secret_rotation_period` | `"2592000s"` (30 jours) — doit inclure le suffixe `s` | **Élevé** 🛡 plan-time | L'omission du suffixe `s` (par exemple `"2592000"`) est rejetée au moment du plan par la validation du format de la variable, plutôt que d'être acceptée et de ne pas enregistrer silencieusement la notification de rotation. |
| `enable_auto_password_rotation` + `rotation_propagation_delay_sec` | Activer uniquement après avoir validé le pipeline de rotation ; maintenir `rotation_propagation_delay_sec` ≥ `90` | **Élevé** | `rotation_propagation_delay_sec` trop court (par exemple `10`) : l'ancienne version du mot de passe de la base de données est désactivée avant que tous les pods en cours d'exécution n'aient redémarré avec la nouvelle credential. L'épuisement du pool de connexions provoque des erreurs HTTP 500 jusqu'à ce que tous les pods terminent un cycle de redémarrage complet. |
| `enable_binary_authorization` + `binauthz_evaluation_mode` | Commencer par `"ALWAYS_ALLOW"` ; promouvoir à `"REQUIRE_ATTESTATION"` seulement après que le pipeline CI produise des attestations valides | **Critique** | `"REQUIRE_ATTESTATION"` sans pipeline CI qui atteste les images : **toutes les nouvelles révisions échouent à se déployer** avec `Image is not attested`. Les retours arrière sont également bloqués. `"ALWAYS_DENY"` bloque immédiatement tous les déploiements, y compris les correctifs d'urgence. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | Toujours activer avec `vpc_sc_dry_run = true` d'abord ; examiner les logs d'audit avant d'appliquer | **Critique** | `vpc_sc_dry_run = false` lors de la première activation : tout principal, IP ou service non explicitement dans le niveau d'accès est bloqué immédiatement. Le compte de service Cloud Build, le compte de service Cloud Run et votre IP d'administration doivent tous être dans un niveau d'accès avant d'appliquer — sinon Cloud Build, les déploiements et l'application en cours d'exécution échouent simultanément. |
| `organization_id` | Requis pour les projets imbriqués dans des dossiers lorsque `enable_vpc_sc = true` | **Élevé** | Projet imbriqué dans un dossier sans `organization_id` : le périmètre VPC-SC est silencieusement ignoré avec un avertissement. Aucune erreur n'est levée, mais aucun périmètre n'est créé — le contrôle de sécurité que vous aviez l'intention d'appliquer est absent. |
| `cloud_deploy_stages` étape de production | `require_approval = true` sur l'étape de production | **Critique** | `require_approval = false` combiné avec `auto_promote = true` sur l'étape de production : un déploiement de staging réussi promeut automatiquement en production sans aucune révision humaine. Un build cassé ou une mauvaise migration atteint la production automatiquement. |
| `enable_image_mirroring` | `true` (par défaut ; fortement recommandé) | **Élevé** | `false` : Cloud Run tire les images directement des registres externes (Docker Hub, GHCR). Soumis aux limites de débit de pull (HTTP 429 pendant les déploiements). Dans les environnements VPC-SC, l'accès au registre externe est bloqué — les nouvelles révisions échouent avec `ImagePullBackOff` et le service ne peut pas être mis à jour. |
| `database_type` | Valeur épinglée à la version pour la production (par exemple `"POSTGRES_15"`) plutôt que générique `"POSTGRES"` | **Critique** | **La modification de `database_type` après le premier déploiement remplace l'instance Cloud SQL** — toutes les données de la base de données existante sont détruites. Ne jamais modifier cela après le premier apply sans une sauvegarde validée et un plan de restauration testé. |
| `application_database_name` | Minuscules, lié à l'application (par exemple `"myappdb"`) — ne jamais modifier après le premier déploiement | **Critique** | La modification crée une nouvelle base de données vide avec le nouveau nom ; la base de données originale avec toutes les données est orpheline sur l'instance. L'application démarre avec un schéma vide et échoue à chaque appel de base de données. |
| `storage_buckets[].force_destroy` | `false` pour les buckets de production contenant des données utilisateur | **Critique** | `true` sur un bucket de production : la suppression du déploiement supprime définitivement tout le contenu du bucket sans récupération. `false` sur un bucket temporaire qui doit être supprimé : la suppression du déploiement échoue jusqu'à ce que le bucket soit vidé manuellement. |
| `startup_probe_config.path` | Un endpoint rapide et léger qui renvoie HTTP 200 lorsque l'application est prête (par exemple `"/healthz"`) | **Critique** | Mauvais chemin (renvoie 404 ou 500) : Cloud Run ne considère jamais l'instance saine et ne lui achemine jamais le trafic. L'instance est continuellement redémarrée. Le service est hors ligne pour tous les utilisateurs. |
| `enable_redis` | `false` pour les applications qui n'utilisent pas Redis | **Moyen** | Laissé à la valeur par défaut `true` pour une application sans Redis : `REDIS_HOST` par défaut à l'IP du serveur NFS. Si aucun service compatible Redis n'y est exécuté, l'application enregistre des erreurs de connexion à chaque démarrage. Définir `false` explicitement pour les applications qui n'utilisent pas Redis. |
| `max_revisions_to_retain` | `7` (par défaut) — suffisant pour la plupart des besoins de retour arrière | **Faible** | `0` : toutes les anciennes révisions sont immédiatement purgées. Le retour arrière à toute révision antérieure est impossible — seule la révision actuellement en service est conservée. Trop élevé (par exemple `100`) : le quota de l'API de liste de révisions Cloud Run est consommé plus rapidement et la console est difficile à naviguer. |
| `secret_propagation_delay` | `30` secondes (par défaut) ; augmenter à `60`–`90` pour les déploiements multi-régions | **Moyen** | Trop court dans les configurations multi-régions : une nouvelle révision Cloud Run démarre avant que la nouvelle version du secret ne se soit répliquée globalement. L'instance lit l'ancienne credential (potentiellement juste tournée) et échoue à s'authentifier. Augmenter si vous voyez des erreurs intermittentes de secret non trouvé sur les nouveaux déploiements. |

---

## Sorties {#outputs}

Le module expose les sorties suivantes après un déploiement réussi.

### Informations sur le service {#service-information}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run |
| `service_url` | URL HTTPS du service Cloud Run (URL `.run.app`) |
| `service_location` | Région GCP où le service Cloud Run est déployé |
| `stage_services` | Carte nom d'étape → `{ name, uri }` pour les déploiements multi-étapes Cloud Deploy ; carte vide lorsque `enable_cloud_deploy` est `false` |

### Équilibreur de charge {#load-balancer}

| Sortie | Description |
|---|---|
| `load_balancer_ip` | Adresse IP externe statique de l'équilibreur de charge HTTPS ; `null` lorsque `enable_cloud_armor` est `false` |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge ; utilise un domaine de développement `nip.io` lorsqu'aucun domaine personnalisé n'est défini ; `null` lorsqu'aucun équilibreur de charge n'existe |

### Base de données {#database}

| Sortie | Description |
|---|---|
| `database_instance_name` | Nom de l'instance Cloud SQL ; `null` lorsque `database_type = "NONE"` |
| `database_name` | Nom de la base de données de l'application dans l'instance |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `database_host` | IP interne de l'instance Cloud SQL *(sensible)* |
| `database_port` | Port sur lequel la base de données écoute |

### Stockage {#storage}

| Sortie | Description |
|---|---|
| `storage_buckets` | Carte nom logique du bucket → nom du bucket pour tous les buckets GCS provisionnés ; carte vide lorsque `create_cloud_storage` est `false` |

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
| `nfs_instance_tags` | Tags réseau séparés par des virgules de la VM GCE NFS ; vide pour les instances Filestore |
| `nfs_mount_path` | Chemin du système de fichiers du conteneur où le volume NFS est monté |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS |

### Conteneur et registre {#container--registry}

| Sortie | Description |
|---|---|
| `container_image` | URI d'image de conteneur entièrement qualifié utilisé par le service déployé |
| `container_registry` | Nom du dépôt Artifact Registry ; `null` lorsqu'aucune build personnalisée n'est configurée |

### Surveillance {#monitoring}

| Sortie | Description |
|---|---|
| `monitoring_enabled` | Indique si Cloud Monitoring est configuré (`true`/`false`) |
| `monitoring_notification_channels` | Liste des noms de canaux de notification Cloud Monitoring |
| `uptime_check_names` | Liste des noms de configuration de test de disponibilité ; vide lorsque le test de disponibilité est désactivé ou que le point de terminaison n'est pas accessible publiquement |

### Métadonnées de déploiement {#deployment-metadata}

| Sortie | Description |
|---|---|
| `deployment_id` | Identifiant de déploiement unique (suffixe hexadécimal aléatoire auto-généré) |
| `tenant_id` | Identifiant de locataire dérivé de `tenant_id` |
| `resource_prefix` | Préfixe de nommage appliqué aux ressources GCP dans ce déploiement |
| `project_id` | ID du projet GCP |
| `project_number` | Numéro du projet GCP |

### Jobs {#jobs}

| Sortie | Description |
|---|---|
| `initialization_jobs` | Carte clé du job → nom du job Cloud Run pour tous les jobs d'initialisation provisionnés |
| `nfs_setup_job` | Nom du job Cloud Run pour le job de configuration NFS ; `null` lorsqu'il n'est pas créé |

### CI/CD {#cicd}

| Sortie | Description |
|---|---|
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté à Cloud Build |
| `github_repository_owner` | Propriétaire / organisation du dépôt GitHub |
| `github_repository_name` | Nom du dépôt GitHub |
| `artifact_registry_repository` | Objet contenant `name`, `location` et `url` du dépôt Artifact Registry ; `null` lorsqu'aucune build personnalisée ni CI/CD n'est activée |
| `cloudbuild_trigger_name` | Nom du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` est `false` |
| `cloudbuild_trigger_id` | ID du déclencheur Cloud Build ; `null` lorsque `enable_cicd_trigger` est `false` |
| `cicd_configuration` | Objet avec tous les détails CI/CD (nom/ID du déclencheur, informations du dépôt, modèle de branche, URL du registre, e-mail du compte de service) ; `null` lorsqu'aucun déclencheur n'existe |

### Contrôles de service VPC {#vpc-service-controls}

| Sortie | Description |
|---|---|
| `vpc_sc_enabled` | Indique si le périmètre VPC-SC a été créé avec succès |
| `vpc_sc_perimeter_name` | Nom de la ressource du périmètre de service VPC-SC ; `null` lorsqu'il n'est pas activé |
| `vpc_sc_dry_run_mode` | Indique si VPC-SC est en mode simulation (`true`) ou en mode d'application active (`false`) |
| `audit_logging_enabled` | Indique si les logs d'audit Cloud au niveau du projet sont activés (reflète `enable_audit_logging`) |
| `artifact_registry_cmek_enabled` | Indique si le chiffrement CMEK d'Artifact Registry est configuré (reflète `enable_artifact_registry_cmek`) |
## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération de l'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la suppression d'un déploiement Cloud Run, GCP peut conserver les adresses IPv4 sans serveur sur le sous-réseau VPC pendant 20 à 30 minutes après la suppression du service Cloud Run. Si cela se produit pendant le nettoyage, attendez 20 à 30 minutes et réessayez la suppression. La deuxième tentative réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : App CloudRun](../labs/App_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module App GKE — Guide de configuration](App_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [App Common — Guide de configuration](App_Common.md) — la configuration partagée par les deux cibles de déploiement.
