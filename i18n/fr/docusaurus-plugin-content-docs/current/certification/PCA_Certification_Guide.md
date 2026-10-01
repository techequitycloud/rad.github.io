---
title: "Carte des labs de la certification Professional Cloud Architect (PCA)"
description: "Associez chaque domaine de l'examen Professional Cloud Architect (PCA) à des labs pratiques de déploiement RAD sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PCA_Certification_Guide.md @ cb682e8 sha256:54382408a098 -->

# Carte des labs de la certification Professional Cloud Architect (PCA) {#professional-cloud-architect-pca-certification-lab-map}

La certification Professional Cloud Architect valide votre capacité à concevoir, planifier et gérer des solutions cloud sécurisées, évolutives et hautement disponibles — et à justifier les compromis qui sous-tendent chaque choix de conception. Les quatre modules de fondation de la plateforme RAD vous offrent un lab réel pour précisément ces compromis : `Services_GCP` (la couche de plateforme partagée — VPC, Cloud SQL, Redis, Filestore, GKE, CMEK, VPC-SC), `App_CloudRun` et `App_GKE` (deux moteurs de déploiement pour la *même* charge de travail conteneurisée, qui incarnent le choix entre serverless et orchestration auquel l'examen PCA revient sans cesse), et `App_Common` (des couches partagées qui mettent en œuvre les modèles de découverte, de secrets, d'IAM, de stockage et de CI/CD). Chaque option de votre portail de déploiement est une décision de conception que vous pouvez déployer, inspecter dans la console GCP, puis annuler.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement, puis parcourez le ou les guides de section correspondants.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** À la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- **Certains paramètres nécessitent un projet que vous apportez.** Lorsqu'un déploiement est placé dans un projet géré par RAD (un projet que RAD crée pour vous), le formulaire de déploiement omet tous les paramètres qu'un module marque comme indisponibles dans ce cas — des paramètres qui dépassent le projet pour atteindre l'organisation de RAD, ou qui nécessitent une API que les paliers gérés par RAD n'autorisent pas. Dans ce guide, cela concerne `enable_vpc_sc` et ses paramètres associés (`vpc_sc_dry_run`, `admin_ip_ranges`) ; déployez les profils qui les définissent dans votre propre projet Google Cloud.
- Chaque guide de section associe des critères de décision (« pourquoi l'examen s'y intéresse ») aux variables exactes qui mettent en œuvre le concept, à des étapes pratiques et à des questions d'auto-évaluation.
- Utilisez la légende de couverture en toute honnêteté : les sujets 📘 (connectivité hybride, planification de migration, Gemini Enterprise Agent Platform et les API d'IA de Google, Gemini Cloud Assist, hiérarchie de l'organisation) doivent être étudiés en dehors de la plateforme — les encadrés « Au-delà des modules » vous indiquent quoi étudier et où.
- **Well-Architected Framework (📘) :** le guide d'examen actuel cite la connaissance du Google Cloud Well-Architected Framework comme une exigence clé, et ses piliers — excellence opérationnelle, sécurité, fiabilité, optimisation des performances, optimisation des coûts et durabilité — traversent toutes les sections. Les modules illustrent des principes particuliers (voir 1.2 et 6.1), mais lisez le framework lui-même de bout en bout.
- **Études de cas (📘) :** certaines questions d'examen font référence à une étude de cas décrivant une entreprise fictive, et le guide actuel en liste quatre : **Altostrat Media**, **Cymbal Retail**, **EHR Healthcare** et **KnightMotives Automotive**. Plusieurs de ces entreprises utilisent les solutions d'IA générative de Google Cloud ; attendez-vous donc à des exigences d'IA aux côtés des exigences d'infrastructure classiques. Les modules sont un excellent terrain de répétition : lisez les exigences d'une étude de cas, puis notez quelles variables du portail satisferaient chacune d'elles (par exemple, les exigences de chiffrement et d'audit d'EHR Healthcare correspondent à `enable_cmek`, `enable_audit_logging` et `enable_vpc_sc` ; une plateforme client conteneurisée et à mise à l'échelle automatique correspond à GKE Autopilot ou Cloud Run derrière un équilibreur de charge global avec Cloud Armor). Lorsqu'une exigence n'a *aucune* variable correspondante — Interconnect hybride, agents Gemini Enterprise Agent Platform, modèles Model Garden —, vous avez trouvé une lacune à combler. Lisez les documents officiels des études de cas ; ce guide ne les reproduit pas.
- **Examen de renouvellement :** l'examen Professional Cloud Architect Renewal possède son propre guide en **quatre** sections — Conception et planification d'une architecture de solution cloud (Designing and planning a cloud solution architecture, ~30 %), Gestion et provisionnement d'une infrastructure de solution (Managing and provisioning a solution infrastructure, ~40 %), Conception pour la sécurité et la conformité (Designing for security and compliance, ~20 %) et Gestion de la mise en œuvre (Managing implementation, ~10 %) — et s'appuie sur l'une de deux études de cas (Cymbal Retail ou Altostrat Media). Ses objectifs forment en grande partie un sous-ensemble de ceux présentés ci-dessous : l'objectif 2.4 du renouvellement (surveillance, journalisation, profilage et alertes) est couvert par la [Section 6.2](PCA_Section_6_Exploration_Guide.md#62-familiarity-with-google-cloud-observability-solutions), et les points propres au renouvellement (Gemini in Security, Gemini Code Assist, « enablement and advocacy ») sont signalés dans les guides des sections 1, 3 et 5.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le dans la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non mis en œuvre par les modules ; pistes d'étude fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : Socle allégé {#profile-lean-baseline}
*Objectif :* l'architecture la moins coûteuse — base de données zonale, serverless avec mise à l'échelle à zéro, VM NFS autogérée — votre point de référence pour chaque compromis coût/disponibilité.
*Modules :* Services_GCP, puis App_CloudRun.
| Variable | Valeur |
|---|---|
| `create_postgres` | `true` (par défaut) |
| `postgres_database_availability_type` | `ZONAL` (par défaut) |
| `create_network_filesystem` | `true` (par défaut — VM NFS/Redis e2-small) |
| `min_instance_count` | `0` (par défaut, App_CloudRun) |
| `max_instance_count` | `1` (par défaut, App_CloudRun) |

*Coût supplémentaire estimé :* faible — l'instance Cloud SQL zonale `db-custom-1-3840` et la VM NFS e2-small dominent ; Cloud Run descend à zéro.

### Profil : Niveau de données résilient {#profile-resilient-data-tier}
*Objectif :* faire passer le socle en haute disponibilité afin de comparer côte à côte Cloud SQL ZONAL et REGIONAL, Redis BASIC et STANDARD_HA, et NFS sur VM et Filestore géré.
*Modules :* Services_GCP (mise à jour sur place), App_CloudRun inchangé.
| Variable | Valeur |
|---|---|
| `postgres_database_availability_type` | `REGIONAL` |
| `create_postgres_read_replica` | `true` |
| `create_redis` | `true` |
| `redis_tier` | `STANDARD_HA` |
| `redis_persistence_mode` | `RDB` |
| `create_filestore_nfs` | `true` |
| `filestore_tier` | `BASIC_HDD` (par défaut) |

*Coût supplémentaire estimé :* élevé — Cloud SQL REGIONAL double à peu près le coût de l'instance, l'instance dupliquée avec accès en lecture ajoute une autre instance, Redis STANDARD_HA double le coût de Redis, et Filestore facture un minimum de 1024 GB.

### Profil : Architecture GKE {#profile-gke-architecture}
*Objectif :* déployer la même charge de travail sur GKE Autopilot pour mettre en pratique le choix entre Cloud Run et GKE, la gouvernance Kubernetes (quotas, PDB, NetworkPolicy) et l'exposition via la Gateway API.
*Modules :* Services_GCP (mise à jour), puis App_GKE.
| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` | `true` (Services_GCP) |
| `gke_cluster_mode` | `AUTOPILOT` (par défaut) |
| `enable_resource_quota` | `true` (App_GKE) |
| `enable_network_segmentation` | `true` (App_GKE) |
| `enable_pod_disruption_budget` | `true` (par défaut, App_GKE) |
| `stateful_pvc_enabled` | `true`, avec `stateful_pvc_size = "10Gi"` et un chemin de montage |

*Coût supplémentaire estimé :* modéré — Autopilot facture par demande de ressources des pods, plus des frais de gestion du cluster ; le PVC avec état ajoute un petit disque persistant.

### Profil : Sécurité et livraison {#profile-security-and-delivery}
*Objectif :* ajouter une défense en profondeur (CMEK, Binary Authorization, VPC-SC en mode simulation, journaux d'audit) et un pipeline CI/CD complet avec livraison progressive — l'ossature des sections 3, 4 et 6.
*Modules :* Services_GCP (mise à jour), App_CloudRun (mise à jour).
| Variable | Valeur |
|---|---|
| `enable_cmek` | `true` (Services_GCP) |
| `enable_binary_authorization` | `true`, `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` (Services_GCP) |
| `enable_vpc_sc` | `true`, `vpc_sc_dry_run = true` (Services_GCP ; nécessite une organisation + `admin_ip_ranges`) |
| `enable_audit_logging` | `true` (Services_GCP) |
| `enable_cloud_armor` | `true` (`application_domains` facultatif sur App_CloudRun) |
| `enable_iap` | `true`, plus `iap_authorized_users` (App_CloudRun) |
| `enable_cicd_trigger` | `true`, plus `github_repository_url` (App_CloudRun) |
| `enable_cloud_deploy` | `true` (App_CloudRun) |
| `enable_auto_password_rotation` | `true` (App_CloudRun) |

*Coût supplémentaire estimé :* modéré — les clés KMS, la règle de transfert de l'équilibreur de charge global et le stockage des journaux d'audit sont les principaux postes ; VPC-SC et Binary Authorization sont gratuits.

## Section 1 : Conception et planification d'une architecture de solution cloud (Designing and planning a cloud solution architecture) (~25 % de l'examen) {#section-1-designing-and-planning-a-cloud-solution-architecture-25-of-the-exam}

Le cœur de l'examen PCA : choisir des architectures qui satisfont les exigences métier et techniques. Les modules incarnent les compromis canoniques — calcul serverless ou orchestré, base de données zonale ou régionale, stockage de fichiers géré ou autogéré —, mais l'analyse métier, la planification de migration et la réflexion prospective se situent en dehors de tout module Terraform.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Exigences métier (coût, sécurité, mesures de réussite) | 🟡 | `min_instance_count`, `create_billing_budget`, `enable_iap`, `support_users` | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#11-designing-a-cloud-solution-infrastructure-that-meets-business-requirements) |
| 1.2 Exigences techniques (HA, évolutivité, fiabilité, sauvegarde et restauration) | ✅ | `postgres_database_availability_type`, `redis_tier`, `create_postgres_read_replica`, HPA/PDB dans App_GKE | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#12-designing-a-cloud-solution-infrastructure-that-meets-technical-requirements) |
| 1.2 Exigences techniques — Well-Architected Framework, Gemini Cloud Assist | 📘 | non mis en œuvre | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#12-designing-a-cloud-solution-infrastructure-that-meets-technical-requirements) |
| 1.3 Conception du réseau, du stockage et du calcul | ✅ | VPC + Cloud NAT + accès aux services privés, Filestore ou NFS autogéré, App_CloudRun ou App_GKE | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#13-designing-network-storage-and-compute-resources) |
| 1.3 Solutions d'IA et de ML de Google Cloud (Gemini, Agent Builder, Model Garden, AI Hypercomputer) | 📘 | le plus proche : le module d'application `DataAnalyst_CloudRun` appelle un modèle Gemini via Vertex AI (`agent_model`, `vertex_region`) | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#13-designing-network-storage-and-compute-resources) |
| 1.4 Élaboration d'un plan de migration | 📘 | le plus proche : les jobs d'import de données `enable_backup_import` | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#14-creating-a-migration-plan) |
| 1.5 Anticipation des améliorations futures de la solution | 📘 | le plus proche : architecture de modules en couches, modèle découverte ou création en ligne | [Guide de la section 1](PCA_Section_1_Exploration_Guide.md#15-envisioning-future-solution-improvements) |

## Section 2 : Gestion et provisionnement d'une infrastructure de solution cloud (Managing and provisioning a cloud solution infrastructure) (~17,5 % de l'examen) {#section-2-managing-and-provisioning-a-cloud-solution-infrastructure-175-of-the-exam}

Le provisionnement est le métier même des modules : un VPC en mode personnalisé avec Cloud NAT et accès aux services privés, quatre moteurs de base de données, trois types de stockage de fichiers/objets et deux plateformes de conteneurs — le tout de manière déclarative. Les topologies hybrides et les deux sous-sections Gemini Enterprise Agent Platform relèvent uniquement de l'étude.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Configuration des topologies réseau | 🟡 | `availability_regions`, `subnet_cidr_range`, Cloud NAT + accès aux services privés ; pas d'hybride ni de VPC partagé | [Guide de la section 2](PCA_Section_2_Exploration_Guide.md#21-configuring-network-topologies) |
| 2.2 Configuration des systèmes de stockage individuels | ✅ | `storage_buckets`, `backup_schedule`, `create_filestore_nfs`, PITR Cloud SQL | [Guide de la section 2](PCA_Section_2_Exploration_Guide.md#22-configuring-individual-storage-systems) |
| 2.3 Configuration des systèmes de calcul | ✅ | `gke_cluster_mode`, `gke_autoscaling_profile`, `container_resources`, `execution_environment` | [Guide de la section 2](PCA_Section_2_Exploration_Guide.md#23-configuring-compute-systems) |
| 2.4 Exploitation de Gemini Enterprise Agent Platform pour des workflows de ML de bout en bout | 📘 | non mis en œuvre | [Guide de la section 2](PCA_Section_2_Exploration_Guide.md#24-leveraging-gemini-enterprise-agent-platform-for-end-to-end-ml-workflows) |
| 2.5 Configuration de solutions ou d'API prédéfinies avec Agent Platform | 📘 | le plus proche : `secret_environment_variables` pour les clés d'API ; appels Gemini sans clé dans `DataAnalyst_CloudRun` | [Guide de la section 2](PCA_Section_2_Exploration_Guide.md#25-configuring-prebuilt-solutions-or-apis-with-agent-platform) |

## Section 3 : Conception pour la sécurité et la conformité (Designing for security and compliance) (~17,5 % de l'examen) {#section-3-designing-for-security-and-compliance-175-of-the-exam}

Le profil Sécurité et livraison active l'essentiel de ce que cette section évalue : comptes de service dédiés au moindre privilège, CMEK avec rotation automatique, attestation Binary Authorization, VPC Service Controls en mode simulation (dry-run), accès zero-trust via IAP et journalisation d'audit complète. La hiérarchie de l'organisation et les cadres réglementaires restent des sujets d'étude.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Sécurité — IAM, secrets, chiffrement, chaîne d'approvisionnement, périmètres | ✅ | `enable_cmek`, `enable_binary_authorization`, `enable_vpc_sc`, `enable_iap`, les couches secrets et IAM de la plateforme | [Guide de la section 3](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.1 Sécurité — hiérarchie des ressources, règles d'administration, stratégies de pare-feu hiérarchiques, Chrome Enterprise Premium | 📘 | non mis en œuvre | [Guide de la section 3](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.1 Sécurité — Workload Identity Federation (CI sans clé) | ✅ | `enable_workload_identity_federation`, `wif_provider_type` (Services_GCP) | [Guide de la section 3](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.1 Sécurité — sécurisation de l'IA (Model Armor, Sensitive Data Protection, déploiement sécurisé de modèles) | 📘 | non mis en œuvre | [Guide de la section 3](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.2 Conformité — auditabilité, contrôles de type ITAR/HIPAA | 🟡 | `enable_audit_logging`, `enable_security_command_center`, `vpc_sc_dry_run` | [Guide de la section 3](PCA_Section_3_Exploration_Guide.md#32-designing-for-compliance) |

## Section 4 : Analyse et optimisation des processus techniques et métier (Analyzing and optimizing technical and business processes) (~15 % de l'examen) {#section-4-analyzing-and-optimizing-technical-and-business-processes-15-of-the-exam}

La CI/CD et la gouvernance des mises en production sont entièrement démontrables : un pipeline Cloud Build déclenché par GitHub, des builds d'images Kaniko vers Artifact Registry, une attestation Binary Authorization facultative et un pipeline Cloud Deploy dont l'étape `prod` par défaut exige une approbation manuelle. La culture SRE, les post-mortems et la gestion des parties prenantes sont des sujets humains — étudiez-les séparément.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Processus techniques — SDLC, CI/CD, tests, catalogue de services, reprise après sinistre | 🟡 | `enable_cicd_trigger`, `cloud_deploy_stages`, `traffic_split` | [Guide de la section 4](PCA_Section_4_Exploration_Guide.md#41-analyzing-and-defining-technical-processes) |
| 4.2 Processus métier — gestion du changement, prise de décision, continuité des activités | 🟡 | portes `require_approval` dans `cloud_deploy_stages` ; garde-fous de coût via `create_billing_budget` | [Guide de la section 4](PCA_Section_4_Exploration_Guide.md#42-analyzing-and-defining-business-processes) |

## Section 5 : Gestion de la mise en œuvre (Managing implementation) (~12,5 % de l'examen) {#section-5-managing-implementation-125-of-the-exam}

La plateforme *est* elle-même une démonstration de gestion de la mise en œuvre : une architecture IaC à quatre niveaux que les équipes de développement consomment via un portail, avec des règles d'hygiène Artifact Registry et des validations de garde-fous intégrées. La maîtrise directe des SDK (`gcloud`, bibliothèques clientes, émulateurs) exige une pratique au-delà du portail.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 5.1 Conseil aux équipes de développement et d'exploitation | 🟡 | architecture de modules en couches, `max_images_to_retain`, validations au moment du plan | [Guide de la section 5](PCA_Section_5_Exploration_Guide.md#51-advising-development-and-operation-teams) |
| 5.1 Gestion des API (Apigee), Gemini Cloud Assist | 📘 | non mis en œuvre | [Guide de la section 5](PCA_Section_5_Exploration_Guide.md#51-advising-development-and-operation-teams) |
| 5.2 Interaction programmatique avec Google Cloud | 🟡 | workflow OpenTofu, provisionneurs et scripts de découverte basés sur `gcloud` | [Guide de la section 5](PCA_Section_5_Exploration_Guide.md#52-interacting-with-google-cloud-programmatically) |

## Section 6 : Garantir l'excellence des solutions et des opérations (Ensuring solution and operations excellence) (~12,5 % de l'examen) {#section-6-ensuring-solution-and-operations-excellence-125-of-the-exam}

Les opérations du « jour 2 » : chaque déploiement est livré avec un tableau de bord de surveillance et des canaux d'alerte par e-mail ; Cloud SQL et la VM NFS reçoivent des alertes sur le CPU, la mémoire et le disque ; les mises en production peuvent être déployées en canary avec `traffic_split` et promues via Cloud Deploy. Les déploiements accessibles publiquement reçoivent également un test de disponibilité synthétique et une règle d'alerte via `uptime_check_config` (provisionnés par la couche de surveillance de la plateforme) ; les processus d'assistance et le chaos engineering relèvent uniquement du concept.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 6.1 Pilier excellence opérationnelle du Well-Architected Framework | 🟡 | automatisation omniprésente ; MIG NFS à réparation automatique, récupération de la clé CMEK au moment du plan | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#61-operational-excellence-pillar-well-architected-framework) |
| 6.2 Connaissance des solutions Google Cloud Observability | ✅ | `support_users`, `alert_policies`, `uptime_check_config`, la couche de surveillance de la plateforme | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#62-familiarity-with-google-cloud-observability-solutions) |
| 6.3 Gestion des déploiements et des mises en production | ✅ | `traffic_split`, `cloud_deploy_stages`, `max_revisions_to_retain` | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#63-deployment-and-release-management) |
| 6.4 Contribution à l'assistance des solutions déployées | 📘 | le plus proche : canaux de notification `support_users` | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#64-assisting-with-the-support-of-deployed-solutions) |
| 6.5 Évaluation des mesures de contrôle qualité | 🟡 | `enable_vulnerability_scanning`, étape d'attestation Binary Authorization, la suite de validations au moment du plan d'App_GKE | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#65-evaluating-quality-control-measures) |
| 6.6 Garantie de la fiabilité des solutions en production | 🟡 | PDB, répartition topologique, MIG NFS à réparation automatique, garde-fou de niveau production pour Redis | [Guide de la section 6](PCA_Section_6_Exploration_Guide.md#66-ensuring-the-reliability-of-solutions-in-production) |

---

*Des modules d'encapsulation d'applications (Django, WordPress et d'autres) existent sur la plateforme, mais ils sortent du cadre de ces guides — tout ce qui figure ici est démontré avec les quatre seuls modules de fondation. La seule exception est `DataAnalyst_CloudRun`, cité comme l'exemple le plus proche d'une charge de travail appelant un modèle Gemini via Vertex AI pour les objectifs d'IA de l'examen.*
