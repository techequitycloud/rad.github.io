---
title: "Carte des labs de la certification Professional Cloud DevOps Engineer (PDE)"
description: "Associez chaque domaine de l'examen Professional Cloud DevOps Engineer (PDE) à des labs de déploiement RAD pratiques sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PDE_Certification_Guide.md @ cb682e8 -->

# Carte des labs de la certification Professional Cloud DevOps Engineer (PDE) {#professional-cloud-devops-engineer-pde-certification-lab-map}

> 📚 **Guide officiel de l'examen :** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

:::note Ici, PDE signifie DevOps, pas Data
Sur ce site, **PDE** abrège la certification Google **Professional Cloud DevOps Engineer** (son nom officiel). Il ne s'agit *pas* de la certification Professional **Data** Engineer, que l'abréviation désigne parfois ailleurs dans l'univers de la préparation aux certifications.
:::



La certification Professional Cloud DevOps Engineer valide votre capacité à concevoir et gérer des pipelines CI/CD, à appliquer les pratiques SRE (SLO, budgets d'erreur, réponse aux incidents), à mettre en œuvre l'observabilité et à optimiser les performances et les coûts des services sur Google Cloud. Les quatre modules fondamentaux de la plateforme RAD — `Services_GCP` (infrastructure de plateforme partagée), `App_CloudRun` (moteur de déploiement Cloud Run v2), `App_GKE` (moteur de déploiement GKE Autopilot) et `App_Common` (briques partagées pour Cloud Deploy, la surveillance et les tableaux de bord) — vous offrent un lab réel et inspectable : chaque déclencheur Cloud Build, chaque étape Cloud Deploy, chaque règle d'alerte et chaque répartition du trafic abordés dans ce guide sont une infrastructure réelle que vous pouvez déployer, casser et réparer.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Choisissez un profil de déploiement ci-dessous et déployez-le depuis votre portail de déploiement.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** Lors de la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- Parcourez le guide de section correspondant (`PDE_Section_N_Exploration_Guide.md`) — chaque sous-section propose des étapes pratiques avec de vraies commandes `gcloud`, `kubectl` et `tofu`.
- Utilisez la légende de couverture en toute honnêteté : les sujets 📘 (l'essentiel de la théorie SRE pure et du processus de gestion des incidents) doivent être étudiés en dehors de la plateforme ; les guides de section donnent des pistes.
- La plateforme elle-même fait partie du lab — la section 1 traite les modules de déploiement comme l'artefact IaC sur lequel l'examen attend que vous raisonniez.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le dans la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non implémenté par les modules ; des pistes d'étude sont fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : ingénieur pipeline {#profile-pipeline-engineer}
*Objectif :* CI/CD de bout en bout — push GitHub → build Kaniko → Artifact Registry → attestation Binary Authorization → promotion Cloud Deploy avec une porte d'approbation en production.
*Modules :* `App_CloudRun` (éventuellement par-dessus `Services_GCP`).

| Variable | Valeur |
|---|---|
| `enable_cicd_trigger` | `true` |
| `github_repository_url` | `https://github.com/<you>/<repo>` |
| `github_token` | un PAT avec `repo` + `admin:repo_hook` (premier apply uniquement) |
| `enable_cloud_deploy` | `true` |
| `cicd_enable_cloud_deploy` | `true` |
| `enable_binary_authorization` | `true` |
| `binauthz_evaluation_mode` | `REQUIRE_ATTESTATION` |
| `support_users` | `["you@example.com"]` |

*Coût supplémentaire estimé :* faible à modéré — les minutes Cloud Build et le stockage Artifact Registry dominent ; Cloud Deploy lui-même n'ajoute aucun frais direct pour les cibles Cloud Run, vous payez les services Cloud Run de chaque étape.

### Profil : ingénieur de release GKE {#profile-gke-release-engineer}
*Objectif :* mises à jour progressives, HPA/VPA, PodDisruptionBudgets et Cloud Deploy vers des namespaces GKE.
*Modules :* `Services_GCP` + `App_GKE`.

| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `AUTOPILOT` (par défaut) |
| `min_instance_count` (App_GKE) | `2` |
| `max_instance_count` (App_GKE) | `4` |
| `enable_pod_disruption_budget` (App_GKE) | `true` (par défaut) |
| `enable_topology_spread` (App_GKE) | `true` |
| `enable_cicd_trigger` + `enable_cloud_deploy` (App_GKE) | `true` (facultatif, pour le chemin CD vers GKE) |

*Coût supplémentaire estimé :* modéré à élevé — GKE Autopilot facture selon les demandes de ressources de chaque pod, plus des frais de gestion du cluster ; plusieurs réplicas multiplient le coût.

### Profil : socle d'observabilité {#profile-observability-baseline}
*Objectif :* canaux de notification, règles d'alerte à seuil, tableaux de bord générés automatiquement et journalisation d'audit complète à explorer dans Logs Explorer.
*Modules :* `Services_GCP` + l'un ou l'autre des moteurs d'application.

| Variable | Valeur |
|---|---|
| `support_users` (module applicatif) | `["you@example.com"]` |
| `alert_policies` (module applicatif) | une entrée, par ex. sur `run.googleapis.com/request_count` |
| `configure_email_notification` (Services_GCP) | `true` |
| `notification_alert_emails` (Services_GCP) | `["ops@example.com"]` |
| `alert_cpu_threshold` / `alert_memory_threshold` / `alert_disk_threshold` (Services_GCP) | `80` (valeurs par défaut) |
| `enable_audit_logging` | `true` |

*Coût supplémentaire estimé :* faible — la journalisation d'audit (`DATA_READ`/`DATA_WRITE` sur `allServices`) est le facteur dominant, via le volume d'ingestion Cloud Logging.

### Profil : serverless économe {#profile-cost-lean-serverless}
*Objectif :* économie du scale-to-zero, limitation du CPU, élagage des révisions et règles de nettoyage Artifact Registry pour la section 5.
*Modules :* `App_CloudRun` uniquement.

| Variable | Valeur |
|---|---|
| `min_instance_count` | `0` (par défaut) |
| `max_instance_count` | `3` |
| `cpu_always_allocated` | `false` |
| `max_revisions_to_retain` | `7` (par défaut) |
| `delete_untagged_images` | `true` (par défaut) |
| `image_retention_days` | `30` (par défaut) |

*Coût supplémentaire estimé :* minimal — le service redescend à zéro entre les requêtes ; seuls le stockage et le calcul par requête s'accumulent.

## Section 1 : Amorcer et maintenir une organisation Google Cloud (Bootstrapping and maintaining a Google Cloud organization) (~20 % de l'examen) {#section-1-bootstrapping-and-maintaining-a-google-cloud-organization-20-of-the-exam}

L'examen commence par la conception au niveau de l'organisation : hiérarchie des ressources, discipline IaC, choix d'architecture CI/CD, gestion multi-environnement et environnements de développement cloud sécurisés. Les modules RAD sont eux-mêmes l'artefact IaC, et le modèle d'étapes de Cloud Deploy sert de lab multi-environnement.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Concevoir la hiérarchie globale des ressources d'une organisation (Designing the overall resource hierarchy for an organization) | 📘 | portée limitée au projet ; `resource_labels` pour les libellés de gouvernance ; appairage de l'accès aux services privés dans `Services_GCP` | [Guide de la section 1](PDE_Section_1_Exploration_Guide.md#11-designing-the-overall-resource-hierarchy-for-an-organization) |
| 1.2 Gérer l'infrastructure (Managing infrastructure) | ✅ | les modules de déploiement eux-mêmes ; détection de dérive avec `tofu plan` ; Cloud Deploy gère l'image de conteneur tandis que l'IaC gère le reste ; contrôles CI de l'IaC | [Guide de la section 1](PDE_Section_1_Exploration_Guide.md#12-managing-infrastructure) |
| 1.3 Concevoir une pile d'architecture CI/CD dans Google Cloud et dans des environnements hybrides et multicloud (Designing a CI/CD architecture stack in Google Cloud, hybrid, and multi-cloud environments) | ✅ | déclencheur Cloud Build inline, pipeline de livraison Cloud Deploy, Binary Authorization ; hybride/multicloud et outils tiers 📘 | [Guide de la section 1](PDE_Section_1_Exploration_Guide.md#13-designing-a-cicd-architecture-stack-in-google-cloud-hybrid-and-multi-cloud-environments) |
| 1.4 Gérer plusieurs environnements (Managing multiple environments) | ✅ | `cloud_deploy_stages` (dev/staging/prod), services et namespaces par étape ; canal de release GKE et piste de maintenance Cloud SQL ; parcs (fleets) uniquement dans un projet que vous apportez | [Guide de la section 1](PDE_Section_1_Exploration_Guide.md#14-managing-multiple-environments) |
| 1.5 Mettre en place des environnements de développement cloud sécurisés (Enabling secure cloud development environments) | 🟡 | wrappers `CodeServer_*` / `Coder_*` comme équivalent auto-hébergé ; Cloud Workstations, Cloud Shell et Gemini 📘 | [Guide de la section 1](PDE_Section_1_Exploration_Guide.md#15-enabling-secure-cloud-development-environments) |

## Section 2 : Concevoir et mettre en œuvre des pipelines CI/CD, y compris les tests continus, pour les charges de travail applicatives, d'infrastructure et de machine learning (Building and implementing CI/CD pipelines, including continuous testing, for application, infrastructure, and machine learning workloads) (~25 % de l'examen) {#section-2-building-and-implementing-cicd-pipelines-including-continuous-testing-for-application-infrastructure-and-machine-learning-workloads-25-of-the-exam}

À égalité avec la section 4 comme section la plus lourde de l'examen, et point fort du lab RAD : un pipeline Cloud Build inline (Kaniko → attestation → déploiement), Artifact Registry avec règles de nettoyage, Binary Authorization et un vrai pipeline Cloud Deploy avec approbations, règles d'automatisation et retour arrière. Les tests continus mentionnés dans le titre, ainsi que ses charges de travail d'infrastructure et de ML, sont 📘 : le pipeline RAD n'exécute aucune étape de test et ne construit que des conteneurs applicatifs.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Concevoir des pipelines (Designing pipelines) | ✅ | `enable_cicd_trigger`, étape de build Kaniko v1.23.2, règles de nettoyage Artifact Registry | [Guide de la section 2](PDE_Section_2_Exploration_Guide.md#21-designing-pipelines) |
| 2.2 Mettre en œuvre et gérer des pipelines (Implementing and managing pipelines) | ✅ | `cloud_deploy_stages`, `traffic_split`, chemin direct `kubectl set image`, élagage des révisions ; audit des déploiements via `enable_audit_logging` et l'historique des releases Cloud Deploy | [Guide de la section 2](PDE_Section_2_Exploration_Guide.md#22-implementing-and-managing-pipelines) |
| 2.3 Gérer la configuration et les secrets des pipelines (Managing pipeline configuration and secrets) | ✅ | `github_token` (jamais dans l'état), `secret_environment_variables`, `enable_auto_password_rotation`, Cloud KMS, Certificate Manager sur la Gateway GKE ; Parameter Manager 📘 | [Guide de la section 2](PDE_Section_2_Exploration_Guide.md#23-managing-pipeline-configuration-and-secrets) |
| 2.4 Sécuriser le pipeline de déploiement (Securing the deployment pipeline) | 🟡 | `enable_vulnerability_scanning`, attestations Binary Authorization, compte de service de build dédié ; signature conditionnée à l'analyse, SLSA et IAM par environnement 📘 | [Guide de la section 2](PDE_Section_2_Exploration_Guide.md#24-securing-the-deployment-pipeline) |

## Section 3 : Appliquer les pratiques d'ingénierie de la fiabilité des sites (Applying site reliability engineering practices) (~18 % de l'examen) {#section-3-applying-site-reliability-engineering-practices-18-of-the-exam}

La théorie des SLO et des budgets d'erreur est essentiellement 📘 — les modules émettent les métriques à partir desquelles les SLI sont construits, mais ne créent pas d'objets SLO. La gestion de la capacité et l'atténuation des incidents, en revanche, sont entièrement pratiques : autoscaling, PDB, répartition du trafic et retour arrière instantané.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Équilibrer le changement, la vélocité et la fiabilité du service (Balancing change, velocity, and reliability of the service) | 📘 | alertes à seuil en guise de proto-SLI ; aucun objet SLO ni budget d'erreur | [Guide de la section 3](PDE_Section_3_Exploration_Guide.md#31-balancing-change-velocity-and-reliability-of-the-service) |
| 3.2 Gérer le cycle de vie du service (Managing service lifecycle) | ✅ | `min_instance_count`/`max_instance_count`, HPA GKE (CPU 70 % / mémoire 80 %), `enable_vertical_pod_autoscaling` | [Guide de la section 3](PDE_Section_3_Exploration_Guide.md#32-managing-service-lifecycle) |
| 3.3 Atténuer l'impact des incidents sur les utilisateurs (Mitigating incident impact on users) | ✅ | retour arrière par `traffic_split`, retour arrière Cloud Deploy, `enable_pod_disruption_budget`, sondes, limitation de débit Cloud Armor | [Guide de la section 3](PDE_Section_3_Exploration_Guide.md#33-mitigating-incident-impact-on-users) |

## Section 4 : Mettre en œuvre les pratiques d'observabilité et résoudre les problèmes (Implementing observability practices and troubleshooting issues) (~25 % de l'examen) {#section-4-implementing-observability-practices-and-troubleshooting-issues-25-of-the-exam}

À égalité avec la section 2 comme section la plus lourde. Les modules provisionnent des canaux de notification, des règles d'alerte fixes et personnalisées, des tableaux de bord par plateforme, la journalisation des charges de travail GKE, Prometheus géré, des tests de disponibilité synthétiques (`uptime_check_config` — créés pour les points de terminaison accessibles publiquement, avec une règle d'alerte `check_passed`) et, en option, des journaux d'audit complets d'accès aux données. Le routage et la conservation des journaux, le traçage distribué et Gemini Cloud Assist sont 📘.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Instrumenter et collecter la télémétrie (Instrumenting and collecting telemetry) | 🟡 | journalisation/surveillance des charges de travail GKE + Prometheus géré sur le cluster Services_GCP ; `enable_audit_logging` ; tests synthétiques `uptime_check_config` | [Guide de la section 4](PDE_Section_4_Exploration_Guide.md#41-instrumenting-and-collecting-telemetry) |
| 4.2 Gérer et analyser les journaux (Managing and analyzing logs) | 🟡 | charges de travail libellées et journaux de build `CLOUD_LOGGING_ONLY` à interroger dans Logs Explorer ; récepteurs (sinks), conservation, masquage des données personnelles et Gemini Cloud Assist 📘 | [Guide de la section 4](PDE_Section_4_Exploration_Guide.md#42-managing-and-analyzing-logs) |
| 4.3 Gérer les métriques, les tableaux de bord et les alertes (Managing metrics, dashboards, and alerts) | ✅ | la couche de surveillance (alertes CPU/mémoire à 90 %, nouvelle notification toutes les 1800s), `alert_policies`, tableaux de bord générés automatiquement, alertes à seuil Services_GCP, `create_billing_budget` ; canaux tiers 📘 | [Guide de la section 4](PDE_Section_4_Exploration_Guide.md#43-managing-metrics-dashboards-and-alerts) |
| 4.4 Capturer et analyser des traces distribuées (Capturing and analyzing distributed traces) | 📘 | aucun traçage configuré ; Cloud Run propage le contexte de trace pour les applications instrumentées | [Guide de la section 4](PDE_Section_4_Exploration_Guide.md#44-capturing-and-analyzing-distributed-traces) |
| 4.5 Résoudre les problèmes (Troubleshooting issues) | 🟡 | conditions de révision, événements de pod, journaux de build Cloud Logging sur les charges de travail déployées par les modules | [Guide de la section 4](PDE_Section_4_Exploration_Guide.md#45-troubleshooting-issues) |

## Section 5 : Optimiser les performances et les coûts (Optimizing performance and cost) (~12 % de l'examen) {#section-5-optimizing-performance-and-cost-12-of-the-exam}

Le réglage des performances (environnement d'exécution, allocation du CPU, demandes de ressources) est entièrement démontré ; les outils FinOps (export de facturation, Recommender, CUD) sont 📘, les modules fournissant les leviers que ces outils recommanderaient d'actionner.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 5.1 Collecter des informations de performance dans Google Cloud (Collecting performance information in Google Cloud) | 🟡 | `execution_environment`, `cpu_always_allocated`, `container_resources`, Prometheus géré ; Trace/Profiler et Active Assist 📘 | [Guide de la section 5](PDE_Section_5_Exploration_Guide.md#51-collecting-performance-information-in-google-cloud) |
| 5.2 Mettre en œuvre les pratiques FinOps pour optimiser l'utilisation des ressources et les coûts (Implementing FinOps practices for optimizing resource utilization and costs) | 🟡 | scale-to-zero, CPU alloué uniquement pendant les requêtes, VPA, règles de nettoyage AR, répartition des coûts GKE, `create_billing_budget` ; export de facturation, recommandations, CUD/SUD, VM Spot 📘 | [Guide de la section 5](PDE_Section_5_Exploration_Guide.md#52-implementing-finops-practices-for-optimizing-resource-utilization-and-costs) |
