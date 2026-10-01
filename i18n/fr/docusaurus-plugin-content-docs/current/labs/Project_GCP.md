---
title: "Project GCP — Guide de lab"
description: "Lab pratique : déployez le module de garde-fous de niveau 0 Project GCP — listes d'API autorisées, plafonds de quota et création facultative d'un projet sandbox, appliqués avant Services GCP."
---

<!-- translated-from: docs/labs/Project_GCP.md @ 3055034 sha256:f514e094f8f6 -->

# Project GCP — Guide de lab {#project-gcp--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Project_GCP)**

## Vue d'ensemble {#overview}

**Durée estimée :** 20–35 minutes (ajoutez ~10 minutes si vous exercez le chemin facultatif de création de projet)

`Project GCP` est le **module de garde-fous de niveau 0 (Tier-0)** — le seul module de ce catalogue appliqué *avant* `Services GCP`. Il ne provisionne aucune infrastructure applicative ; il renforce le projet lui-même : une liste d'autorisation des API Google Cloud pouvant être activées, un ensemble de plafonds de quota auto-imposés et — de manière facultative — la création du projet sandbox lui-même ainsi qu'une identité de déploiement à moindre privilège pour y opérer.

> **Public : administrateurs de plateforme, pas stagiaires.** Contrairement à tous les autres labs de ce catalogue, ce module est conçu pour être exécuté par une identité disposant d'IAM au niveau de l'*organisation ou du dossier* — un niveau de confiance nettement supérieur à l'identité limitée au projet que suppose chaque autre module. Dans la plateforme RAD, vous le déployez rarement à la main : lorsqu'un déploiement cible un projet géré par RAD, la plateforme enchaîne automatiquement `Project GCP` devant `Services GCP` et l'application, et l'applique en empruntant l'identité élevée de garde-fous pour cette seule étape (le paramètre d'administration `guardrails_admin_identity_email`). Si vous suivez ce lab comme un exercice de formation plutôt qu'en tant qu'opérateur de plateforme, lisez-le pour comprendre plutôt qu'en vous attendant à exécuter vous-même chaque phase — le chemin B de la phase 1 (création de projet), en particulier, requiert des rôles au niveau de l'organisation que la plupart des stagiaires ne détiendront pas.

Ce lab porte sur l'exploitation de **`Project GCP` et des garde-fous qu'il établit**, et non sur ce qui se trouve en aval. Pour la référence complète des variables et la justification détaillée de la conception à deux identités, de la liste d'API autorisées à socle additif et de l'utilisation de l'API Cloud Quotas, consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Project_GCP) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

> **Les règles d'administration au niveau du dossier ne sont pas déployées par ce module.** Elles sont appliquées une fois par dossier via `rad-automation/scripts/02-setup-ui.sh` (étape 10), indépendamment du cycle de vie Terraform de chaque projet sandbox. La phase 5 de ce lab vérifie ces règles héritées mais ne les déploie pas — si vous exécutez ce lab sur un dossier pour lequel l'étape 10 de ce script n'a jamais été exécutée, ignorez les attentes de *réussite* de la phase 5 et considérez toute vérification de règle qui s'y trouve comme purement informative.

### Ce que le module automatise {#what-the-module-automates}

- Active un socle codé en dur d'environ 35 API Google Cloud sur `project_id`, plus tout ce qui figure dans `additional_apis` (uniquement additif — rien dans ce module ne peut réduire le socle)
- Applique des plafonds de quota auto-imposés via l'API Cloud Quotas, sélectionnés par `tier` — CPU régional Cloud Run, CPU régional Compute Engine, GPU à l'échelle du projet, capacité Memorystore, trois niveaux Filestore et les 81 quotas d'accélérateurs Vertex AI (GPU, TPU et accélérateurs plafonnés à zéro par défaut)
- Valide les variables associées à `create_project` **au moment du plan** — une demande de création de projet incomplète est rejetée avant que quoi que ce soit ne soit créé
- *(Facultatif, `create_project = true`)* Crée le projet sandbox, attribue un ensemble de rôles à moindre privilège à une identité de déploiement distincte, attribue un ensemble strictement en lecture seule à la personne qui l'a demandé, refuse à l'identité de déploiement l'autorisation de relever ses propres plafonds de quota et pose un verrou de suppression (« lien »)

