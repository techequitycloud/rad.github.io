---
title: "Préparation ACE, section 1 : configuration de l'environnement de solution cloud"
description: "Préparez la section 1 de l'examen Associate Cloud Engineer (ACE) — configuration d'un environnement de solution cloud — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/ACE_Section_1_Exploration_Guide.md @ cb682e8 sha256:10ea82a60878 -->

# Guide de préparation à la certification ACE : Section 1 — Configuration d'un environnement de solution cloud (Setting up a cloud solution environment) (~20 % de l'examen) {#ace-certification-preparation-guide-section-1--setting-up-a-cloud-solution-environment-20-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/ace_section1.png" alt="Guide de préparation à la certification ACE : Section 1 — Configuration d'un environnement de solution cloud (~20 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [certification Associate Cloud Engineer](https://cloud.google.com/learn/certification/cloud-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la Section 1 de l'examen en utilisant les modules de base de la plateforme RAD comme lab pratique. Le module mis en œuvre ici est presque exclusivement `Services_GCP` — la couche plateforme déployée une fois par projet. Déployez le profil **plateforme de base** de la [cartographie des labs](ACE_Certification_Guide.md) avant de commencer ; ajoutez le profil **compléments d'exploitation et de sécurité** (plus précisément `create_billing_budget = true`) pour la sous-section 1.2.

---

## 1.1 Configuration des projets et des comptes cloud (Setting up cloud projects and accounts) {#11-setting-up-cloud-projects-and-accounts}

> ⏱ ~60 min · 💰 aucun coût supplémentaire au-delà du profil de base · ⚙️ Prérequis : déploiement par défaut de la plateforme de base

**Pourquoi l'examen s'y intéresse** — L'examen vérifie que vous comprenez le projet comme frontière fondamentale de facturation, d'IAM et d'API : comment les projets se rattachent aux dossiers et aux organisations, pourquoi les API doivent être activées avant de pouvoir créer des ressources, comment des rôles sont attribués aux identités (utilisateurs, groupes, comptes de service) et comment vérifier les quotas avant qu'ils ne vous bloquent. Le guide actuel mentionne aussi les règles d'administration, les organisations autonomes, la gestion des utilisateurs et groupes Cloud Identity (manuelle et automatisée), la mise en place du réseau et de Google Cloud Observability, la vérification de la disponibilité des produits par région/zone, Cloud Asset Inventory avec Gemini Cloud Assist, et Workforce Identity Federation. Les questions de mise en situation reposent souvent sur le fait qu'un ID de projet est immuable, que les API sont activées projet par projet et que les liaisons à des groupes sont préférables aux liaisons à des utilisateurs individuels.

**Comment RAD le met en œuvre** — Chaque module se déploie dans un projet *existant* désigné par `project_id` (obligatoire, sans valeur par défaut) ; les modules ne créent jamais de projets, de dossiers ni d'organisations. Lors de l'application, `Services_GCP` active environ 45 API de services lorsque `enable_services` (par défaut `true`) est défini — la liste comprend `compute.googleapis.com`, `run.googleapis.com`, `container.googleapis.com`, `sqladmin.googleapis.com`, `secretmanager.googleapis.com`, `cloudkms.googleapis.com`, et d'autres ; `additional_apis` (par défaut `[]`) y ajoute les vôtres. Configuration des identités :

| Variable | Valeur par défaut | Effet |
|---|---|---|
| `project_id` | — (obligatoire) | Projet cible de toutes les ressources |
| `tenant_id` | `"demo"` | Suffixe de tenant utilisé dans le nommage des ressources |
| `enable_services` | `true` | Active les ~45 API requises lors de l'application |
| `additional_apis` | `[]` | API supplémentaires à activer |
| `support_users` | `[]` | Adresses e-mail qui reçoivent les canaux de notification de surveillance et de budget |
| `resource_labels` | `{}` | Libellés fusionnés sur chaque ressource gérée par le module |
| `resource_creator_identity` | compte de service de déploiement de la plateforme | Compte de service sous lequel Terraform s'exécute |

