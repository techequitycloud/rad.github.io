---
title: "Project GCP — Garde-fous de bac à sable de niveau 0"
description: "Référence de configuration du module RAD Project GCP — le module de niveau 0 qui définit la liste d'API autorisées, les plafonds de quotas et la création facultative du projet bac à sable, appliqué avant Services GCP."
---

<!-- translated-from: docs/modules/Project_GCP.md @ 3055034 sha256:844bf7a11215 -->

# Project GCP — Garde-fous de bac à sable de niveau 0 {#project-gcp--tier-0-sandbox-guardrails}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Project_GCP.png" alt="Project GCP — Garde-fous de bac à sable de niveau 0" style={{maxWidth: "100%", borderRadius: "8px"}} />

`Project GCP` est le module de **niveau 0** (Tier-0) de la plateforme — le seul module de ce catalogue appliqué *avant* `Services GCP`. Il ne déploie ni application ni infrastructure applicative partagée ; il renforce le **projet lui-même** : quelles API Google Cloud ont le droit d'être activées, un ensemble de plafonds de quotas auto-imposés et — de manière facultative — la création du projet bac à sable ainsi que d'une identité de déploiement au moindre privilège pour opérer à l'intérieur une fois celui-ci créé.

**Ordre de déploiement :**

```
Project GCP  →  Services GCP  →  App CloudRun / App GKE  →  Application Modules
```

Contrairement à tous les autres modules de ce catalogue, `Project GCP` n'est pas destiné à être exécuté par la même identité, le même pipeline ou la même action accessible aux stagiaires que ceux qui déploient les applications — voir « Deux identités, délibérément séparées » ci-dessous.

---

## Ce qu'il gère {#what-it-manages}

| Fichier | Ressource | Régit |
|---|---|---|
| `apis.tf` | `google_project_service` | Les API Google Cloud activées sur le projet cible |
| `quotas.tf` | `google_cloud_quotas_quota_preference` | Les plafonds de quotas auto-imposés (CPU régional Cloud Run, CPU régional Compute Engine, GPU à l'échelle du projet, mémoire régionale Redis, trois niveaux Filestore, un plafond d'analyse quotidienne BigQuery en development/production et 81 quotas d'accélérateurs Vertex AI) |
| `project.tf` | `google_project`, `google_project_iam_member`, `google_iam_deny_policy`, `google_resource_manager_lien` | La création facultative du projet, l'IAM au moindre privilège pour une identité de déploiement distincte, une règle de refus (deny policy) qui empêche cette identité de relever ses propres plafonds de quotas, et un privilège de suppression (lien) |
| `validation.tf` | blocs `check` | Des gardes de non-régression au moment du plan (le socle d'API ne peut jamais rétrécir ; `create_project` exige ses variables d'identité associées) |
| `budget.tf` | `google_billing_budget` | Un budget de facturation limité au projet créé, afin qu'une alerte de dépenses désigne le bac à sable d'un seul utilisateur |

**Les garde-fous de règles d'administration au niveau des dossiers (refus des IP externes, restrictions sur les clés de comptes de service, liste d'autorisation `gcp.restrictServiceUsage`, etc.) ne sont *pas* gérés par ce module** — voir « Règles d'administration au niveau des dossiers » ci-dessous.

---

## Pourquoi un module distinct, appliqué par une identité distincte {#why-a-separate-module-applied-by-a-separate-identity}

Tous les autres modules de ce catalogue supposent une identité de déploiement limitée au projet. `Project GCP` a besoin d'une IAM au niveau de l'*organisation ou du dossier* (`orgpolicy.policyAdmin`/`iam.denyAdmin` limités à l'organisation, des autorisations de la classe `serviceusage.serviceUsageAdmin` pour écrire les listes d'API autorisées et les préférences de quotas) — un niveau de confiance sensiblement différent de tout ce qui se trouve en aval. Il est conçu pour être appliqué par un administrateur de la plateforme empruntant l'identité d'un compte de service dédié, utilisable uniquement par emprunt d'identité (`rad-guardrails-admin` dans le déploiement propre à cette plateforme), et jamais relié à un déclencheur Cloud Build, une Cloud Function ou un chemin Pub/Sub qu'une action de stagiaire pourrait atteindre. Une identité capable à la fois d'exécuter du Terraform arbitraire à la demande *et* de réécrire les propres garde-fous de l'organisation réduirait à néant la raison d'être de ces garde-fous.

---

## Deux identités, délibérément séparées {#two-identities-deliberately-separate}

