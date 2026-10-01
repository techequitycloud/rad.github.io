---
title: "Carte des labs de la certification Professional Cloud Security Engineer (PSE)"
description: "Associez chaque domaine de l'examen Professional Cloud Security Engineer (PSE) à des labs de déploiement RAD pratiques sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PSE_Certification_Guide.md @ cb682e8 -->

# Carte des labs de la certification Professional Cloud Security Engineer (PSE) {#professional-cloud-security-engineer-pse-certification-lab-map}

> 📚 **Guide officiel de l'examen :** [certification Professional Cloud Security Engineer](https://cloud.google.com/learn/certification/cloud-security-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

La certification PSE valide votre capacité à concevoir et à mettre en œuvre des charges de travail et une infrastructure sécurisées sur Google Cloud — gestion des identités et des accès, protection du périmètre et des frontières, protection des données, opérations de sécurité et conformité réglementaire. Les quatre modules fondamentaux de la plateforme RAD (`Services_GCP`, `App_CloudRun`, `App_GKE`, `App_Common`) forment un lab de sécurité vivant : ils mettent en œuvre des comptes de service au moindre privilège, Workload Identity, IAP, Secret Manager avec rotation automatisée sans interruption de service, CMEK avec récupération de clé au moment du plan, Binary Authorization avec un signataire KMS et un attesteur, VPC Service Controls avec niveaux d'accès et mode simulation (dry-run), le WAF Cloud Armor, la micro-segmentation par NetworkPolicy Kubernetes, la configuration des journaux d'audit et l'inscription à Security Command Center — le tout piloté par des variables du portail que vous pouvez activer et observer.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** À la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- **Certains paramètres exigent un projet que vous apportez.** Lorsqu'un déploiement est placé dans un projet géré par RAD (un projet que RAD crée pour vous), le formulaire de déploiement omet tous les paramètres qu'un module signale comme indisponibles dans ce cas — des paramètres qui débordent du projet vers l'organisation de RAD, ou qui nécessitent une API que les paliers gérés par RAD n'autorisent pas. Dans ce guide, cela concerne les paramètres VPC Service Controls (`enable_vpc_sc`, `vpc_sc_dry_run`, `vpc_cidr_ranges`, `organization_id`, et `admin_ip_ranges` de `Services_GCP`), la paire Security Command Center (`enable_security_command_center`, `enable_scc_notifications`), Workload Identity Federation (`enable_workload_identity_federation` et les paramètres `wif_*`) ainsi que `configure_policy_controller` ; déployez les profils et labs qui les définissent dans un projet Google Cloud qui vous appartient.
- Parcourez le guide de section correspondant (`PSE_Section_<N>_Exploration_Guide.md`) sujet par sujet.
- Servez-vous de la légende de couverture pour savoir quels sujets de l'examen vous devez étudier en dehors de la plateforme — les guides de section donnent des pistes d'étude concrètes pour chaque sujet 🟡 et 📘.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le sur la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non mis en œuvre par les modules ; pistes d'étude fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : secure-platform {#profile-secure-platform}
*Objectif :* une plateforme partagée renforcée qui met en œuvre CMEK, la journalisation d'audit, SCC, l'analyse des vulnérabilités et Binary Authorization.
*Modules :* `Services_GCP`. Les deux paramètres SCC ne sont proposés que dans un projet que vous apportez ; dans un projet géré par RAD, déployez le reste du profil sans eux.
| Variable | Valeur |
|---|---|
| `create_postgres` | `true` (par défaut) |
| `enable_cmek` | `true` |
| `cmek_key_rotation_period` | `7776000s` (par défaut, 90 jours) |
| `enable_audit_logging` | `true` |
| `enable_security_command_center` | `true` |
| `enable_scc_notifications` | `true` |
| `enable_vulnerability_scanning` | `true` |
| `enable_binary_authorization` | `true` |
| `binauthz_evaluation_mode` | `REQUIRE_ATTESTATION` |
*Coût supplémentaire estimé :* faible à modéré — les clés KMS coûtent quelques centimes par mois ; les principaux facteurs sont le coût de base de l'instance Cloud SQL et le volume accru de Cloud Logging dû aux journaux d'audit DATA_READ/DATA_WRITE.

### Profil : guarded-edge {#profile-guarded-edge}
*Objectif :* un service Cloud Run protégé par IAP, un WAF Cloud Armor derrière un équilibreur de charge HTTPS global, et la rotation automatisée des secrets.
*Modules :* `App_CloudRun` (éventuellement par-dessus secure-platform).
| Variable | Valeur |
|---|---|
| `enable_iap` | `true` |
| `iap_authorized_users` | `["user:you@example.com"]` |
| `enable_cloud_armor` | `true` |
| `application_domains` | `["app.example.com"]` (obligatoire lorsque Cloud Armor est activé) |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `2592000s` (par défaut, 30 jours) |
| `enable_audit_logging` | `true` |
*Coût supplémentaire estimé :* modéré — les règles de transfert de l'équilibreur de charge d'application externe global et la stratégie Cloud Armor sont les principaux facteurs ; IAP et la rotation Secret Manager sont négligeables.