`Services_GCP` crée cinq comptes de service dédiés par déploiement — `cloudbuild-sa-{prefix}`, `clouddeploy-sa-{prefix}`, `cloudrun-sa-{prefix}`, `nfs-sa-{prefix}` et `gke-sa-{prefix}` — liés à des rôles prédéfinis, avec une exception à repérer : `cloudbuild-sa-{prefix}` détient aussi le rôle de base `roles/viewer` au niveau du projet. Le même module construit également le réseau du projet (VPC en mode personnalisé, sous-réseaux, Cloud NAT — voir la [Section 2.3](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources)) ainsi que ses premières alertes et ses premiers canaux de notification Cloud Monitoring (voir la [Section 3.4](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging)). Le contexte d'organisation est découvert automatiquement : la plateforme lit `org_id` depuis la source de données du projet, et les fonctionnalités dépendantes de l'organisation (VPC-SC, notifications SCC) sont simplement ignorées lorsque le projet n'a pas d'organisation ou que l'appelant ne dispose pas d'autorisations au niveau de l'organisation.

**Essayez**
1. Dans le portail, définissez `resource_labels = { environment = "dev", team = "platform" }` et redéployez. Dans la console, allez dans **Cloud SQL > your instance** (votre instance) et vérifiez que les libellés apparaissent dans les détails de l'instance.
2. Inspectez le projet et ses API activées depuis Cloud Shell :
   ```bash
   gcloud projects describe $GOOGLE_CLOUD_PROJECT
   gcloud services list --enabled --filter="config.name:run.googleapis.com OR config.name:sqladmin.googleapis.com"
   ```
   Notez les trois identifiants dans la sortie de `describe` : l'ID du projet (immuable), le numéro du projet et le nom à afficher (modifiable).
3. Listez les comptes de service créés par le module et inspectez une liaison :
   ```bash
   gcloud iam service-accounts list --filter="email:cloudrun-sa"
   gcloud projects get-iam-policy $GOOGLE_CLOUD_PROJECT \
     --flatten="bindings[].members" \
     --filter="bindings.members:cloudrun-sa" \
     --format="table(bindings.role)"
   ```