| Identité | Variable | Rôle |
|---|---|---|
| **Créateur de ressources** | `resource_creator_identity` | Identité empruntée pour *exécuter* ce module. Applique la liste d'API autorisées et les préférences de quotas ; lorsque `create_project = true`, crée le projet lui-même (GCP lui accorde automatiquement `roles/owner` sur le projet qu'il crée — il n'existe aucun moyen documenté de l'empêcher). |
| **Identité de déploiement** | `deploying_identity_email` | L'identité qui exécute réellement les déploiements de `Services GCP` / des modules applicatifs *à l'intérieur* du nouveau projet une fois celui-ci créé. Reçoit l'ensemble de rôles `deploying_identity_bundle` ci-dessous — **jamais** Owner. |
| **Demandeur (humain)** | `deployed_by_email` | La personne qui a demandé le déploiement. Reçoit un ensemble de rôles **dépendant du palier** : lecture seule en `sandbox` et `lab` ; lecture seule plus des rôles d'opérateur en `production` ; lecture seule plus des rôles de build et de déploiement en `development`. |

Cette séparation est l'objectif même : l'identité qui définit les garde-fous n'est jamais la même — ni accessible par le même chemin déclenché par un utilisateur — que celle qui opère à l'intérieur.

---

## La liste d'API autorisées à socle additif {#the-additive-floor-api-allowlist}

`apis.tf` active un socle d'API codé en dur (`local.baseline_required_apis` dans `main.tf`) fusionné avec `var.additional_apis` — la variable ne peut qu'**ajouter** au socle ; rien dans ce module ne peut le réduire. Le contrôle `api_floor_never_shrinks` de `validation.tf` existe uniquement comme garde de non-régression contre une future modification qui introduirait accidentellement un filtre ou une soustraction.

Le socle a été vérifié par grep dans `Services_GCP`, `App_CloudRun` et `App_GKE` — l'ensemble réel des chaînes `*.googleapis.com` lues par une ressource de ces trois modules — et non la liste plus longue que les `default_apis` de `Services_GCP` activent (qui active aussi plusieurs API qu'aucune ressource de ces trois modules n'utilise, par exemple Gmail, Calendar, Docs, Drive, Vertex AI) :

```
billingbudgets · compute · servicenetworking · sqladmin · run · cloudbuild
artifactregistry · secretmanager · iam · iamcredentials · file · redis
cloudresourcemanager · logging · monitoring · storage · cloudscheduler
certificatemanager · iap · binaryauthorization · eventarc · container
cloudkms · containeranalysis · ondemandscanning · pubsub · accesscontextmanager
clouddeploy · securitycenter · gkebackup · firestore · dns · servicedirectory
gkehub · gkeconnect · anthosconfigmanagement · anthospolicycontroller · mesh
```

Cela fait 38 API (chaque entrée ci-dessus correspond à `<name>.googleapis.com`), vérifié le 2026-08-13 en comptant `local.baseline_required_apis` dans `main.tf`. Ajoutez tout ce dont une intégration propre à une application a besoin au-delà de ce socle — par exemple `aiplatform.googleapis.com` pour une application adossée à Vertex AI — via `additional_apis` ; l'ajout est automatiquement intégré à la fois à l'activation et à la sortie de la liste d'autorisation.

Deux entrées ont un historique bon à connaître. **`alloydb` a été retiré** le 2026-08-11, lorsqu'AlloyDB a été supprimé des listes d'autorisation des dossiers sandbox/development et ajouté à la liste de refus de production, sur décision explicite de coûts — le laisser dans le socle ferait échouer `google_project_service` sur tout projet neuf. **`billingbudgets` a été ajouté** parce que l'appel `google_billing_budget` de `budget.tf` est imputé en quota à *ce* projet ; sans lui, l'apply échoue avec un simple `Error 403: The caller does not have permission`, qui ressemble à un problème d'IAM mais n'en est pas un (confirmé en conditions réelles le 2026-08-11 sur les déploiements 605ab251 et d5f4b359). Un retiré, un ajouté — c'est pourquoi le total reste de 38.

**`dns` et `servicedirectory` figurent dans le socle parce que la création d'un cluster GKE Autopilot les appelle sans condition**, et non parce qu'un module les configure. Autopilot provisionne une zone gérée Cloud DNS limitée au VPC pour le DNS du cluster, et appelle Service Directory (`ManagedResourceService.AddServiceBundle`) pendant la mise en service du cluster. Aucun des deux n'est facultatif et il est impossible de s'en dispenser. Omettre `dns` bloque purement et simplement la création de `google_container_cluster` avec `Error 403: Request is disallowed by organization's constraints/gcp.restrictServiceUsage constraint ... attempting to use service 'dns.googleapis.com'` ; omettre `servicedirectory` laisse le cluster bloqué à l'état `ERROR` avec le message équivalent pour `servicedirectory.googleapis.com`. Les deux cas ont été confirmés en conditions réelles lors du déploiement d'un module GKE dans un projet géré par RAD.

**Cela active l'API sur le projet.** Cela ne décide pas, à soi seul, si l'API est *autorisée* — voir la section suivante.

---