### Profil : zero-trust-gke {#profile-zero-trust-gke}
*Objectif :* une charge de travail GKE Autopilot avec Workload Identity, micro-segmentation par NetworkPolicy, quotas d'espace de noms et IAP au niveau de la Gateway.
*Modules :* `Services_GCP` + `App_GKE`.
| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `enable_network_segmentation` | `true` |
| `enable_resource_quota` | `true` |
| `enable_custom_domain` | `true` + `application_domains` |
| `enable_cloud_armor` | `true` |
| `enable_iap` | `true` + `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email` |
*Coût supplémentaire estimé :* élevé — le cluster GKE Autopilot est le principal facteur de coût ; l'équilibreur de charge de la Gateway et Cloud Armor ajoutent un surcoût modéré.

### Profil : perimeter-lab {#profile-perimeter-lab}
*Objectif :* un périmètre VPC Service Controls en mode simulation (dry-run) autour des API du projet. Nécessite un projet qui vous appartient (ces paramètres ne sont pas proposés dans un projet géré par RAD) au sein d'une organisation GCP, ainsi qu'une autorisation Access Context Manager au niveau de l'organisation.
*Modules :* `Services_GCP`, `App_CloudRun` ou `App_GKE` (chacun peut créer son propre périmètre).
| Variable | Valeur |
|---|---|
| `enable_vpc_sc` | `true` |
| `admin_ip_ranges` | `["<your-public-ip>/32"]` (obligatoire — sans cette valeur, le périmètre n'est pas créé) |
| `vpc_sc_dry_run` | `true` (par défaut — auditer avant d'appliquer) |
| `organization_id` (App_CloudRun / App_GKE uniquement) | à définir uniquement si le projet est imbriqué dans un dossier |
*Coût supplémentaire estimé :* aucun — VPC-SC, les niveaux d'accès et Access Context Manager sont gratuits.

## Section 1 : Configuration de l'accès (Configuring access) (~25 % de l'examen) {#section-1-configuring-access-25-of-the-exam}

L'identité et l'autorisation constituent le domaine où les modules sont les plus solides côté « identité des charges de travail » (comptes de service dédiés, Workload Identity, IAM par ressource) et les plus faibles côté « identité humaine » (Cloud Identity, SSO, règles d'administration), que vous devez étudier séparément.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Gestion de Cloud Identity (Managing Cloud Identity) | 📘 | identités consommées via `iap_authorized_users/groups`, `support_users` | [Guide de la section 1](PSE_Section_1_Exploration_Guide.md#11-managing-cloud-identity) |
| 1.2 Gestion des comptes de service (Managing service accounts) | ✅ | comptes de service dédiés avec Workload Identity ; WIF via `enable_workload_identity_federation` + `wif_provider_type` (votre propre projet uniquement) | [Guide de la section 1](PSE_Section_1_Exploration_Guide.md#12-managing-service-accounts) |
| 1.3 Gestion de l'authentification (Managing authentication) | 🟡 | `enable_iap` sur Cloud Run et GKE | [Guide de la section 1](PSE_Section_1_Exploration_Guide.md#13-managing-authentication) |
| 1.4 Gestion et mise en œuvre des contrôles d'autorisation (Managing and implementing authorization controls) | ✅ | la couche IAM au niveau des ressources de la plateforme, IAM par secret/par bucket ; niveaux d'accès Access Context Manager via `enable_vpc_sc` (votre propre projet uniquement) ; IAM Conditions, les stratégies de refus, PAM et Policy Intelligence sont 📘 | [Guide de la section 1](PSE_Section_1_Exploration_Guide.md#14-managing-and-implementing-authorization-controls) |
| 1.5 Définition de la hiérarchie des ressources (Defining the resource hierarchy) | 📘 | la détection organisation/dossier/projet autonome dans la couche VPC Service Controls, ainsi que les règles de dossier héritées par un projet géré par RAD, sont les éléments les plus proches | [Guide de la section 1](PSE_Section_1_Exploration_Guide.md#15-defining-the-resource-hierarchy) |

## Section 2 : Sécurisation des communications et mise en place de la protection des frontières (Securing communications and establishing boundary protection) (~22 % de l'examen) {#section-2-securing-communications-and-establishing-boundary-protection-22-of-the-exam}

Les modules mettent en œuvre trois couches de frontière distinctes que vous pouvez déployer et mettre en défaut volontairement : un WAF en périphérie (Cloud Armor + équilibreur de charge HTTPS global), un périmètre contre l'exfiltration de données au niveau des API (VPC Service Controls) et une micro-segmentation au niveau des pods (NetworkPolicy Kubernetes sur Dataplane V2).

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Conception et configuration de la sécurité du périmètre (Designing and configuring perimeter security) | ✅ | `enable_cloud_armor` sur Cloud Run et GKE, IAP, l'équilibreur de charge HTTPS global ; les stratégies Cloud NGFW / l'inspection L7, Secure Web Proxy et la sécurité Cloud DNS sont 📘 | [Guide de la section 2](PSE_Section_2_Exploration_Guide.md#21-designing-and-configuring-perimeter-security) |
| 2.2 Configuration de la segmentation des frontières (Configuring boundary segmentation) | ✅ | `enable_vpc_sc` (votre propre projet uniquement), `enable_network_segmentation` (NetworkPolicy Kubernetes), Cloud SQL en adresse IP privée | [Guide de la section 2](PSE_Section_2_Exploration_Guide.md#22-configuring-boundary-segmentation) |
| 2.3 Mise en place d'une connectivité privée (Establishing private connectivity) | 🟡 | sortie VPC directe (Direct VPC egress), Private Services Access, Private Google Access sur les sous-réseaux, Cloud NAT ; VPN / Interconnect / PSC sont 📘 | [Guide de la section 2](PSE_Section_2_Exploration_Guide.md#23-establishing-private-connectivity) |

## Section 3 : Garantie de la protection des données (Ensuring data protection) (~23 % de l'examen) {#section-3-ensuring-data-protection-23-of-the-exam}

Secret Manager avec rotation automatisée à double version et CMEK avec récupération de clé au moment du plan sont ici les labs pratiques phares. Sensitive Data Protection et les contrôles propres à l'IA (Model Armor, Gemini Enterprise Agent Platform) relèvent du concept uniquement.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Protection des données sensibles et prévention de la perte de données (Protecting sensitive data and preventing data loss) | 🟡 | pipeline de rotation Secret Manager, `enable_auto_password_rotation` ; OS Login + Shielded VM sur le modèle d'instance du serveur NFS ; Sensitive Data Protection est 📘 | [Guide de la section 3](PSE_Section_3_Exploration_Guide.md#31-protecting-sensitive-data-and-preventing-data-loss) |
| 3.2 Gestion du chiffrement au repos, en transit et en cours d'utilisation (Managing encryption at rest, in transit, and in use) | ✅ | `enable_cmek`, TLS au niveau de l'équilibreur de charge, règles de cycle de vie Cloud Storage (`backup_retention_days`, `storage_buckets`) ; EKM/HSM/importation de clés/Confidential Computing sont 📘 | [Guide de la section 3](PSE_Section_3_Exploration_Guide.md#32-managing-encryption-at-rest-in-transit-and-in-use) |
| 3.3 Sécurisation des charges de travail d'IA (Securing AI workloads) | 📘 | aucun contrôle propre à l'IA dans les modules ; les applications d'IA auto-hébergées (par ex. `Ollama_GKE`, `LiteLLM_CloudRun`) héritent des contrôles génériques | [Guide de la section 3](PSE_Section_3_Exploration_Guide.md#33-securing-ai-workloads) |

## Section 4 : Gestion des opérations (Managing operations) (~19 % de l'examen) {#section-4-managing-operations-19-of-the-exam}

La chaîne d'approvisionnement logicielle est entièrement câblée : Cloud Build → analyse Artifact Registry → attestation signée par KMS → application de l'admission par Binary Authorization. La détection est couverte par la configuration des journaux d'audit et par les résultats SCC acheminés vers Pub/Sub.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Automatisation de la sécurité de l'infrastructure et des applications (Automating infrastructure and application security) | ✅ | `enable_binary_authorization`, `enable_vulnerability_scanning`, attestation CI/CD ; la gestion de la posture de sécurité et les modules personnalisés Security Health Analytics sont 📘 | [Guide de la section 4](PSE_Section_4_Exploration_Guide.md#41-automating-infrastructure-and-application-security) |
| 4.2 Configuration de la journalisation, de la surveillance et de la détection (Configuring logging, monitoring, and detection) | 🟡 | `enable_audit_logging`, `enable_security_command_center` + `enable_scc_notifications` (votre propre projet uniquement), journaux de requêtes de l'équilibreur de charge ; journaux de flux / récepteurs (sinks) / Cloud IDS / Packet Mirroring sont 📘 | [Guide de la section 4](PSE_Section_4_Exploration_Guide.md#42-configuring-logging-monitoring-and-detection) |

## Section 5 : Prise en charge des exigences de conformité (Supporting compliance requirements) (~11 % de l'examen) {#section-5-supporting-compliance-requirements-11-of-the-exam}

Les modules démontrent les contrôles techniques qu'exigent les référentiels de conformité (CMEK, pistes d'audit, moindre privilège, périmètres) ainsi que la réduction du périmètre de responsabilité partagée qu'apporte GKE Autopilot — mais la mise en correspondance avec les référentiels, Assured Workloads, Access Transparency et Access Approval sont des sujets d'étude uniquement.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 5.1 Respect des exigences réglementaires et des normes sectorielles pour le cloud (Adhering to regulatory and industry standards requirements for the cloud) | 🟡 | contrôles combinés des quatre modules, placement régional ; Assured Workloads / Access Transparency / Access Approval sont 📘 | [Guide de la section 5](PSE_Section_5_Exploration_Guide.md#51-adhering-to-regulatory-and-industry-standards-requirements-for-the-cloud) |