4. Vérifiez un quota consommé par votre déploiement : **IAM & Admin > Quotas & System Limits**, filtrez sur *Cloud SQL Admin API*. Équivalent en ligne de commande pour les quotas Compute : `gcloud compute regions describe us-central1 --format="table(quotas.metric,quotas.usage,quotas.limit)"`.
5. Vous savez que cela a fonctionné lorsque la requête de stratégie IAM ne renvoie ni `roles/owner` ni `roles/editor` (exécutez la même requête pour `cloudbuild-sa` afin de trouver l'unique rôle de base, `roles/viewer`) et que la liste des services activés contient les API ci-dessus.

**Testez-vous**
<details>
<summary>Q1 : Un collègue déploie le profil plateforme de base dans un projet neuf, et l'application échoue avec des erreurs « API not enabled » pour Compute Engine. Il avait défini <code>enable_services = false</code>. Quelle est la correction la plus rapide, et pourquoi la valeur par défaut évite-t-elle ce problème ?</summary>

R : Réactivez `enable_services = true` (ou exécutez manuellement `gcloud services enable compute.googleapis.com ...`). GCP refuse de créer toute ressource dont l'API est désactivée dans le projet ; la valeur par défaut du module active d'emblée les ~45 API requises, précisément pour que les ressources en aval (VPC, Cloud SQL, NAT) puissent être créées en une seule application.
</details>

<details>
<summary>Q2 : Vous avez besoin que 12 ingénieurs d'exploitation reçoivent les alertes de surveillance. Devez-vous lister 12 adresses dans <code>support_users</code> ou une seule adresse de groupe Google ?</summary>

R : Utilisez une seule adresse de groupe. Le module crée un canal de notification par entrée, et la bonne pratique de gestion de l'IAM et des notifications consiste à lier des groupes, pas des individus — les changements d'appartenance dans Cloud Identity / Google Workspace se propagent alors automatiquement, sans toucher au déploiement.
</details>

<details>
<summary>Q3 : Quelle est la différence entre l'ID, le numéro et le nom d'un projet ?</summary>

R : L'ID du projet est une chaîne unique au niveau mondial, immuable et choisie par une personne, utilisée dans les API et les URL ; le numéro du projet est un identifiant numérique unique au niveau mondial et immuable, attribué par Google (il apparaît dans les adresses e-mail des comptes de service par défaut) ; le nom du projet est un libellé d'affichage modifiable, sans exigence d'unicité.
</details>

**Au-delà des modules** — L'examen porte aussi sur des éléments que les modules ne gèrent délibérément pas :
- *Création de projets et de la hiérarchie :* entraînez-vous avec `gcloud projects create my-lab-project --folder=FOLDER_ID` et parcourez **IAM & Admin > Manage Resources** pour observer l'héritage Organisation → Dossier → Projet.
- *Organisations autonomes :* sachez comment une ressource d'organisation voit le jour (un domaine Cloud Identity ou Google Workspace) et ce qui change pour les projets créés sans organisation au-dessus d'eux.
- *Cloud Identity :* le cycle de vie des utilisateurs et des groupes se gère dans admin.google.com, pas dans GCP — manuellement dans la console d'administration, ou de manière automatisée (par ex. Google Cloud Directory Sync depuis un annuaire existant, ou les API Cloud Identity). Sachez que les stratégies IAM peuvent lier des comptes principaux `user:`, `group:`, `serviceAccount:` et `domain:`.
- *Workforce Identity Federation :* permet à des utilisateurs d'un fournisseur d'identité externe (OIDC ou SAML) d'accéder à Google Cloud sans compte Cloud Identity, via un pool de personnel créé au niveau de l'organisation. À ne pas confondre avec *Workload* Identity Federation (pour les charges de travail — voir la Section 4.2), que `Services_GCP` met bien en œuvre.
- *Augmentations de quota :* trouvez un quota dans **IAM & Admin > Quotas & System Limits** et parcourez (sans la soumettre) la procédure de demande d'augmentation **Edit Quotas** ; une augmentation de quota est une demande, pas un changement instantané.
- *Règles d'administration :* parcourez **IAM & Admin > Organization Policies** (par ex. `constraints/compute.vmExternalIpAccess`). Les modules ne gèrent pas les contraintes de règles d'administration, mais ils sont écrits pour en respecter certaines : le modèle d'instance de la VM NFS définit `enable-oslogin = true` et les options Shielded VM précisément parce que `constraints/compute.requireOsLogin` et `constraints/compute.requireShieldedVm` peuvent être appliquées au-dessus du projet.
- *Disponibilité des produits par emplacement :* chaque produit ou type de machine n'existe pas dans toutes les régions/zones. Vérifiez avec `gcloud compute zones list`, `gcloud compute machine-types list --filter="zone:us-central1-a"` et la page des emplacements du produit avant de choisir `availability_regions`.
- *Cloud Asset Inventory et Gemini Cloud Assist :* recherchez et exportez les métadonnées des ressources de plusieurs projets (`gcloud asset search-all-resources --scope=projects/$GOOGLE_CLOUD_PROJECT`, `gcloud asset export`), et demandez à Gemini Cloud Assist, dans la console, de résumer ou d'analyser ces ressources. Aucun des deux n'est configuré par les modules — essayez-les sur les ressources créées par votre déploiement.

**⚠️ Piège d'examen** — Activer une API et accorder une autorisation IAM sont deux choses indépendantes : un utilisateur disposant de `roles/run.admin` ne peut toujours pas déployer sur Cloud Run si `run.googleapis.com` est désactivée dans le projet, et activer l'API n'accorde d'accès à personne.

---

## 1.2 Gestion de la configuration de la facturation (Managing billing configuration) {#12-managing-billing-configuration}

> ⏱ ~40 min · 💰 le budget lui-même est gratuit ; les e-mails d'alerte sont gratuits · ⚙️ Prérequis : `create_billing_budget = true` (profil compléments d'exploitation et de sécurité)

**Pourquoi l'examen s'y intéresse** — L'examen attend de vous que vous sachiez créer des comptes de facturation, y associer des projets, créer des budgets avec des alertes de seuil et exporter les données de facturation pour les analyser. Critères de décision : les budgets *notifient*, ils n'arrêtent jamais les dépenses ; les exports de facturation vers BigQuery sont le seul moyen d'analyser les coûts historiques par libellé ; le rôle Billing Account Administrator est distinct de l'IAM du projet.

**Comment RAD le met en œuvre** — `Services_GCP` crée un véritable budget Cloud Billing lorsque `create_billing_budget` (par défaut `false`) est activé. Le compte de facturation est *découvert automatiquement* à partir du projet — il n'existe aucune variable de compte de facturation, et le module n'associe ni ne dissocie jamais de projets. Le budget est limité au seul projet courant par un `budget_filter`.

| Variable | Valeur par défaut | Effet |
|---|---|---|
| `create_billing_budget` | `false` | Crée le budget limité au projet |
| `budget_amount` | `100` | Montant du budget dans la devise du compte de facturation |
| `budget_alert_thresholds` | `[0.5, 0.9, 1.0]` | Une règle de seuil par entrée (50 %, 90 %, 100 %) |
| `budget_alert_emails` | `[]` | Fusionnées avec `support_users` dans les canaux de notification par e-mail |

