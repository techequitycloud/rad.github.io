---
title: "Carte des labs de la certification Associate Cloud Engineer (ACE)"
description: "Faites correspondre chaque domaine de l'examen Associate Cloud Engineer (ACE) à des labs de déploiement RAD pratiques sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/ACE_Certification_Guide.md @ cb682e8 -->

# Carte des labs de la certification Associate Cloud Engineer (ACE) {#associate-cloud-engineer-ace-certification-lab-map}

La certification Associate Cloud Engineer atteste que vous savez déployer et sécuriser des applications, des services et de l'infrastructure, surveiller l'exploitation de plusieurs projets et maintenir des solutions d'entreprise sur Google Cloud — en effectuant les tâches courantes de la plateforme, avec l'appui d'outils d'IA, aussi bien depuis la console que depuis la ligne de commande. Les quatre modules de base de la plateforme RAD — `Services_GCP` (réseau VPC mutualisé, Cloud SQL, Redis, Filestore, GKE Autopilot, comptes de service), `App_CloudRun` (moteur de déploiement Cloud Run v2), `App_GKE` (moteur de déploiement GKE) et la bibliothèque partagée `App_Common` (secrets, IAM, stockage, CMEK, plomberie CI/CD) — vous offrent un lab réel et inspectable : chaque option de votre portail de déploiement correspond à de vraies ressources GCP que vous pouvez ensuite explorer avec `gcloud`, `kubectl` et la console. Des modules applicatifs (Django, WordPress, etc.) s'appuient sur ces modules de base, mais ils ne sont pas nécessaires pour préparer l'examen.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement, puis suivez le guide de section correspondant.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** À la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour.
- Chaque sous-section des guides de section comporte un bloc **Essayez** — effectuez les étapes en ligne de commande, pas seulement les clics dans la console. L'examen ACE suppose une bonne maîtrise de `gcloud`/`kubectl`.
- Utilisez la légende de couverture pour savoir quels sujets de l'examen vous devez étudier en dehors de la plateforme ; les guides de section les signalent dans des blocs **Au-delà des modules**.
- ACE est un examen de niveau débutant : concentrez-vous sur la création, l'inspection et la modification des ressources, plutôt que sur les arbitrages d'architecture.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le et modifiez-le sur la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non implémenté par les modules ; pistes d'étude fournies |

**Périmètre de l'examen** — Les tableaux de section ci-dessous suivent le guide officiel actuel de l'examen ACE de Google : Section 1 (~20 %), Section 2 (~30 %), Section 3 (~30 %), Section 4 (~20 %). L'**examen de renouvellement ACE** utilise la même numérotation des objectifs, mais n'évalue que la Section 2 (~40 %), la Section 3 (~40 %) et l'objectif 4.2 Gestion des comptes de service (Managing service accounts) (~20 %) ; la Section 1 et l'objectif 4.1 ne sont pas évalués lors du renouvellement.

## Profils de déploiement {#deployment-profiles}

### Profil : plateforme de base {#profile-baseline-platform}
*Objectif :* la couche d'infrastructure partagée sur laquelle reposent tous les autres profils — VPC, Cloud NAT, Cloud SQL privé, VM NFS/Redis, comptes de service.
*Modules :* `Services_GCP` uniquement.
| Variable | Valeur |
|---|---|
| `project_id` | l'ID de votre projet |
| `tenant_id` | `demo` (par défaut) |
| `create_postgres` | `true` (par défaut) |
| `create_network_filesystem` | `true` (par défaut) |
| `support_users` | votre adresse e-mail |
| `resource_labels` | `{ environment = "dev", cost-center = "lab" }` |

*Coût supplémentaire estimé :* faible à modéré — les principaux postes sont l'instance Cloud SQL `db-custom-1-3840` et la VM NFS `e2-small`, qui tournent 24 h/24 et 7 j/7.