### Ce que vous faites manuellement {#what-you-do-manually}

- Configurer les variables et choisir le chemin A (gouverner un projet existant) ou le chemin B (créer et gouverner un nouveau projet)
- Vérifier que les API activées/autorisées correspondent à ce que vous avez configuré
- Vérifier que les préférences de quota ont été appliquées
- *(Chemin B uniquement)* Vérifier le nouveau projet, ses ensembles IAM, sa règle de refus d'écriture des quotas et son lien de suppression
- Vérifier les règles d'administration héritées du dossier cible (informatif — non déployées par ce module)

---

## Vue d'ensemble de la CLI et de l'API REST {#cli-and-rest-api-overview}

```bash
# Set these variables at the start of each session
export PROJECT="your-gcp-project-id"     # the project this module governs (existing, or the one it will create)
export FOLDER="<your-folder-id>"          # the folder ID you deployed with (no default; the platform injects the tier's folder)
export REGION="us-central1"               # the region your quota guardrails are scoped to
export TOKEN=$(gcloud auth print-access-token)
```

---

## Prérequis {#prerequisites}

| Exigence | Détail |
|---|---|
| Identité de déploiement élevée | L'identité qui exécute ce module a besoin de rôles de la classe `orgpolicy.policyAdmin`/`iam.denyAdmin` au niveau de l'organisation/du dossier, liés au niveau de l'**organisation** (GCP rejette les deux au niveau du dossier), ainsi que d'autorisations de la classe `serviceusage.serviceUsageAdmin` pour écrire la liste d'API autorisées et les préférences de quota. Dans le déploiement propre à cette plateforme, il s'agit de `rad-guardrails-admin`, utilisable uniquement par emprunt d'identité ; la plateforme emprunte automatiquement cette identité pour les déploiements `Project GCP` en libre-service (le paramètre d'administration `guardrails_admin_identity_email`). |
| Dossier déjà configuré avec les garde-fous | L'étape 10 de `rad-automation/scripts/02-setup-ui.sh` doit déjà avoir été exécutée une fois sur le dossier cible — sinon, un projet nouvellement créé n'hérite d'aucune règle d'administration au niveau du dossier (voir la section « Folder-Level Org Policies » du Guide de configuration). |
| Accès au compte de facturation (chemin B uniquement) | Requis pour associer un projet nouvellement créé à `billing_account_id`. |
| CLI `gcloud` | Authentifiée (`gcloud auth login`). |
| Un projet existant (chemin A) *ou* rien pour l'instant (chemin B) | Le chemin A gouverne un projet qui existe déjà ; le chemin B fait créer le projet par ce module. |

`Project GCP` est un module autonome sans aucune dépendance d'exécution envers un autre module RAD — il est appliqué *avant* `Services GCP`, et non en même temps ou après.

---

## Phase 1 — Déployer les garde-fous [AUTOMATISÉ] {#phase-1--deploy-guardrails-automated}

### Étape 1.1 — Choisir votre chemin de lab {#step-11--choose-your-lab-path}

**Chemin A — Gouverner un projet existant (le plus rapide, ~10–15 min).** Vous disposez déjà d'un projet GCP (avec la facturation activée) dans lequel une autre identité déploiera `Services GCP`/des modules applicatifs. `Project GCP` se contente d'y définir la liste d'API autorisées et les plafonds de quota.

```hcl
project_id       = "<your-existing-project-id>"
create_project   = false
folder_id        = "<tier-folder-id>"   # only relevant if you also want org-policy inheritance verified in Phase 5
region           = "us-central1"
```

**Chemin B — Créer et gouverner un nouveau projet sandbox (~20–35 min).** `Project GCP` crée lui-même le projet, le place dans `folder_id` et provisionne la séparation complète à deux identités.

```hcl
project_id                = "<new-project-id>"        # 6-30 chars, lowercase letters/digits/hyphens, starts with a letter
create_project             = true
billing_account_id         = "<your-billing-account-id>"
deploying_identity_email   = "<sa-that-will-run-Services_GCP-etc>@<host-project>.iam.gserviceaccount.com"
deployed_by_email           = "<you>@example.com"
folder_id                   = "<tier-folder-id>"
region                       = "us-central1"
```