## Règles d'administration au niveau des dossiers (non gérées ici) {#folder-level-org-policies-not-managed-here}

Les garde-fous de règles d'administration limités aux dossiers — refus de `compute.vmExternalIpAccess`, création/import de clés de comptes de service désactivés, restriction des IP publiques Cloud SQL et (la restriction complémentaire de la propre liste d'API autorisées de ce module) `gcp.restrictServiceUsage`, qui contrôle quelles API ont *le droit d'être activées n'importe où dans le dossier* — étaient à l'origine implémentés dans ce module, puis en ont été retirés.

**Pourquoi ils ont été retirés :** GCP n'autorise qu'un seul objet de règle par paire `(folder, constraint)`. Chaque projet bac à sable partageant un dossier avait son propre état Terraform persuadé de posséder exactement la même ressource limitée au dossier — ce qui a été confirmé en conditions réelles comme source de dérive réelle (l'apply d'un projet écrasant silencieusement la règle de dossier d'un autre) et, pire, signifiait que démanteler l'état d'*un seul* projet bac à sable supprimait la règle partagée pour tous les autres projets de ce dossier.

Les garde-fous au niveau des dossiers résident désormais dans `rad-automation/scripts/02-setup-ui.sh` (étape 10, « Enable organization level configuration and deployments »), appliqués **une seule fois par dossier** lors de la configuration via des appels `gcloud org-policies set-policy` bruts — découplés du cycle de vie Terraform de tout projet bac à sable individuel. Chaque nouveau projet bac à sable créé sous ce dossier hérite automatiquement des règles grâce à la hiérarchie de règles de GCP ; vous n'avez pas besoin de les réappliquer par projet (et vous ne le pouvez pas depuis ce module).

Une API activée par ce module (`apis.tf`) mais *absente* de la liste d'autorisation `gcp.restrictServiceUsage` du dossier échouerait elle-même à s'activer — maintenez manuellement la liste d'autorisation codée en dur de `02-setup-ui.sh` synchronisée avec `baseline_required_apis` si le socle change un jour ; il n'existe plus de lien calculé automatique entre les deux.

`compute.requireOsLogin` est délibérément absent des valeurs par défaut des dossiers tant que la VM NFS/Redis de `Services_GCP` n'aura pas été mise à jour pour prendre en charge OS Login (elle utilise actuellement IAP-SSH + des métadonnées de clés au lieu d'OS Login).

---

## Surcharges de quotas {#quota-overrides}

`quotas.tf` utilise l'**API Cloud Quotas** moderne (`google_cloud_quotas_quota_preference`) — l'ancienne ressource de surcharge de quota consommateur de Service Usage n'existe plus dans le fournisseur `hashicorp/google` actuel (`tofu validate` la rejette d'emblée). Un quota est identifié par un `quota_id` lisible par service (par exemple `"CpuAllocPerProjectRegion"`), et non par un triplet métrique/unité/limite.

Sept plafonds auto-imposés sont livrés comme valeurs par défaut actives du palier **sandbox** — CPU régional Cloud Run, CPU régional Compute Engine, GPU à l'échelle du projet, mémoire régionale Redis et trois niveaux Filestore (standard, premium, SSD haute capacité) — chacun dimensionné d'après le plafond éprouvé de ce catalogue plutôt qu'au jugé. **81 plafonds d'accélérateurs Vertex AI supplémentaires sont fixés à `0` et fusionnés dans chaque palier** (`local.vertex_accelerator_overrides`), car Vertex facture sur sa propre famille de quotas d'accélérateurs plutôt que sur le `GPUS-ALL-REGIONS-per-project` de Compute Engine. Le palier `development` relève plusieurs valeurs (Cloud Run 16000→32000 milli-vCPU, Compute 24→48 vCPU, Redis 16→32 GB) et ajoute un plafond BigQuery `QueryUsagePerDay` de `1048576` MiBy (1 TiB/jour) ; `production` hérite intégralement de la table de development (`local.production_quota_overrides = local.development_quota_overrides`, `quotas.tf:428`).

**La plupart** des plafonds sont appliqués avec `dimensions = {}`, ce qui en fait la valeur par défaut à l'échelle du projet pour ce quota **dans toutes les régions**, et pas seulement dans `var.region`. La seule exception est `compute_cpus_per_region` : l'API Cloud Quotas *exige* la dimension de région sur `CPUS-per-project-region` (confirmé en conditions réelles le 2026-08-11 — une table vide échoue avec `Dimension values must be set for all the dimensions ... defined for the quota`, Error 400) ; ce plafond unique est donc défini avec `{ region = var.region }` et ne s'applique par conséquent que dans `var.region`. Toutes les autres régions se rabattent sur la valeur par défaut non ajustée de CPU Compute de GCP ; y remédier proprement nécessite une préférence par région ou une règle `gcp.resourceLocations`, ce qui relève d'une décision produit plutôt que d'un correctif de code. Les cinq autres quotas régionaux conservent `{}` parce qu'ils existent et se mettent à jour correctement aujourd'hui — `quotas info describe` indique `dimensions=[region]` pour chacun d'eux ; un projet réellement neuf rencontrera donc probablement la même erreur sur ceux-ci.