### Profil : application serverless {#profile-serverless-application}
*Objectif :* un service Cloud Run avec base de données, buckets de stockage, montage NFS, révisions et sauvegardes planifiées — couvre l'essentiel des Sections 2 et 3.
*Modules :* plateforme de base + `App_CloudRun`.
| Variable | Valeur |
|---|---|
| `container_image_source` | `prebuilt` |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` |
| `min_instance_count` | `0` (par défaut — mise à l'échelle jusqu'à zéro) |
| `max_instance_count` | `3` |
| `database_type` | `POSTGRES` (par défaut) |
| `storage_buckets` | une entrée, par ex. `[{ name_suffix = "media" }]` |
| `support_users` | votre adresse e-mail |

*Coût supplémentaire estimé :* faible — Cloud Run descend jusqu'à zéro instance ; le coût est dominé par ce que la plateforme de base exécute déjà.

### Profil : application Kubernetes {#profile-kubernetes-application}
*Objectif :* un cluster GKE Autopilot et une charge de travail dans un namespace avec HPA, ResourceQuota, PodDisruptionBudget et NetworkPolicy — la moitié `kubectl` de l'examen.
*Modules :* `Services_GCP` (réappliqué avec GKE activé) + `App_GKE`.
| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `AUTOPILOT` (par défaut) |
| `container_image_source` (App_GKE) | `prebuilt` |
| `container_image` (App_GKE) | `us-docker.pkg.dev/cloudrun/container/hello` |
| `enable_resource_quota` (App_GKE) | `true` |
| `enable_network_segmentation` (App_GKE) | `true` |

*Coût supplémentaire estimé :* modéré — Autopilot facture selon les ressources demandées par chaque pod, plus les frais de gestion du cluster.

### Profil : compléments d'exploitation et de sécurité {#profile-operations--security-add-ons}
*Objectif :* budget de facturation, alertes, journaux d'audit, sécurité en périphérie et IAP pour les Sections 1, 3.4 et 4. À appliquer en plus de l'un ou l'autre des profils applicatifs.
*Modules :* `Services_GCP` + un module applicatif.
| Variable | Valeur |
|---|---|
| `create_billing_budget` (Services_GCP) | `true` |
| `budget_amount` (Services_GCP) | `100` (par défaut) |
| `configure_email_notification` (Services_GCP) | `true` |
| `notification_alert_emails` (Services_GCP) | votre adresse e-mail |
| `enable_audit_logging` (Services_GCP ou module applicatif) | `true` |
| `enable_cloud_armor` (App_CloudRun) | `true` ; ajoutez `application_domains` uniquement si vous voulez votre propre nom d'hôte |
| `enable_iap` + `iap_authorized_users` (App_CloudRun) | `true` + `["user:you@example.com"]` |

*Coût supplémentaire estimé :* modéré — l'équilibreur de charge externe global (règle de transfert + stratégie Cloud Armor) est le principal poste ; la journalisation d'audit augmente le volume Cloud Logging.

## Section 1 : Configuration d'un environnement de solution cloud (Setting up a cloud solution environment) (~20 % de l'examen) {#section-1-setting-up-a-cloud-solution-environment-20-of-the-exam}

Les modules se déploient dans un projet existant, activent automatiquement ~45 API, créent des comptes de service dédiés, construisent le VPC du projet, mettent en place la surveillance et peuvent créer un véritable budget de facturation — mais la création de projets, la hiérarchie des ressources, les règles d'administration, Cloud Identity et l'administration des comptes de facturation restent des exercices à faire dans la console ou avec `gcloud`.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Activation des API dans les projets | ✅ | `enable_services` (par défaut `true`), `additional_apis` | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Attribution de rôles IAM aux membres d'un projet | ✅ | comptes de service dédiés + liaisons de rôles | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Mise en place du réseau cloud | ✅ | VPC en mode personnalisé de `Services_GCP`, sous-réseaux, Cloud NAT (détails en 2.3) | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 1.1 Provisionnement et configuration des produits de Google Cloud Observability | 🟡 | `support_users`, `notification_alert_emails`, tableaux de bord, tests de disponibilité ; aucune configuration de Trace/Profiler | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 1.1 Évaluation des quotas et demandes d'augmentation | 🟡 | `max_instance_count` et les variables similaires consomment des quotas ; aucune gestion des quotas | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Hiérarchie des ressources, règles d'administration, organisations autonomes | 📘 | les modules se déploient uniquement dans un `project_id` existant | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Utilisateurs/groupes Cloud Identity, Workforce Identity Federation | 📘 | non implémenté | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Disponibilité des produits par région/zone ; Cloud Asset Inventory et Gemini Cloud Assist | 📘 | non implémenté | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.2 Définition de budgets et d'alertes de facturation | ✅ | `create_billing_budget`, `budget_amount` (par défaut `100`), `budget_alert_thresholds` | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |
| 1.2 Création de comptes de facturation / association de projets / exports de facturation | 📘 | le compte de facturation est découvert automatiquement, jamais géré | [Guide de la section 1](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |

## Section 2 : Planification et mise en œuvre d'une solution cloud (Planning and implementing a cloud solution) (~30 % de l'examen) {#section-2-planning-and-implementing-a-cloud-solution-30-of-the-exam}

La section la mieux couverte par le lab : les déploiements Cloud Run et GKE sont entièrement démontrés, ainsi que Cloud SQL, GCS, Filestore, Memorystore, un VPC en mode personnalisé, Cloud NAT, des règles de pare-feu VPC et un équilibreur de charge externe global avec Cloud Armor. Compute Engine n'apparaît que sous la forme de la VM NFS autogérée ; Cloud Run functions, Agent Runtime, les GPU/TPU et les outils assistés par l'IA ne sont pas implémentés.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Déploiement et autoscaling Cloud Run | ✅ | `min_instance_count` (par défaut `0`), `max_instance_count` (par défaut `1`), `container_resources` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Configurations de cluster GKE (Autopilot/Standard, régional, nœuds privés) | ✅ | `gke_cluster_mode` (par défaut `AUTOPILOT`), `create_google_kubernetes_engine` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Déploiement d'une application conteneurisée sur GKE | ✅ | `workload_type`, `stateful_pvc_enabled`, `container_resources` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Compute Engine : modèle d'instance, MIG, OS Login, choix du disque | 🟡 | uniquement le MIG de la VM NFS | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Traitement serverless des événements Google Cloud (Pub/Sub, Eventarc) | 🟡 | déclencheur Eventarc derrière `enable_auto_password_rotation` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Cloud Run functions, Agent Runtime, VM Manager, Spot VMs, types de machines personnalisés, Hyperdisk, GPU ou TPU | 📘 | non implémenté | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.2 Cloud SQL, GCS, Filestore, Memorystore | ✅ | `create_postgres` (par défaut `true`), `storage_buckets`, `create_filestore_nfs`, `create_redis` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 AlloyDB, Firestore | ✅ | `enable_alloydb`, `create_firestore` (tous deux `false` par défaut) | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 Chargement de données | 🟡 | `enable_backup_import` charge un dump de base de données depuis GCS | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 Redondance multirégionale | 🟡 | `storage_buckets[].location` (par défaut la région du déploiement ; accepte une multirégion comme `US`) ; la haute disponibilité `REGIONAL` de Cloud SQL couvre plusieurs zones, pas plusieurs régions | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 BigQuery, Spanner, Bigtable, Dataflow, Pub/Sub, Managed Service for Apache Kafka, NetApp Volumes, Managed Lustre, Storage Transfer Service | 📘 | non implémenté | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.3 VPC, sous-réseaux, règles de pare-feu VPC, Cloud NAT, PSA | ✅ | `availability_regions`, `subnet_cidr_range` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Choix et déploiement d'équilibreurs de charge (avec Cloud Armor, CDN) | ✅ | `enable_cloud_armor`, `application_domains`, `enable_cdn` | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Stratégies Cloud NGFW et tags sécurisés, VPC partagé, VPN/Interconnect, niveaux de service réseau | 📘 | non implémenté | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.4 Outils d'Infrastructure as Code | 🟡 | modules Terraform (exécutés en tant qu'OpenTofu), `deploy_application`, pipelines Cloud Build ; pas de Fabric FAST, Config Connector ni Helm | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#24-planning-and-implementing-resources-using-tooling) |
| 2.4 Planification assistée par l'IA (Gemini CLI, Google Antigravity, Gemini Cloud Assist, Application Design Center) | 📘 | non implémenté | [Guide de la section 2](ACE_Section_2_Exploration_Guide.md#24-planning-and-implementing-resources-using-tooling) |

## Section 3 : Garantir le bon fonctionnement d'une solution cloud (Ensuring the successful operation of a cloud solution) (~30 % de l'examen) {#section-3-ensuring-the-successful-operation-of-a-cloud-solution-30-of-the-exam}

La gestion des révisions, la répartition du trafic, la CI/CD avec Cloud Build et Cloud Deploy, les sauvegardes planifiées des bases de données, CMEK, les règles de cycle de vie GCS, les adresses IP statiques, Cloud NAT, un ensemble complet de règles d'alerte préconfigurées, l'Ops Agent, Managed Service for Prometheus et les tests de disponibilité synthétiques sur des points de terminaison publiquement accessibles sont tous opérationnels. Le routage des journaux, les environnements de travail IA et ML et les consoles au niveau du parc (fleet) sont des sujets à étudier en dehors de la plateforme.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Nouvelles versions Cloud Run, répartition du trafic, autoscaling Cloud Run | ✅ | `traffic_split`, `max_revisions_to_retain` (par défaut `7`), `min_instance_count`/`max_instance_count` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Déploiement de nouvelles versions via la CI/CD (Cloud Build, Cloud Deploy) | ✅ | `enable_cicd_trigger`, `cloud_deploy_stages` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Inventaire GKE, ressources Kubernetes, HPA/VPA, requêtes de pods Autopilot | ✅ | `enable_vertical_pod_autoscaling`, `enable_resource_quota`, `enable_pod_disruption_budget`, `container_resources` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Accès de GKE à Artifact Registry | ✅ | `roles/artifactregistry.reader` sur le compte de service GKE, `enable_image_mirroring` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Accès aux VM et inventaire, instantanés, pools de nœuds | 🟡 | MIG de la VM NFS avec instantanés quotidiens ; pool de nœuds en mode Standard | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 GPU/TPU, Agent Runtime, notebooks Workbench, Cloud Workstations | 📘 | non implémenté | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.2 Sauvegarde et restauration de Cloud SQL, exécution de SQL | ✅ | `backup_schedule` (par défaut `0 2 * * *`), `enable_backup_import`, `enable_custom_sql_scripts` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Gestion et sécurisation des objets GCS, règles de cycle de vie | ✅ | `storage_buckets[].lifecycle_rules`, `public_access_prevention`, `backup_retention_days` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Clés de chiffrement gérées par le client (CMEK) | ✅ | `enable_cmek` (Services_GCP, par défaut `false` — à définir uniquement lors du premier déploiement) | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Estimations des coûts de stockage, état des jobs Dataflow/BigQuery, Database Center, sauvegardes hors Cloud SQL | 📘 | non implémenté | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.3 Adresses IP statiques, Cloud NAT, gestion des règles de pare-feu VPC | 🟡 | `reserve_static_ip` (par défaut `true`), `availability_regions` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.3 Redimensionnement de sous-réseaux, routes statiques personnalisées, Cloud DNS, stratégies Cloud NGFW | 📘 | non implémenté | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.4 Alertes sur les métriques des ressources, tests de disponibilité | ✅ | `support_users`, `alert_policies`, `alert_cpu_threshold` (par défaut `80`), `uptime_check_config` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Journaux d'audit ; consultation et filtrage des journaux | ✅ | `enable_audit_logging` | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Ops Agent, Managed Service for Prometheus | ✅ | le script de démarrage de la VM NFS installe l'Ops Agent ; GKE active Managed Prometheus | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Outils de diagnostic | 🟡 | `enable_query_insights` (Services_GCP, par défaut `false`) ; aucune instrumentation Trace/Profiler | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Métriques personnalisées, récepteurs/buckets de journaux/Log Analytics, journaux de flux VPC, journaux de pare-feu, Personalized Service Health, Gemini Cloud Assist, Active Assist, Cloud Hub | 📘 | non implémenté | [Guide de la section 3](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |

## Section 4 : Configuration des accès et de la sécurité (Configuring access and security) (~20 % de l'examen) {#section-4-configuring-access-and-security-20-of-the-exam}

Une bonne couverture des comptes de service : chaque module crée des comptes de service dédiés, App_GKE utilise Workload Identity, Services_GCP peut créer un pool Workload Identity Federation, et des autorisations au niveau des ressources (Secret Manager, IAP, buckets) côtoient des autorisations plus larges au niveau du projet — une stratégie réaliste à auditer selon le principe du moindre privilège. Les rôles personnalisés et l'IAM au niveau de la hiérarchie sont des sujets à étudier en dehors de la plateforme.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Consultation et création de stratégies IAM | ✅ | liaisons au niveau du projet et des ressources | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.1 Types de rôles (de base, prédéfinis) | 🟡 | des rôles prédéfinis partout, plus un rôle de base (`roles/viewer` sur le compte de service Cloud Build) | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.1 Rôles personnalisés, héritage des stratégies dans la hiérarchie de l'organisation | 📘 | non implémenté | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.2 Création de comptes de service et attribution aux ressources | ✅ | identités d'exécution `cloudrun-sa-*`/`gke-sa-*` | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Comptes de service gérés par Google (agents de service) | 🟡 | `enable_cmek` accorde des rôles KMS aux agents de service de Cloud SQL, AlloyDB, Artifact Registry et Cloud Storage | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Autorisations minimales et au niveau des ressources ; autorisations IAM sur un compte de service | 🟡 | liaisons par secret/par bucket, `serviceAccountUser` sur le compte de service de la charge de travail, autorisations IAP (`enable_iap`) | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Compte de service avec une application GKE ; Workload Identity Federation | ✅ | liaison KSA→GSA, `enable_workload_identity_federation` | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Emprunt d'identité d'un compte de service | 🟡 | `impersonation_service_account` (modules applicatifs) | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Identifiants de courte durée, gestion des clés de compte de service | 📘 | volontairement sans clé — étudiez séparément `gcloud iam service-accounts keys` et l'émission de jetons | [Guide de la section 4](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