> Le chemin B est rejeté au moment du plan si `billing_account_id`, `deploying_identity_email` ou `deployed_by_email` est laissé vide alors que `create_project = true` — vous ne pouvez pas créer partiellement un projet sans identité de déploiement capable de l'exploiter.

Les deux chemins acceptent `additional_apis` (liste de chaînes `*.googleapis.com` supplémentaires) et `quota_value_overrides`/`additional_quota_overrides` (voir le Guide de configuration) si un lab en aval a besoin de quelque chose au-delà des valeurs par défaut.

### Étape 1.2 — Lancer le déploiement {#step-12--initiate-deployment}

Le déploiement se lance de la même manière que pour tout autre module — depuis la plateforme RAD (en empruntant l'identité élevée décrite dans les prérequis) ou directement via `tofu apply` depuis le répertoire du module pour une exécution manuelle/d'administration.

**Durées de provisionnement attendues des ressources :**

| Phase | Durée typique |
|---|---|
| Activation des API (~35 API, aucune attente de propagation intégrée à ce module) | 2–4 min |
| Application des préférences de quota (7 plafonds de capacité + 81 plafonds d'accélérateurs Vertex AI, API Cloud Quotas) | 1–3 min |
| Création du projet (chemin B uniquement) | 1–2 min |
| Attribution des ensembles IAM + règle de refus + lien (chemin B uniquement) | 1–2 min |
| **Total (chemin A)** | **5–10 min** |
| **Total (chemin B)** | **10–20 min** |

### Étape 1.3 — Relever les sorties {#step-13--record-outputs}

| Sortie | Description |
|---|---|
| `enabled_apis` | L'ensemble complet des API activées (et autorisées) sur `project_id`. |
| `quota_overrides_applied` | Les remplacements de quota effectivement appliqués, indexés par nom court. |
| `created_project_id` | L'ID du projet créé par cette invocation, ou `null` sur le chemin A. |
| `deploying_identity_bundle_roles` | Les rôles exacts attribués à `deploying_identity_email` (chemin B uniquement). |

```bash
export PROJECT="your-gcp-project-id"
export TOKEN=$(gcloud auth print-access-token)
```

---

## Phase 2 — Vérifier la liste d'API autorisées [MANUEL] {#phase-2--verify-the-api-allowlist-manual}

### Étape 2.1 — Vérifier les API activées {#step-21--confirm-enabled-apis}

```bash
gcloud services list --enabled --project=${PROJECT} \
  --format="table(config.name)" | sort
```

**Résultat attendu :** les quelque 35 API du socle décrites dans la section « The Additive-Floor API Allowlist » du Guide de configuration sont présentes, plus tout ce que vous avez fourni dans `additional_apis`. Contrôlez ponctuellement quelques-unes des moins évidentes :

```bash
gcloud services list --enabled --project=${PROJECT} \
  --filter="config.name:(binaryauthorization.googleapis.com OR gkebackup.googleapis.com OR alloydb.googleapis.com)" \
  --format="table(config.name)"
```

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state:ENABLED" \
>   | jq -r '.services[].config.name' | sort
> ```

### Étape 2.2 — Vérifier que le socle ne peut pas être contourné {#step-22--confirm-the-floor-cannot-be-bypassed}

Relancez un plan du module sans rien modifier — un plan propre et vide confirme que le contrôle `api_floor_never_shrinks` a réussi et qu'aucune API du socle n'a été accidentellement retirée de `effective_enabled_apis` :

```bash
tofu plan -detailed-exitcode
# exit code 0 = no changes; 2 = changes pending; 1 = error
```

---

## Phase 3 — Vérifier les garde-fous de quota [MANUEL] {#phase-3--verify-quota-guardrails-manual}

### Étape 3.1 — Lister les préférences de quota appliquées {#step-31--list-applied-quota-preferences}

```bash
gcloud beta quotas preferences list \
  --project=${PROJECT} \
  --billing-project=${PROJECT} \
  --format="table(name,service,quotaId,quotaConfig.preferredValue,reconciling)"
```

**Résultat attendu (par défaut `tier = sandbox`) :** 88 préférences sont listées — sept plafonds de capacité (`run.googleapis.com/CpuAllocPerProjectRegion` = `16000` **milli**-vCPU, soit 16 vCPU ; `compute.googleapis.com/CPUS-per-project-region` = `24` ; `compute.googleapis.com/GPUS-ALL-REGIONS-per-project` = `0` ; `redis.googleapis.com/TotalCapacityPerProjectPerRegion` = `16` ; et trois niveaux Filestore `file.googleapis.com`) plus 81 quotas d'accélérateurs Vertex AI `aiplatform.googleapis.com`, tous plafonnés à `0`. `tier = development` double à peu près les plafonds de capacité et relève le plafond BigQuery `QueryUsagePerDay` à 1 TiB/jour ; `tier = production` reprend tel quel l'ensemble de development ; `tier = lab` utilise l'ensemble sandbox. — ou vos valeurs remplacées si vous avez défini `quota_value_overrides`. `reconciling: true` signifie que GCP applique encore le plafond demandé ; revérifiez après quelques minutes.

### Étape 3.2 — Décrire une préférence spécifique {#step-32--describe-a-specific-preference}

```bash
gcloud beta quotas preferences describe \
  "projects/${PROJECT}/locations/global/services/run.googleapis.com/quotaPreferences/<preference-id>" \
  --format="yaml(quotaConfig,justification,dimensions)"
```

(Remplacez `<preference-id>` par la valeur du champ `name` de la sortie de l'étape 3.1.)

**Résultat attendu :** `justification` contient le texte « Sandbox guardrail: ... » issu de `quotas.tf`, et `dimensions` est **vide** pour la préférence `run.googleapis.com` décrite à cette étape. Seul `compute.googleapis.com/CPUS-per-project-region` porte encore `dimensions = { region = var.region }` (quotas.tf:255 — ce quota rejette les dimensions vides) ; tous les autres plafonds, y compris l'ensemble des accélérateurs Vertex AI, utilisent `dimensions = {}` (toutes les régions).

### Étape 3.3 — Vérifier que le plafond est réellement effectif {#step-33--confirm-the-cap-is-actually-effective}

La vérification la plus convaincante est indirecte : déployez (ou tentez de déployer) quelque chose qui dépasserait le plafond et vérifiez que l'opération est rejetée avec une erreur de quota citant le même `quota_id`, plutôt que de supposer que la préférence « a pris » sur la seule foi de la réponse de l'API. C'est facultatif pour le lab, mais cela vaut la peine de le faire une fois si vous validez un remplacement autre que la valeur par défaut.

---

## Phase 4 — Vérifier la création du projet et la séparation des identités [MANUEL, chemin B uniquement] {#phase-4--verify-project-creation--identity-separation-manual-path-b-only}

Ignorez entièrement cette phase si vous avez déployé le chemin A (`create_project = false`).

### Étape 4.1 — Vérifier le projet {#step-41--confirm-the-project}

```bash
gcloud projects describe ${PROJECT} \
  --format="yaml(projectId,name,parent,lifecycleState)"
```

**Résultat attendu :** `parent.id` correspond à `folder_id`, `lifecycleState` vaut `ACTIVE`.

### Étape 4.2 — Vérifier l'ensemble de rôles de l'identité de déploiement {#step-42--confirm-the-deploying-identitys-bundle}

```bash
gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:<deploying_identity_email>" \
  --format="table(bindings.role)"
```

**Résultat attendu :** exactement six rôles — `roles/editor`, `roles/resourcemanager.projectIamAdmin`, `roles/iam.serviceAccountAdmin`, `roles/servicenetworking.networksAdmin`, `roles/pubsub.admin`, `roles/run.admin` — et **pas** `roles/owner`.

### Étape 4.3 — Vérifier l'ensemble en lecture seule de l'utilisateur final {#step-43--confirm-the-end-users-read-only-bundle}

```bash
gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:user:<deployed_by_email>" \
  --format="table(bindings.role)"
```

**Résultat attendu :** uniquement des rôles de la classe `*.viewer`/`roles/browser` — `roles/browser`, `roles/logging.viewer`, `roles/monitoring.viewer`, `roles/run.viewer`, `roles/container.viewer`, `roles/cloudsql.viewer`, `roles/compute.viewer`, `roles/storage.objectViewer`. Aucune autorisation de création/modification/suppression sur quoi que ce soit.

### Étape 4.4 — Vérifier la règle de refus d'écriture des quotas {#step-44--confirm-the-quota-write-deny-policy}

```bash
gcloud iam policies get deny-deploying-identity-quota-write \
  --attachment-point=cloudresourcemanager.googleapis.com/projects/${PROJECT} \
  --kind=denypolicies \
  --format="yaml(rules)"
```

**Résultat attendu :** `deniedPrincipals` désigne l'identité de déploiement (au format `principal://iam.googleapis.com/projects/-/serviceAccounts/...`, et non avec le préfixe standard `serviceAccount:`), et `deniedPermissions` inclut à la fois `cloudquotas.googleapis.com/quotas.update` et `serviceusage.googleapis.com/quotas.update`.

### Étape 4.5 — Vérifier le lien de suppression {#step-45--confirm-the-deletion-lien}

```bash
gcloud alpha resource-manager liens list --project=${PROJECT} \
  --format="table(name,origin,reason,restrictions)"
```

**Résultat attendu :** un lien avec `origin: project_gcp` et `restrictions: [resourcemanager.projects.delete]`. Toute tentative de `gcloud projects delete ${PROJECT}` à ce stade doit échouer tant que le lien n'a pas été explicitement retiré — une friction voulue et délibérée.

---

## Phase 5 — Vérifier les règles d'administration héritées du dossier [MANUEL, informatif] {#phase-5--confirm-inherited-folder-level-org-policies-manual-informational}

Ce module ne crée pas ces règles — elles proviennent de l'étape 10 de `rad-automation/scripts/02-setup-ui.sh`, appliquée une fois par dossier. Cette phase vérifie que le projet cible en a bien hérité ; elle est informative, et non un critère de réussite/échec pour `Project GCP` lui-même.

```bash
gcloud org-policies list --folder=${FOLDER} --format="table(constraint)"
```

```bash
gcloud org-policies describe gcp.restrictServiceUsage \
  --folder=${FOLDER} \
  --format="yaml(spec)"
```

**Résultat attendu (si l'étape 10 a été exécutée sur ce dossier) :** une règle listant un ensemble de services autorisés qui est un sur-ensemble de `baseline_required_apis` — chaque API activée par `Project GCP` doit également figurer dans cette liste d'autorisation, sans quoi sa propre ressource `google_project_service.enabled` échouerait elle-même. Si rien n'est renvoyé ici, le script de garde-fous n'a jamais été exécuté sur ce dossier — une lacune réelle et exploitable qu'un administrateur de plateforme doit combler, et non un bug de ce module.

---

## Phase 6 — Dépanner et déboguer [MANUEL] {#phase-6--troubleshoot--debug-manual}

- **Les ressources `google_iam_deny_policy` / de règles d'administration échouent avec `PERMISSION_DENIED` :** l'identité de déploiement de *ce module* (et non l'identité de déploiement propre au projet sandbox) ne dispose pas des rôles requis au niveau de l'organisation (`orgpolicy.policyAdmin`, `iam.denyAdmin`) sur le périmètre de l'**organisation** — les deux sont rejetés au niveau du dossier (`INVALID_ARGUMENT`). Vérifiez quel principal exécute réellement l'application et ce qu'il détient au niveau de l'organisation, et pas seulement au niveau du projet.
  ```bash
  gcloud organizations get-iam-policy <ORG_ID> \
    --flatten="bindings[].members" \
    --filter="bindings.members:<your-principal>" \
    --format="table(bindings.role)"
  ```
- **Une API s'active ici mais est inutilisable lors du déploiement d'une application :** vérifiez si elle figure dans la liste d'autorisation `gcp.restrictServiceUsage` du dossier (phase 5) — l'activation d'une API par ce module est nécessaire mais pas suffisante si la liste d'autorisation au niveau du dossier n'a pas été tenue à jour.
- **L'application de `google_cloud_quotas_quota_preference` est lente ou affiche `reconciling: true` pendant longtemps :** c'est normal — les modifications de l'API Cloud Quotas sont asynchrones. Revérifiez avec les étapes 3.1/3.2 après quelques minutes plutôt que de supposer une application bloquée.
- **Un plafond de quota que vous avez défini est rejeté d'emblée :** la valeur cible est peut-être inférieure à la valeur par défaut actuelle du service ou à l'utilisation réelle — vérifiez si `ignore_safety_checks` doit être défini sur cette entrée (`additional_quota_overrides`), et consultez la documentation propre à la ressource pour connaître les valeurs d'énumération valides avant de réessayer.
- **`create_project = true` échoue immédiatement au moment du plan :** vérifiez que `billing_account_id`, `deploying_identity_email` et `deployed_by_email` sont tous non vides — le contrôle `create_project_requires_billing_and_deploying_identity` rejette sinon la combinaison, par conception.
- **`tofu destroy` sur un déploiement du chemin B échoue sur la ressource du projet :** le lien de suppression (phase 4.5) et le garde-fou `deletion_policy = "DELETE"` propre au provider sont tous deux une friction délibérée contre la suppression accidentelle. Le retrait du lien est une étape distincte et explicite — consultez la note « Sandbox project lifecycle » du Guide de configuration avant de le faire sur un projet susceptible de contenir de vraies données d'utilisateurs.

---

## Phase 7 — Supprimer [MANUEL] {#phase-7--tear-down-manual}

> **Lisez ceci avant de supprimer.** Selon la conception du cycle de vie des projets sandbox de la plateforme, un projet du chemin B est destiné à être **créé à neuf uniquement** — il n'est pas prévu qu'il soit détruit puis recréé sous le même `project_id` ou un nouveau pour un autre utilisateur. Ne supprimez un projet du chemin B que si vous êtes certain qu'aucune donnée utilisateur réelle et non reproductible n'y a jamais été déployée (par exemple s'il s'agissait d'une exécution de lab/test).

### Étape 7.1 — Chemin A (gouverné, non créé) {#step-71--path-a-governed-not-created}

Exécutez simplement `tofu destroy` (ou supprimez le déploiement depuis la plateforme RAD). Cela retire les ressources `google_project_service` et `google_cloud_quotas_quota_preference` — l'activation des API est laissée en place par conception (`disable_on_destroy = false` sur `google_project_service.enabled`), car désactiver des API sous un projet dont d'autres ressources peuvent encore dépendre est bien plus risqué que de les laisser activées.

### Étape 7.2 — Chemin B (créé par ce module) {#step-72--path-b-created-by-this-module}

1. Retirez d'abord tout ce qui est en aval (`Services GCP`, modules applicatifs) — la destruction propre à ce module ne se propage pas à eux en cascade, et ils cesseront de fonctionner si leur VPC/base de données/NFS disparaît en premier.
2. Retirez explicitement le lien de suppression :
   ```bash
   gcloud alpha resource-manager liens delete <LIEN_ID> --project=${PROJECT}
   ```
   (Obtenez `<LIEN_ID>` à partir du champ `name` de la phase 4.5.)
3. Exécutez `tofu destroy`. Le lien étant retiré et `deletion_policy = "DELETE"` déjà défini, cela supprime le projet (sous réserve de la fenêtre standard de suppression réversible de 30 jours de GCP — voir le Guide de configuration).

**Durée de suppression attendue :** 2–5 minutes pour les ressources de garde-fous ; la suppression du projet elle-même est asynchrone et le projet passe dans l'état de suppression réversible propre à GCP plutôt que de disparaître immédiatement.

---

## Résumé {#summary}

| Action | Phase | Automatisé |
|---|---|---|
| Choisir le chemin A (projet existant) ou le chemin B (créer et gouverner) et configurer les variables | 1.1 | Manuel |
| Déployer la liste d'API autorisées, les préférences de quota et (chemin B) le projet + les ensembles IAM | 1.2 | Automatisé |
| Relever les sorties | 1.3 | Manuel |
| Vérifier les API activées/autorisées | 2 | Manuel |
| Vérifier les préférences de quota appliquées | 3 | Manuel |
| Vérifier la création du projet, la séparation des identités, la règle de refus et le lien (chemin B) | 4 | Manuel |
| Vérifier les règles d'administration héritées du dossier (informatif) | 5 | Manuel |
| Dépanner les problèmes courants | 6 | Manuel |
| Supprimer (avec précaution quant au cycle de vie) | 7 | Manuel |