C'est important, car les plafonds étaient auparavant limités à `var.region`, ce qui n'était
sûr que tant que `constraints/gcp.resourceLocations` épinglait chaque projet bac à sable sur
`us-central1`. Cette règle a été supprimée le 2026-08-06 afin que les utilisateurs puissent
échapper à l'épuisement des ressources régionales, ce qui a laissé les plafonds actifs dans
une seule région et toutes les autres régions sur les valeurs par défaut non ajustées de GCP
(250–10 000 vCPU).

`dimensions` est placé sous `lifecycle { ignore_changes }`. L'**emplacement d'une préférence
de quota est fixé à sa création** — une table vide la crée en `global`, une dimension de
région la crée dans cette région — et l'API Cloud Quotas ne permet pas de la déplacer. Sans
cette exemption, un projet créé avant ce changement planifierait une différence que
Terraform ne pourrait jamais appliquer.

| Clé | Service | `quota_id` | Valeur par défaut | Justification |
|---|---|---|---|---|
| `cloud_run_cpu_allocation` | `run.googleapis.com` | `CpuAllocPerProjectRegion` | `16000` milli-vCPU (= 16 vCPU réels), toutes régions | Correspond au plafond de CPU régional Cloud Run éprouvé de ce catalogue. **L'unité est le milli-vCPU, pas le vCPU** — une valeur littérale `16` correspond à 0 016 vCPU et fait échouer silencieusement tout véritable déploiement Cloud Run avec `Quota violated: CpuAllocPerProjectRegion requested: 3000 allowed: 16` (bogue d'unité corrigé le 2026-07-31, confirmé en conditions réelles sur un projet bac à sable). `compute_cpus_per_region` ci-dessous n'est *pas* concerné — `compute.googleapis.com/cpus` est exprimé en vCPU entiers. Les paliers `development` et `production` le relèvent à `32000`. |
| `compute_cpus_per_region` | `compute.googleapis.com` | `CPUS-per-project-region` | `24` — **uniquement `var.region`** (ce quota exige sa dimension de région) ; `48` en development/production | Limite le coût des VM Compute Engine, y compris la capacité des nœuds GKE Autopilot, qui puise dans ce même pool de CPU régional. Contrairement à tous les autres plafonds ici, il ne peut pas utiliser `dimensions = {}` — l'API Cloud Quotas rejette une préférence sur ce quota avec des dimensions vides (Error 400) — le plafond ne s'applique donc que dans `var.region`. |
| `compute_gpus_all_regions` | `compute.googleapis.com` | `GPUS-ALL-REGIONS-per-project` | `0` | Aucun module de base (`Services_GCP`/`App_CloudRun`/`App_GKE`) n'utilise de GPU — une valeur par défaut non nulle ne serait qu'une surface d'abus sans usage légitime correspondant |
| `redis_total_memory_per_region` | `redis.googleapis.com` | `TotalCapacityPerProjectPerRegion` | `16` GB | Limite les dépenses Memorystore, facturées sur la capacité provisionnée, que l'instance soit utilisée ou non |
| `filestore_standard_per_region` | `file.googleapis.com` | `StandardStorageGbPerRegion` | `1024` GB | Le niveau NFS partagé que `Services_GCP` provisionne réellement |
| `filestore_premium_per_region` | `file.googleapis.com` | `PremiumStorageGbPerRegion` | `2560` GB | Premium impose une taille d'instance minimale de 2,5 TB ; le plafond correspond donc à une instance |
| `filestore_high_scale_ssd_per_region` | `file.googleapis.com` | `HighScaleSSDStorageGibPerRegion` | `0` | Aucun module ne provisionne ce niveau ; son instance minimale est très grande et très coûteuse |

Deux plafonds supplémentaires dépendent du **palier** au lieu de faire partie des sept valeurs par défaut : un plafond d'analyse quotidienne BigQuery (`bigquery_query_bytes_per_day`) appliqué uniquement en `development`/`production` — la liste d'API autorisées de sandbox n'autorise pas du tout `bigquery.googleapis.com`, un plafond n'y aurait donc rien à quoi s'appliquer — et un ensemble de **81 quotas d'accélérateurs Vertex AI** (`aiplatform.googleapis.com`), fixés à zéro parce que `aiplatform` est activé sur chaque projet par `Services_GCP` alors qu'aucun module de base n'utilise d'accélérateur.