Le budget relie les canaux de notification par e-mail et laisse activés les destinataires IAM par défaut, si bien que les administrateurs et utilisateurs du compte de facturation sont également notifiés. Par ailleurs, `resource_labels` (par défaut `{}`) se propage sur chaque ressource gérée par le module, ce qui rend possible le filtrage des coûts par libellé dans les rapports de facturation et les exports BigQuery.

**Essayez**
1. Dans le portail, définissez `create_billing_budget = true`, `budget_amount = 50` et ajoutez votre adresse e-mail à `budget_alert_emails`. Redéployez `Services_GCP`.
2. Vérifiez dans la console sous **Billing > Budgets & alerts** — vous devriez voir « Budget for `<project-id>` » avec trois règles de seuil. En ligne de commande :
   ```bash
   BILLING_ACCOUNT=$(gcloud billing projects describe $GOOGLE_CLOUD_PROJECT \
     --format="value(billingAccountName)")
   gcloud billing budgets list --billing-account=${BILLING_ACCOUNT##*/}
   ```
3. Explorez l'attribution des coûts par libellé : **Billing > Reports**, ouvrez le filtre **Labels** à droite et sélectionnez une clé définie dans `resource_labels` (les données apparaissent avec un délai pouvant aller jusqu'à une journée).
4. Vous savez que cela a fonctionné lorsque `gcloud billing budgets list` affiche votre budget avec des `thresholdRules` à 0,5 ; 0,9 et 1,0.

**Testez-vous**
<details>
<summary>Q1 : Votre budget a déclenché son alerte à 100 %, mais les ressources continuent de tourner et les coûts continuent de s'accumuler. Quelque chose est-il cassé ?</summary>

R : Non. Les budgets ne font qu'envoyer des notifications (par e-mail et, en option, via Pub/Sub) — ils ne plafonnent jamais les dépenses et n'arrêtent jamais les ressources. Une réponse automatisée aux coûts suppose de relier une notification de budget Pub/Sub à votre propre automatisation (par ex. une fonction qui désactive la facturation) ; l'examen attend de vous que vous sachiez qu'il s'agit d'un développement sur mesure, pas d'une simple case à cocher.
</details>

<details>
<summary>Q2 : Le service financier souhaite une ventilation mensuelle des coûts par équipe pour tout ce que déploie la plateforme RAD. Quels sont les deux éléments qui le permettent ?</summary>

R : (1) Des `resource_labels` cohérents (par ex. `team = "platform"`) sur chaque ressource, que les modules appliquent automatiquement, et (2) un export de facturation vers BigQuery, configuré au niveau du compte de facturation sous **Billing > Billing export**, que vous interrogez ensuite en regroupant par clé de libellé. Le filtrage par libellé dans les rapports de facturation convient aux consultations ponctuelles, mais BigQuery est la réponse pour les rapports programmatiques ou de refacturation interne.
</details>

**Au-delà des modules** — Non implémenté par les modules de base ; entraînez-vous directement :
- *Création de comptes de facturation :* **Billing > Manage billing accounts > Create account** — sachez qu'un compte de facturation peut payer pour de nombreux projets, et qu'en créer un sous une organisation nécessite le rôle Billing Account Creator (`roles/billing.creator`).
- *Association d'un projet à un compte de facturation :* `gcloud billing projects link my-project --billing-account=0X0X0X-0X0X0X-0X0X0X` (nécessite Billing Account User sur le compte + Project Billing Manager ou Owner sur le projet).
- *Exports de facturation :* activez l'export BigQuery (coût d'utilisation standard) sous **Billing > Billing export** ; aucun code Terraform de ce dépôt ne s'en charge.
- *IAM de la facturation :* connaissez `roles/billing.admin`, `roles/billing.user` (peut associer des projets) et `roles/billing.viewer`, et sachez qu'ils s'appliquent au compte de facturation, pas au projet.

**⚠️ Piège d'examen** — Les seuils de budget peuvent déclencher une alerte sur les dépenses *prévisionnelles* aussi bien que sur les dépenses réelles ; par ailleurs, un budget limité à un compte de facturation n'est pas la même chose qu'un budget limité à un projet — le budget du module utilise un filtre de projet, si bien que les autres projets du même compte de facturation ne sont pas comptabilisés.
