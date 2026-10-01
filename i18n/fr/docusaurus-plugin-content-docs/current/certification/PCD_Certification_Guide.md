---
title: "Carte des labs de la certification Professional Cloud Developer (PCD)"
description: "Associez chaque domaine de l'examen Professional Cloud Developer (PCD) à des labs pratiques de déploiement RAD sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PCD_Certification_Guide.md @ cb682e8 -->

# Carte des labs de la certification Professional Cloud Developer (PCD) {#professional-cloud-developer-pcd-certification-lab-map}

La certification Professional Cloud Developer valide votre capacité à concevoir, créer, tester, déployer et intégrer des applications évolutives et sécurisées sur Google Cloud — avec un accent marqué sur Cloud Run, GKE, Cloud Build, Artifact Registry, les secrets à l'exécution, l'authentification entre services, l'intégration événementielle et l'observabilité. Le guide d'examen actuel attend également une bonne maîtrise des outils de développement assistés par l'IA (assistants de codage IA tels que Gemini Code Assist, Gemini Cloud Assist, serveurs MCP, observabilité assistée par l'IA) ; rien de cela n'est implémenté par les modules, et ces objectifs sont donc marqués 📘 ci-dessous. Les quatre modules de fondation de la plateforme RAD (`Services_GCP`, `App_CloudRun`, `App_GKE`, `App_Common`) vous offrent un lab en conditions réelles pour exactement ces compétences : `Services_GCP` provisionne la plateforme partagée (VPC, Cloud SQL, Redis, GKE Autopilot, Artifact Registry, Binary Authorization, Workload Identity Federation), `App_CloudRun` et `App_GKE` sont des moteurs de déploiement complets pour les services Cloud Run v2 et les charges de travail Kubernetes, et `App_Common` fournit les sous-modules partagés qu'ils utilisent tous deux (secrets et rotation, builds de conteneurs Cloud Build, pipelines Cloud Deploy, IAM, stockage, surveillance). Des modules d'encapsulation applicatifs (Django, Wordpress, etc.) existent sur la plateforme, mais tout ce que contiennent ces guides utilise directement les modules de fondation.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement, puis suivez le guide d'exploration de la section correspondante.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** Lors de la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- **Certains paramètres exigent un projet que vous apportez.** Lorsqu'un déploiement est placé dans un projet géré par RAD (un projet que RAD crée pour vous), le formulaire de déploiement omet tous les paramètres qu'un module signale comme indisponibles dans ce cas — des paramètres qui dépassent le périmètre du projet pour atteindre l'organisation de RAD, ou qui nécessitent une API que les paliers gérés par RAD n'autorisent pas. Dans ce guide, cela concerne `enable_workload_identity_federation` et les autres paramètres `wif_*`, `enable_alloydb`, `configure_cloud_service_mesh`/`configure_service_mesh`, ainsi que les paramètres de Security Command Center ; déployez les profils qui les définissent dans votre propre projet Google Cloud.
- Chaque guide de section associe les variables du portail aux vues de la console GCP et aux commandes `gcloud`/`kubectl` que l'examen attend que vous connaissiez.
- Utilisez la légende de couverture pour planifier votre temps d'étude : les sujets 🟡 et 📘 comportent un encadré « Au-delà des modules » qui vous indique ce qu'il faut pratiquer en dehors de la plateforme.
- PCD est un examen de *développeur* : lorsque vous suivez les labs, demandez-vous toujours « que verrait le code de mon application ? » — les variables d'environnement, les références de secrets, les chemins de sockets, les jetons.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le sur la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non implémenté par les modules ; pistes d'étude fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : Serverless baseline (socle serverless) {#profile-serverless-baseline}
*Objectif :* un service Cloud Run v2 par défaut avec base de données, sondes et secrets à l'exécution — la configuration de référence pour les sections 1, 3.1 et 4.
*Modules :* `Services_GCP` (valeurs par défaut), puis `App_CloudRun`.

| Variable | Valeur |
|---|---|
| `create_postgres` (Services_GCP) | `true` (par défaut) |
| `deploy_application` | `true` (par défaut) |
| `min_instance_count` | `0` (par défaut — mise à l'échelle jusqu'à zéro) |
| `max_instance_count` | `3` (augmentez la valeur par défaut `1` pour observer la montée en charge horizontale) |
| `database_type` | `"POSTGRES"` (par défaut) |
| `startup_probe_config` / `health_check_config` | valeurs par défaut (HTTP `/healthz`) |

*Coût supplémentaire estimé :* faible — Cloud Run descend jusqu'à zéro ; les coûts dominants sont l'instance Cloud SQL `db-custom-1-3840` et la VM NFS `e2-small` que `Services_GCP` crée par défaut.

### Profil : Delivery pipeline (pipeline de livraison) {#profile-delivery-pipeline}
*Objectif :* Cloud Build (Kaniko) déclenché par GitHub → Artifact Registry → livraison progressive Cloud Deploy avec attestation Binary Authorization. Sections 2 et 3.1.
*Modules :* `Services_GCP` + `App_CloudRun`.

| Variable | Valeur |
|---|---|
| `enable_cicd_trigger` | `true` |
| `github_repository_url` | l'URL de votre dépôt |
| `enable_cloud_deploy` | `true` |
| `cicd_enable_cloud_deploy` | `true` |
| `cloud_deploy_stages` | par défaut (`dev`, `staging`, `prod` avec `require_approval = true` sur prod) |
| `enable_binary_authorization` (les deux modules) | `true` |
| `binauthz_evaluation_mode` | `"REQUIRE_ATTESTATION"` |
| `enable_vulnerability_scanning` (Services_GCP) | `true` |
| `enable_workload_identity_federation` (Services_GCP) | `true` |

*Coût supplémentaire estimé :* faible à modéré — trois services Cloud Run, un par étape (tous peuvent descendre à zéro) plus les minutes Cloud Build à chaque push.

### Profil : Kubernetes lab (lab Kubernetes) {#profile-kubernetes-lab}
*Objectif :* déploiement GKE Autopilot avec Workload Identity, HPA, gouvernance des espaces de noms et le module complémentaire CSI de Secret Manager. Sections 1.1, 3.2 et 4.2.
*Modules :* `Services_GCP` avec GKE activé, puis `App_GKE`.

| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `"AUTOPILOT"` (par défaut) |
| `min_instance_count` / `max_instance_count` (App_GKE) | `1` / `3` (valeurs par défaut) |
| `enable_resource_quota` (App_GKE) | `true` |
| `enable_network_segmentation` (App_GKE) | `true` |
| `enable_pod_disruption_budget` (App_GKE) | `true` (par défaut) |

*Coût supplémentaire estimé :* modéré — Autopilot facture selon les ressources demandées par pod, plus les frais de gestion du cluster ; le pod par défaut de 1000m/512Mi est le principal facteur de coût.

### Profil : Hardened edge (périphérie renforcée) {#profile-hardened-edge}
*Objectif :* authentification IAP, WAF Cloud Armor + équilibreur de charge HTTPS global, rotation automatique des secrets et mise en cache Memorystore. Sections 1.1, 1.2 et 4.1.
*Modules :* `Services_GCP` avec Redis, puis `App_CloudRun`.

| Variable | Valeur |
|---|---|
| `create_redis` (Services_GCP) | `true` |
| `redis_tier` (Services_GCP) | `"BASIC"` (par défaut) |
| `enable_iap` | `true` (plus `iap_authorized_users`) |
| `enable_cloud_armor` | `true` (`application_domains` facultatif — un certificat `nip.io` est dérivé s'il n'est pas défini) |
| `application_domains` | un domaine que vous contrôlez |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `"2592000s"` (par défaut, 30 jours) |

*Coût supplémentaire estimé :* modéré — la règle de transfert de l'Application Load Balancer externe global et l'instance Memorystore de 1 GB sont facturées en continu, même lorsque le service Cloud Run est inactif. IAP seul (sans Cloud Armor) n'ajoute aucun coût d'équilibreur de charge.

## Section 1 : Conception d'applications cloud natives hautement évolutives, sécurisées et fiables (Designing highly scalable, secure, and reliable cloud-native applications) (~32 % de l'examen) {#section-1-designing-highly-scalable-secure-and-reliable-cloud-native-applications-32-of-the-exam}

La section la plus importante. Les modules démontrent le choix de la plateforme (Cloud Run ou GKE), le comportement de mise à l'échelle, la répartition du trafic par révision, les secrets à l'exécution, IAP, Binary Authorization et le choix du stockage. Les produits de gestion d'API (Apigee, API Gateway), la messagerie applicative et l'orchestration Workflows/Cloud Tasks relèvent de l'étude seule.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Choix de la plateforme, mise à l'échelle, démarrages à froid | ✅ | `min_instance_count`, `max_instance_count`, `cpu_always_allocated`, `execution_environment` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Répartition du trafic, canary, retour arrière | ✅ | `traffic_split`, `max_revisions_to_retain` (App_CloudRun) | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Équilibreurs de charge, mise en cache, CDN, affinité de session | 🟡 | `enable_cloud_armor` (équilibreur HTTPS global), `enable_custom_domain` (GKE Gateway), `create_redis`, `enable_redis`, `enable_cdn` ; affinité de session activée en dur (Cloud Run), `session_affinity` (App_GKE) | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 API REST/gRPC, gestion d'API (Apigee, API Gateway), intégration Eventarc/Pub/Sub | 🟡 | `container_protocol = "h2c"` active HTTP/2 de bout en bout (compatible gRPC) sur Cloud Run et `appProtocol kubernetes.io/h2c` sur le Service GKE ; la gestion d'API et la messagerie applicative relèvent de l'étude seule | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Basculement zonal/régional, réplication des données | 🟡 | `postgres_database_availability_type = "REGIONAL"`, `create_postgres_read_replica` (interrégional lorsque `availability_regions` contient une seconde région), `redis_tier = "STANDARD_HA"` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Orchestration (Workflows, Eventarc, Cloud Tasks, Cloud Scheduler) | 🟡 | `cron_jobs` (jobs Cloud Run déclenchés par Cloud Scheduler) ; Workflows et Cloud Tasks relèvent de l'étude seule | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.2 Secrets à l'exécution + rotation | ✅ | `secret_environment_variables`, `enable_auto_password_rotation`, `secret_rotation_period` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 Authentification des utilisateurs finaux (IAP), sécurité de la chaîne d'approvisionnement | ✅ | `enable_iap`, `enable_binary_authorization`, `enable_vulnerability_scanning` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 CMEK, journaux d'audit, segmentation réseau | 🟡 | `enable_cmek`, `enable_audit_logging`, `enable_network_segmentation` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 Conservation des données (Object Lifecycle Management, verrouillage de la conservation) | 🟡 | `storage_buckets[].lifecycle_rules` ; les règles de conservation des buckets et leur verrouillage relèvent de l'étude seule | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 Correction des vulnérabilités (Artifact Analysis, Security Command Center) | 🟡 | `enable_vulnerability_scanning`, `enable_security_command_center`, `enable_scc_notifications` font remonter les résultats ; la correction vous incombe | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 Communication sécurisée entre services | 🟡 | `vpc_egress_setting` (sortie VPC directe), accès aux services privés pour Cloud SQL/Redis, `enable_network_segmentation`, `configure_cloud_service_mesh` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.3 Choix du stockage relationnel/objet/cache | ✅ | `create_postgres`, `create_mysql`, `storage_buckets`, `create_redis`, `enable_alloydb` | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#13-storing-and-accessing-data) |
| 1.3 Schémas Firestore, Spanner, Bigtable ; écriture dans BigQuery pour l'analyse/l'IA ; URL signées | 📘 | `create_firestore` provisionne uniquement la base — l'utilisation du SDK, la conception des schémas et les écritures BigQuery relèvent de l'étude seule | [Guide de la section 1](PCD_Section_1_Exploration_Guide.md#13-storing-and-accessing-data) |

## Section 2 : Création et test d'applications (Building and testing applications) (~23 % de l'examen) {#section-2-building-and-testing-applications-23-of-the-exam}

Le pipeline de build est le domaine le mieux couvert du dépôt : chaque déploiement exécute de vrais jobs Cloud Build (Kaniko ou Docker), pousse vers Artifact Registry avec des règles de nettoyage, et peut signer les images pour Binary Authorization. Les outils locaux, les émulateurs et le développement assisté par l'IA (assistants de codage, Gemini Cloud Assist, serveurs MCP) relèvent de l'étude seule.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Environnement de développement local, émulateurs, Cloud Code/Shell/Workstations | 📘 | le plus proche : déploiements isolés par tenant via `tenant_id` | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#21-setting-up-your-development-environment) |
| 2.1 Gemini Cloud Assist, outils d'IA dans l'IDE (assistants de codage, serveurs MCP) | 📘 | non implémenté — étude seule | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#21-setting-up-your-development-environment) |
| 2.2 Builds de conteneurs Cloud Build | ✅ | `container_image_source = "custom"`, `container_build_config` | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.2 Artifact Registry, cycle de vie des images, mise en miroir | ✅ | `enable_image_retention` (dépôt partagé de Services_GCP), `max_images_to_retain`/`image_retention_days`/`delete_untagged_images` (dépôt intégré uniquement), mise en miroir Crane tenant compte des digests | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.2 Déclencheurs CI, Kaniko, provenance/attestation (Binary Authorization) | ✅ | `enable_cicd_trigger`, `cicd_trigger_config`, Kaniko v1.23.2, signature des images dans le pipeline | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.3 Tests d'intégration automatisés dans Cloud Build | 🟡 | le pipeline de build généré est extensible ; aucune étape de test n'est fournie par défaut |
| 2.3 Écriture de tests unitaires avec des assistants de codage IA | 📘 | non implémenté — étude seule | [Guide de la section 2](PCD_Section_2_Exploration_Guide.md#23-testing) |

## Section 3 : Configuration d'applications cloud natives pour le déploiement (Configuring cloud-native applications for deployment) (~24 % de l'examen) {#section-3-configuring-cloud-native-applications-for-deployment-24-of-the-exam}

Les deux cibles de déploiement sont entièrement implémentées. `App_CloudRun` couvre les builds du code source au service, les révisions, la mise à l'échelle, les sondes, les volumes, les jobs et la promotion Cloud Deploy ; `App_GKE` couvre les Deployments/StatefulSets, HPA/VPA, les sondes, les quotas, les PDB et la Gateway API. L'invocation événementielle (Eventarc, déclencheurs et récepteurs Pub/Sub) et Apigee relèvent de l'étude seule.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Configuration d'un service Cloud Run (mise à l'échelle, CPU, gen2, délai d'expiration) | ✅ | `min/max_instance_count`, `cpu_always_allocated`, `execution_environment`, `timeout_seconds` | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Déploiement à partir du code source | 🟡 | `container_image_source = "custom"` + `enable_cicd_trigger` construisent à partir de votre dépôt dans Cloud Build ; `gcloud run deploy --source` relève de l'étude seule | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Invocation via des déclencheurs ; récepteurs d'événements (Eventarc, Pub/Sub) | 📘 | Eventarc/Pub/Sub ne sont utilisés qu'en interne (rotation des secrets) — étude seule | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Gestion des versions, exposition et sécurisation des API (Apigee) | 🟡 | URL de révision `tag`, `ingress_settings`, `enable_iap`, `enable_cloud_armor` ; Apigee relève de l'étude seule | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| Complémentaire : révisions, Cloud Deploy, jobs Cloud Run | ✅ | `traffic_split`, `enable_cloud_deploy`, `cloud_deploy_stages`, `initialization_jobs` — la répartition du trafic est désormais évaluée sous 1.1 ; Cloud Deploy n'est plus un objectif nommé | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.2 Charges de travail GKE, ressources, contrôles d'état (sondes) | ✅ | `workload_type`, `container_resources`, `startup_probe_config`, `health_check_config` | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#32-deploying-containers-to-gke) |
| 3.2 Horizontal Pod Autoscaler, VPA, quotas, PDB, exposition | ✅ | `min/max_instance_count`, `enable_vertical_pod_autoscaling`, `enable_resource_quota`, `enable_custom_domain` | [Guide de la section 3](PCD_Section_3_Exploration_Guide.md#32-deploying-containers-to-gke) |

## Section 4 : Intégration d'applications aux services Google Cloud (Integrating applications with Google Cloud services) (~21 % de l'examen) {#section-4-integrating-applications-with-google-cloud-services-21-of-the-exam}

La connectivité aux bases de données (Cloud SQL Auth Proxy sur les deux plateformes), l'injection de configuration à l'exécution, Workload Identity et les alertes sont démontrés en conditions réelles. Le codage avec les bibliothèques clientes (traitement par lots, pagination, backoff), le traçage, Error Reporting et l'observabilité assistée par l'IA relèvent de l'étude seule.

| Sujet d'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Connectivité Cloud SQL (sockets, proxy sidecar) | ✅ | `enable_cloudsql_volume`, `cloudsql_volume_mount_path`, sidecar du proxy sur GKE | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.1 Intégration du stockage (GCS Fuse, NFS, Redis) | ✅ | `gcs_volumes`, `enable_nfs`, `enable_redis` | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.1 Code applicatif Pub/Sub et Firestore | 📘 | seuls des sujets de rotation/SCC existent — aucune messagerie applicative | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.2 Comptes de service, ADC, Workload Identity | ✅ | comptes de service par application, annotation KSA `iam.gke.io/gcp-service-account`, `additional_cloudrun_sa_roles` | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.2 Workload Identity Federation (CI sans clé) | ✅ | `enable_workload_identity_federation`, `wif_provider_type` | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.2 Activation des services ; modèles d'appel d'API (bibliothèques clientes, REST, gRPC, traitement par lots, pagination, backoff) | 📘 | la plateforme active ses propres API ; le code d'appel relève de l'étude seule | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.2 Authentification entre services (jetons d'identité) | 🟡 | liaisons `roles/run.invoker` (agent IAP, allUsers) ; le code d'appel relève de l'étude seule | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.3 Journalisation, métriques, alertes, tableaux de bord | ✅ | `support_users`, `alert_policies` (les couches de surveillance et de tableaux de bord de la plateforme) | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
| 4.3 Tests de disponibilité | ✅ | `uptime_check_config` crée un `<service>-uptime-check` + une règle d'alerte sur les points de terminaison accessibles publiquement | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
| 4.3 Instrumentation, ID de trace entre services, Error Reporting | 📘 | non implémenté — étude seule |
| 4.3 Observabilité assistée par l'IA (Gemini Cloud Assist) | 📘 | non implémenté — étude seule | [Guide de la section 4](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