Surchargez la *valeur* d'une valeur par défaut existante avec `quota_value_overrides` (indexé par le même nom court, par exemple `{ cloud_run_cpu_allocation = 32000 }` — notez qu'il s'agit de **milli**-vCPU, conformément à l'avertissement sur l'unité ci-dessus ; `32` correspondrait ici à 0 032 vCPU), ou ajoutez un plafond de quota entièrement nouveau avec `additional_quota_overrides`. Avant d'ajouter une nouvelle entrée :

1. Recherchez le véritable `quota_id` pour le service/projet cible — la source de données `google_cloud_quotas_quota_infos`, ou `gcloud beta quotas info list --service=<api> --project=<id>`. Ne le saisissez pas de mémoire et ne reprenez pas un ancien nom de métrique Service Usage.
2. Vérifiez si la valeur cible nécessite de définir `ignore_safety_checks` (un plafond inférieur à la valeur par défaut ou à l'utilisation actuelle peut l'exiger — consultez la documentation de la ressource pour les valeurs d'énumération valides).
3. Dimensionnez délibérément la valeur *en dessous* du plafond partagé de l'organisation — de nombreux projets bac à sable simultanés partagent probablement un même pool de quotas au niveau de l'organisation ; un plafond auto-imposé échoue ainsi vite et à moindre coût dans un seul bac à sable au lieu de priver les autres de ressources.

---

## Création facultative du projet {#optional-project-creation}

Conditionnée par `create_project`, qui vaut **`true`** par défaut — le module crée le projet par défaut. Définissez-la sur `false` pour utiliser plutôt un projet existant. Lorsqu'elle est activée :

- **`google_project.tier_project`** crée le projet sous `folder_id`, rattaché à `billing_account_id`.

(L'ancienne adresse `google_project.sandbox` ne subsiste que du côté `from =` du bloc `moved` dans `modules/Project_GCP/moved.tf:21` ; aucune ressource de ce nom n'existe.) `deletion_policy = "DELETE"` afin qu'un `tofu destroy` réellement voulu puisse aboutir — sinon, le fournisseur prend par défaut la valeur `PREVENT` et bloque purement et simplement la destruction, même après la suppression du privilège de suppression (lien, ci-dessous).
- **`deploying_identity_bundle`** accorde à `deploying_identity_email` un ensemble de rôles au moindre privilège — `roles/editor`, `roles/resourcemanager.projectIamAdmin`, `roles/iam.serviceAccountAdmin`, `roles/servicenetworking.networksAdmin`, `roles/pubsub.admin`, `roles/run.admin`, `roles/secretmanager.admin` — constitué à partir de cinq lacunes de `roles/editor` seul, confirmées indépendamment (`setIamPolicy`/`getIamPolicy` est structurellement exclu d'Editor sur presque tous les types de ressources qu'il gère par ailleurs entièrement : IAM du projet, appairage Private Service Access, IAM des sujets Pub/Sub, IAM des services Cloud Run et IAM Secret Manager par secret — cette dernière confirmée en conditions réelles le 2026-08-18 (#2761) et la plus large des cinq, puisque la liaison `app_iam` d'`App_Common` se déclenche pour chaque application disposant d'une base de données, sur Cloud Run comme sur GKE). **Pas encore validé sur l'ensemble du catalogue d'environ 150 modules applicatifs** — considérez-le comme un candidat en attente d'une véritable campagne de type `/deploy-group-test`, et non comme un ensemble garanti suffisant.
- **`end_user_access_bundle`** accorde à `deployed_by_email` un ensemble de rôles **dépendant du palier** (`local.end_user_roles`, `project.tf`). Les trois paliers reçoivent la base en lecture seule (`roles/browser` plus `logging`/`monitoring`/`run`/`container`/`cloudsql`/`compute`.viewer et `storage.objectViewer`). **`development`** reçoit en outre un ensemble de build et de déploiement (`run.developer`, `container.developer`, `cloudsql.client`, `storage.objectAdmin`, `secretmanager.secretAccessor`, `secretmanager.secretVersionAdder`, `artifactregistry.writer`, `monitoring.editor`, `errorreporting.user`, `cloudtrace.user`), de sorte qu'un utilisateur final en development peut réellement créer et mettre à jour des ressources ; il reçoit aussi un compte de service `rad-app-runtime` dédié et sans autorisation (`google_service_account.app_runtime`, créé uniquement sur ce palier) sur lequel l'utilisateur détient `roles/iam.serviceAccountUser`. **`production`** est délibérément *plus restrictif* que development — il n'ajoute que `monitoring.editor`, `errorreporting.viewer` et `cloudtrace.user` (exploiter, pas reconfigurer). Aucun palier ne reçoit jamais `roles/owner`, `roles/cloudquotas.admin`, `roles/orgpolicy.policyAdmin` ni `roles/iam.serviceAccountUser` limité au projet.

- **`google_iam_deny_policy.deny_deploying_identity_quota_write`** empêche `deploying_identity_email` de relever ses propres plafonds de quotas. L'écriture de quotas ne peut pas être retirée en choisissant un rôle prédéfini plus restreint ; c'est donc une règle de refus (Deny Policy) qui sert de mécanisme ici. Elle refuse à la fois l'autorisation d'écriture moderne (`cloudquotas.googleapis.com/quotas.update`) et l'ancienne (`serviceusage.googleapis.com/quotas.update`), par défense en profondeur.
- **`google_resource_manager_lien.prevent_deletion`** est un blocage réel et structurel de `resourcemanager.projects.delete`, indépendant des rôles IAM que détient l'identité de déploiement.

Le contrôle `create_project_requires_billing_and_deploying_identity` de `validation.tf` rejette `create_project = true` au moment du plan sauf si `billing_account_id`, `deploying_identity_email` et `deployed_by_email` sont tous définis — une tentative mal configurée échoue ainsi rapidement au lieu de créer partiellement un projet sans identité de déploiement capable de l'exploiter.

> **Cycle de vie des projets bac à sable : création à neuf uniquement, jamais de recyclage.** Cette plateforme ne sert pas qu'à la formation — certains utilisateurs déploient un travail réel et non reproductible dans ces projets bac à sable ; un projet peut donc contenir de vraies données utilisateur. Ne détruisez pas un ID de projet pour le réutiliser pour un nouvel utilisateur. La suppression réversible propre à GCP (fenêtre de 30 jours) est conservée comme filet de sécurité, mais ce **n'est pas** un mécanisme de recyclage rapide — un projet restauré est inutilisable pendant jusqu'à 36 heures/3 jours ; il ne peut donc pas servir de base à un flux du type « remettre ce projet dans un pool pour l'utilisateur suivant ». Un véritable démantèlement passe par un `projects.delete` délibéré, et non par un cycle de routine `tofu destroy` puis reprovisionnement.

---

## Budget de facturation par projet {#per-project-billing-budget}

`budget.tf` crée un `google_billing_budget` limité au projet créé par ce module, afin qu'une alerte de dépenses désigne le bac à sable d'un seul utilisateur. Il n'est créé que lorsque les **trois** conditions suivantes sont réunies : `create_project = true`, `enable_project_budget = true` et un `billing_account_id` non vide.

**Ce n'est pas un plafond de dépenses.** Un budget GCP ne fait que *notifier* — il ne bloque jamais un appel d'API et ne détache jamais la facturation. L'application des limites reste du ressort des mécanismes propres à la plateforme : `credit_billing_guard` (interrogation toutes les 15 minutes, désactive la facturation en cas d'arriérés) et `credit_project` (mesure horaire à partir de l'export de facturation BigQuery). Ce qu'apporte le budget, c'est la *rapidité* : ces deux mécanismes héritent de la latence de plusieurs heures de l'export de facturation, alors que les seuils de budget se déclenchent à partir du suivi des dépenses quasi en temps réel de Google, ce qui en fait le signal disponible le plus rapide indiquant qu'un bac à sable précis s'emballe.

Il existe par projet parce que le budget côté plateforme est limité à l'ensemble du **compte de facturation** et ne peut pas y être restreint — ce module génère un nouvel ID de projet par utilisateur au moment du déploiement ; aucune liste statique de projets n'existe donc côté plateforme au moment du `tofu apply`. À l'intérieur du module qui crée le projet, l'ID *est* connu.

Quatre règles de seuil se déclenchent : à **50 %**, **90 %** et **100 %** des dépenses réelles, plus une fois lorsque Google *prévoit* que le mois se terminera au-delà du budget (généralement plusieurs jours avant la règle sur les dépenses réelles). Les crédits et promotions sont exclus (`EXCLUDE_ALL_CREDITS`) afin que le seuil suive les dépenses réellement facturables. Les notifications sont envoyées aux administrateurs et utilisateurs du compte de facturation, **délibérément pas à l'utilisateur final** — celui-ci ne détient qu'une IAM en lecture seule sur son bac à sable et ne peut rien faire contre un dépassement, et les dépenses sont imputées au compte de la plateforme plutôt qu'au sien.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_project_budget` | `true` | Crée le budget par projet. Sans effet sauf si `create_project = true` et que `billing_account_id` est défini. |
| `project_budget_amount` | `150` | Budget mensuel en unités monétaires entières, dimensionné pour une pile type mono-utilisateur. |
| `project_budget_currency` | `"USD"` | Doit correspondre à la devise du compte de facturation, faute de quoi le budget est rejeté. |
| `project_budget_pubsub_topic` | `""` | Sujet Pub/Sub facultatif pour les notifications programmatiques, sous la forme `projects/<project>/topics/<topic>`. Vide signifie des alertes uniquement par e-mail aux administrateurs du compte de facturation. Le relier à un système de réponse automatisé constitue la voie de réaction la plus rapide possible. |

---

## Variables de configuration {#configuration-variables}

Le groupe 0 (métadonnées du module — `module_description`, `module_dependency`, `credit_cost`, `public_access`, `shared_users`, etc.) reprend le bloc de métadonnées obligatoire de tous les autres modules et n'est pas reproduit ici ; voir la convention « Group 0 metadata variables are mandatory » de `CLAUDE.md`. Trois des réglages de configuration significatifs résident dans le groupe 0 plutôt que dans un groupe dédié, car ils relèvent davantage des paramètres d'administration/de surface d'API que de la configuration de projet propre à chaque déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tier` | `sandbox` | **L'entrée la plus lourde de conséquences de ce module.** L'une des valeurs `sandbox`, `development`, `production`, `lab` (validée au moment du plan ; `lab` n'est créé que par une session de lab et n'est jamais proposé dans un formulaire de déploiement). Elle sélectionne la table de quotas appliquée par `quotas.tf`, l'ensemble IAM d'utilisateur final accordé à `deployed_by_email` (`local.end_user_roles` dans `project.tf`) et le dossier dans lequel le projet est créé. `development` relève Cloud Run à 32000 milli-vCPU, Compute à 48 vCPU et Redis à 32 GB, ajoute un plafond d'analyse BigQuery de 1 TiB/jour, et accorde un ensemble de rôles de build et de déploiement plus un compte de service `rad-app-runtime` sans autorisation. `production` hérite intégralement de la table de quotas de development, mais est délibérément *plus restrictif* en matière d'IAM — exploiter, pas reconfigurer. Le palier ne modifie pas le coût d'un déploiement : il définit le dossier (et ses règles d'administration), l'alerte de budget du projet et le seuil d'admission en crédits achetés. |
| `additional_apis` | `[]` | API Google Cloud supplémentaires à activer au-delà du socle intégré. Également ajoutées automatiquement à la liste d'API autorisées. |
| `resource_creator_identity` | `""` | Compte de service dont l'identité est empruntée pour tous les appels d'API effectués par ce module. Laissez vide pour utiliser les propres identifiants de l'appelant. L'appelant doit déjà détenir `roles/iam.serviceAccountTokenCreator` sur cette identité. |
| `enable_services` | `true` | Présente par cohérence d'interface entre modules avec l'option du même nom de `Services_GCP`. **Délibérément reliée à rien** — la liste d'API autorisées de ce module (`apis.tf`) est toujours appliquée, quelle que soit cette valeur ; il n'existe aucun moyen pris en charge de l'ignorer. |

### Configuration du projet {#project-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | Lorsque `create_project = true`, l'ID du nouveau projet à créer (6 à 30 caractères, lettres minuscules/chiffres/traits d'union, commençant par une lettre) ; sinon, l'ID d'un projet existant. |
| `create_project` | `true` | Crée `project_id` en tant que nouveau projet GCP. Lorsque `false`, l'appelant fournit un projet existant et accorde lui-même l'accès à `deploying_identity_email` — ce module n'intervient jamais dans ce cas. |
| `billing_account_id` | `""` | Compte de facturation auquel rattacher le nouveau projet. Obligatoire lorsque `create_project = true` (vérifié au moment du plan). |
| `deploying_identity_email` | `""` | Compte de service qui déploiera les modules dans le nouveau projet une fois créé. Obligatoire lorsque `create_project = true`. Reçoit l'ensemble au moindre privilège décrit ci-dessus, jamais Owner. |
| `deployed_by_email` | `""` | Adresse e-mail de la personne qui a demandé le déploiement. Obligatoire lorsque `create_project = true`. Doit être une véritable identité Google (compte Workspace/Gmail) — une attribution IAM à une adresse e-mail sans identité Google correspondante est acceptée par l'API, mais n'accorde aucun accès réel tant qu'une telle identité n'existe pas. |
| `folder_id` | `""` — **aucune valeur par défaut** | ID numérique du dossier GCP qui contient les projets de **ce palier** — `rad-sandbox`, `rad-development`, `rad-production` ou `rad-lab`, sélectionné par `var.tier` et injecté par la plateforme — utilisé uniquement pour placer un projet créé (`google_project.tier_project`). Il prenait auparavant par défaut l'ID du dossier `rad-sandbox` de RAD lui-même ; cette valeur par défaut a été **supprimée** (#2774), car cette valeur décide de *l'endroit* où le projet est créé, et une valeur par défaut est une mauvaise réponse qui n'attend que d'être utilisée. Marqué `{{UIMeta group=0}}` : la plateforme l'injecte au lieu que l'opérateur le saisisse ; les quatre dossiers de palier portent délibérément des ensembles de règles d'administration différents. |
| `region` | `"us-central1"` | Délimite le seul plafond de quota qui ne peut pas s'appliquer à l'échelle du projet : `compute_cpus_per_region` (`CPUS-per-project-region`) exige sa dimension de région ; `quotas.tf` le définit donc avec `{ region = var.region }`, tandis que tous les autres plafonds utilisent `dimensions = {}` (toutes régions). Non exposé aux utilisateurs (pas de tag UIMeta) — une décision de plateforme/d'administration sur l'emplacement du calcul des bacs à sable, conforme à la valeur par défaut de `region` de tous les autres modules. |

(L'affirmation « aucune ressource ne lit cette valeur » est désormais fausse : `google_cloud_quotas_quota_preference.guardrails` la lit via `local.default_quota_overrides.compute_cpus_per_region.dimensions`.)
| `quota_value_overrides` | `{}` | Surcharge la valeur numérique d'une surcharge de quota par défaut, indexée par le même nom (par exemple `{ cloud_run_cpu_allocation = 32 }`). |
| `additional_quota_overrides` | `{}` | Ajoute des surcharges de quotas au-delà des sept valeurs par défaut, indexées par un nom court. Consultez « Surcharges de quotas » ci-dessus avant d'ajouter une entrée. |

---

## Sorties {#outputs}

| Sortie | Description |
|---|---|
| `enabled_apis` | L'ensemble complet des API activées (et autorisées) sur `project_id` par cette exécution. |
| `quota_overrides_applied` | Les surcharges de quotas appliquées à `project_id`, indexées par les mêmes noms courts que `default_quota_overrides` / `additional_quota_overrides`. |
| `created_project_id` | L'ID du projet créé par cette exécution, ou `null` si `create_project` valait `false` (projet supposé préexistant). |
| `deploying_identity_bundle_roles` | Les rôles exacts accordés à `deploying_identity_email` lorsque `create_project = true` — l'ensemble candidat au moindre privilège, en attente de validation sur l'ensemble du catalogue. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `create_project` + `billing_account_id`/`deploying_identity_email`/`deployed_by_email` | Définir les trois ensemble, ou laisser `create_project = false` | **Élevé** 🛡 au moment du plan | `create_project = true` avec l'une des trois variables associées vide est rejeté au moment du plan (`create_project_requires_billing_and_deploying_identity`) plutôt que de créer partiellement un projet sans identité de déploiement capable de l'exploiter. |
| `folder_id` | Le dossier de palier injecté par la plateforme — il n'existe aucune valeur par défaut de repli |  **Critique** | Un projet placé dans un dossier sur lequel l'étape 10 de `02-setup-ui.sh` n'a pas été exécutée n'hérite d'**aucun** garde-fou de règle d'administration au niveau du dossier (refus des IP externes, restrictions sur les clés de comptes de service, liste d'API autorisées) — le projet est créé mais n'est en pratique pas protégé au niveau des règles d'administration, et ce module ne peut ni le détecter ni le signaler depuis l'état d'un seul projet. |
| `additional_apis` | N'ajouter que ce dont une intégration précise a besoin | **Moyen** | Chaque API activée par ce module est aussi implicitement supposée figurer déjà dans la liste d'autorisation `gcp.restrictServiceUsage` du dossier — une API ajoutée ici mais absente de cette liste échoue purement et simplement à s'activer ; une API ajoutée aux deux devient une partie permanente de la surface d'attaque du projet. |
| `quota_value_overrides` / `additional_quota_overrides` | Maintenir les nouveaux plafonds sous le plafond partagé de l'organisation | **Moyen** | Un plafond égal ou supérieur au pool partagé de l'organisation n'offre aucun véritable garde-fou — l'intérêt d'un plafond auto-imposé est d'échouer vite et à moindre coût dans *ce* bac à sable avant de priver de ressources tous les autres projets bac à sable simultanés partageant le même pool de quotas au niveau de l'organisation. |
| `deploying_identity_bundle` (ensemble de rôles fixe, pas une variable en soi) | — | **Faible** | Pas encore validé sur l'ensemble du catalogue d'environ 150 modules applicatifs — un déploiement qui a besoin d'une autorisation en dehors des sept rôles de l'ensemble échoue avec un `PERMISSION_DENIED` IAM explicite, et non silencieusement. Considérez-le comme un candidat en attente d'une véritable campagne `/deploy-group-test`, et non comme un ensemble garanti suffisant. |
| Détruire et réutiliser un `project_id` pour un nouvel utilisateur | Jamais — création à neuf uniquement | **Critique** | Cette plateforme ne sert pas qu'à la formation ; un projet peut contenir de vraies données utilisateur non reproductibles. La suppression réversible de GCP est un filet de sécurité de 30 jours, pas un mécanisme de recyclage rapide (la restauration prend jusqu'à 36 heures/3 jours) — elle ne peut pas servir de base à un flux du type « remettre ce projet dans un pool ». |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Project GCP](../labs/Project_GCP.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
