---
title: "Environnement de démonstration Gemini Enterprise"
description: "Référence de configuration pour le module RAD Gemini Enterprise sur Google Cloud — l'application de démonstration Cymbal Pools, le magasin de données, l'agent BigQuery sur Agent Runtime, Model Armor, les variables et les sorties."
---

<!-- translated-from: docs/modules/Gemini_Enterprise.md @ 7d02aa0b sha256:076f0cd0ada4 -->

# Environnement de démonstration Gemini Enterprise {#gemini-enterprise-demo-environment}

Ce module prépare un projet Google Cloud pour une **démonstration de Gemini Enterprise dirigée par un instructeur**, construite autour de la société fictive **Cymbal Pools**. C'est un **module autonome** : il crée son propre bucket, son propre ensemble de données, son propre agent et sa propre application, et ne dépend d'aucune infrastructure de base partagée.

Lors de l'apply, le module crée l'application Gemini Enterprise avec Google Identity configuré, un magasin de données consultable de documents Cymbal Pools, un bucket de contenu (documents Drive, image d'annonce, image de table de pH, données d'amorçage BigQuery, source d'agent ADK), une table BigQuery `installation_requests`, un agent BigQuery ADK personnalisé sur Vertex AI Agent Runtime avec l'IAM dont il a besoin, et un modèle Model Armor. L'instructeur complète ensuite les quelques étapes qui nécessitent une connexion interactive à Google Workspace (connecteurs Drive/Agenda, client OAuth, enregistrement d'agent) et exécute les démonstrations.

Ce guide couvre les services cloud que le module provisionne et comment les explorer et les utiliser à partir de la Google Cloud Console et de la ligne de commande. La liste de contrôle complète avant le cours et le script de démonstration en classe se trouvent dans le [Guide de Lab](https://docs.radmodules.dev/docs/labs/Gemini_Enterprise).

Les ressources portent le suffixe de déploiement `<id>` : bucket `<project>-ge-<id>`, application `cymbal-pools-ge-<id>`, magasin de données `cymbal-pools-docs-<id>`, modèle Model Armor `cymbal-pools-ma-<id>`, et moteur Agent Runtime "BigQuery Pool Data Agent (\<id>)".

---

## 1. Vue d'ensemble {#1-overview}

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Application d'espace de travail agentique | Gemini Enterprise (Discovery Engine) | Application `APP_TYPE_INTRANET`, niveau de recherche Enterprise avec l'add-on LLM, nom de l'entreprise "Cymbal Pools" |
| Identité | Configuration ACL de Gemini Enterprise | Google Identity (`GSUITE`) sélectionné pour l'emplacement de l'application |
| Documents d'entreprise | Magasin de données Discovery Engine | Basé sur Cloud Storage, non structuré ; indexe la brochure PDF et le DOCX d'analyse |
| Contenu de démonstration | Cloud Storage | Documents Drive, image d'annonce, image de table de pH, CSV d'amorçage, source d'agent `adk_to_ge/` |
| Données d'installation de piscine | BigQuery | `cymbal_pools.installation_requests`, amorcé avec 60 lignes d'échantillon |
| Agent personnalisé | Vertex AI Agent Runtime (Agent Engine) + ADK | Agent BigQuery déployé avec `adk deploy agent_engine`, exécuté en tant que `resource_creator_identity` |
| Sécurité de l'IA | Model Armor | Modèle avec SDP, RAI, filtres d'injection de prompt/jailbreak et d'URI malveillants |

**Ce qu'il faut savoir d'emblée :**

- **Gemini Enterprise doit être activé dans le projet en premier.** Sur un projet qui ne l'a jamais utilisé, ouvrez Gemini Enterprise dans la console une fois et cliquez sur **Démarrer l'essai gratuit**. L'activation de `discoveryengine.googleapis.com` n'est pas la même chose, et la création de l'application échoue tant que l'essai n'est pas démarré. Définissez `create_gemini_enterprise_app = false` pour créer l'application à la main à la place.
- **Plusieurs étapes sont délibérément manuelles.** Les connecteurs Google Drive et Agenda et l'écran/client de consentement OAuth nécessitent des flux OAuth interactifs que seule la console fournit. L'enregistrement de l'agent BigQuery nécessite ce client OAuth, et l'octroi du rôle "Utilisateur d'agent" de l'agent à tous les utilisateurs n'a pas d'API. Les annonces, les commutateurs de gestion des fonctionnalités et l'attachement de Model Armor à l'assistant sont démontrés en direct.
- **Tout partage un seul emplacement Gemini Enterprise.** L'application, ses magasins de données, le fournisseur d'identité, les connecteurs Drive/Agenda et l'enregistrement de l'agent doivent tous résider dans `ge_location` (`global` par défaut).
- **Le déploiement de l'agent exécute Python sur le runner Terraform.** `null_resource.deploy_adk_agent` crée un virtualenv sous `$HOME/.local/ge-adk-venv`, installe `google-adk`, et exécute `adk deploy agent_engine` via un petit wrapper (`scripts/adk_deploy.py`) qui fait en sorte que l'ADK emprunte l'identité de `resource_creator_identity`. Le déploiement prend 5 à 10 minutes.
- **Le contenu de démonstration est original.** Cymbal Pools est fictif ; le PDF, le DOCX, les images et le CSV dans `assets/` ont été écrits pour ce module et peuvent être régénérés avec `assets/generate_assets.py`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent qu'elles sont définies pour correspondre à votre déploiement. Les noms de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

```bash
export PROJECT="<project_id>"
export REGION="us-central1"      # region (Agent Runtime)
export GE_LOCATION="global"      # ge_location
export ID="<deployment_id>"
export GE_HOST=discoveryengine.googleapis.com   # use ${GE_LOCATION}-discoveryengine.googleapis.com for us/eu
```

### A. Application Gemini Enterprise, identité et magasin de données {#a-gemini-enterprise-app-identity-and-data-store}

L'application (`cymbal-pools-ge-<id>`) est un moteur de type intranet avec le niveau de recherche Enterprise et l'add-on LLM. Google Identity est défini comme fournisseur d'identité pour `ge_location` afin que les connecteurs avec ACL (Drive, Agenda) puissent y être créés. Le magasin de données `cymbal-pools-docs-<id>` est attaché à l'application lors de sa création et indexe les documents sous `gs://<bucket>/drive/`.

- **Console :** **Gemini Enterprise** → Applications (définissez le filtre d'emplacement sur `ge_location` ou *Tous les emplacements*) → **Cymbal Pools GE**. Les magasins de données connectés, l'intégration, les agents et les configurations se trouvent dans la navigation de gauche de l'application.
- **CLI :**
  ```bash
  TOKEN=$(gcloud auth print-access-token)
  # The app
  curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJECT" \
    "https://$GE_HOST/v1/projects/$PROJECT/locations/$GE_LOCATION/collections/default_collection/engines/cymbal-pools-ge-$ID"
  # Data stores in the location (the Drive/Calendar/Announcements ones appear here once created)
  curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJECT" \
    "https://$GE_HOST/v1/projects/$PROJECT/locations/$GE_LOCATION/collections/default_collection/dataStores"
  # Documents indexed from the bucket
  curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJECT" \
    "https://$GE_HOST/v1/projects/$PROJECT/locations/$GE_LOCATION/collections/default_collection/dataStores/cymbal-pools-docs-$ID/branches/default_branch/documents"
  ```

### B. Cloud Storage — contenu de démonstration {#b-cloud-storage--demo-content}

| Objet | Utilisé pour |
|---|---|
| `drive/Cymbal Pools Convention Brochure.pdf` | Téléchargement vers Google Drive ; démonstration de ciblage de fichiers "Summarize @" |
| `drive/Cymbal Pools Pool Installation Analysis.docx` | Téléchargement vers Google Drive ; démonstration de recherche d'entreprise "comment effectuons-nous une inspection de site de piscine ?" |
| `pool party.png` | URL de l'image de l'annonce "Annual pool party" (lecture publique lorsque `public_announcement_image = true`) |
| `pH table.png` | Coller dans la barre omni pour la démonstration "Convertir cette image en données tabulaires" |
| `bigquery/installation_requests.csv` | Données d'amorçage chargées dans BigQuery |
| `adk_to_ge/` | Source de l'agent ADK (`bigquery_agent/`, `construct_auth_uri.py`, `requirements.txt`) |

- **Console :** **Cloud Storage** → Buckets → `<project>-ge-<id>` (lien direct dans la sortie `drive_documents_console_url`).
- **CLI :**
  ```bash
  gcloud storage ls -r "gs://$PROJECT-ge-$ID/"
  gcloud storage cp "gs://$PROJECT-ge-$ID/drive/*" .           # the two Drive documents
  gcloud storage cp -r "gs://$PROJECT-ge-$ID/adk_to_ge" .      # the agent source
  curl -sI "https://storage.googleapis.com/$PROJECT-ge-$ID/pool%20party.png" | head -1   # expect 200 if public
  ```

### C. BigQuery — demandes d'installation {#c-bigquery--installation-requests}

`cymbal_pools.installation_requests` contient les demandes d'installation de piscines résidentielles : `request_id`, `request_date`, `length_m`, `width_m`, `depth_m`, `has_hot_tub`, `has_waterfall`, `zip_code`, `customer_phone`, `customer_email`. Il est amorcé par un job de chargement BigQuery dont l'ID intègre le hachage du CSV, de sorte que les lignes que l'agent insère pendant une démonstration survivent aux apply ultérieurs, sauf si le CSV d'amorçage lui-même change.

- **Console :** **BigQuery** → Explorateur → `<project>` → `cymbal_pools` → `installation_requests`. Les requêtes exécutées par l'agent apparaissent sous **Historique des jobs → Historique du projet**.
- **CLI :**
  ```bash
  bq show --schema --format=prettyjson "$PROJECT:cymbal_pools.installation_requests"
  bq query --use_legacy_sql=false \
    "SELECT COUNT(*) AS requests, ROUND(AVG(length_m*width_m*depth_m),1) AS avg_volume_m3 FROM \`$PROJECT.cymbal_pools.installation_requests\`"
  ```

### D. Vertex AI Agent Runtime — Agent BigQuery {#d-vertex-ai-agent-runtime--bigquery-agent}

L'agent ADK (`adk_to_ge/bigquery_agent`) utilise l'ADK `BigQueryToolset` avec le mode d'écriture autorisé et des instructions qui le restreignent à `SELECT`/`INSERT` sur `installation_requests`. Par défaut, il interroge en tant qu'**agent de service AI Platform Reasoning Engine** (`service-<number>@gcp-sa-aiplatform-re.iam.gserviceaccount.com`), auquel le module accorde `roles/aiplatform.user`, `roles/bigquery.user` et `roles/bigquery.dataEditor`. La définition de `agent_auth_id` lui fait utiliser le jeton OAuth de l'utilisateur Gemini Enterprise à la place (voir [Comportement](#3-behaviour)).

- **Console :** **Vertex AI** → Agent Runtime (sélectionnez `region`) → "BigQuery Pool Data Agent (\<id>)".
- **CLI :**
  ```bash
  TOKEN=$(gcloud auth print-access-token)
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://$REGION-aiplatform.googleapis.com/v1/projects/$PROJECT/locations/$REGION/reasoningEngines" \
    | python3 -c "import json,sys; [print(e['name'], '|', e.get('displayName')) for e in json.load(sys.stdin).get('reasoningEngines',[])]"
  gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
    --filter="bindings.members:gcp-sa-aiplatform-re" --format="table(bindings.role)"
  ```

### E. Model Armor {#e-model-armor}

Un modèle, `cymbal-pools-ma-<id>`, dans `model_armor_location` (par défaut `ge_location`, sauf qu'une application `global` obtient un modèle `us` : Model Armor rejette les modèles dans `global` avec `UNSUPPORTED_REQUEST_LOCATION`, et l'assistant d'une application `global` accepte un modèle `us`, les deux étant confirmés en direct). Chaque filtre correspond à un groupe de prompts de test du lab : protection des données sensibles de base (numéros de carte, identifiants), filtres d'IA responsable (harcèlement, discours de haine, dangereux, sexuellement explicite) à `model_armor_confidence`, détection d'injection de prompt/jailbreak, et détection d'URI malveillants. L'application est `INSPECT_AND_BLOCK`. Le module ne l'attache **pas** à l'assistant ; l'instructeur le fait en direct sous **Configurations → Assistant → Activer Model Armor**.

- **Console :** **Sécurité → Model Armor** → `cymbal-pools-ma-<id>`.
- **CLI :**
  ```bash
  gcloud model-armor templates describe "cymbal-pools-ma-$ID" --location="$GE_LOCATION" --project="$PROJECT"
  ```

---

## 3. Comportement {#3-behaviour}

**Ce qui est provisionné lors de l'apply.** Dans l'ordre de dépendance : les API du projet (Discovery Engine, Vertex AI, BigQuery, Cloud Storage, IAM et IAM Credentials, Resource Manager, Service Usage, Model Armor, Cloud Build, Logging, Monitoring, Cloud Trace) ; le bucket de contenu et ses objets ; l'ensemble de données BigQuery, la table et le job de chargement d'amorçage ; la configuration ACL de Google Identity ; l'agent de service Discovery Engine (avec accès en lecture au bucket), le magasin de données de documents, et un appel `documents:import` ; l'application Gemini Enterprise ; le modèle Model Armor ; et enfin le déploiement de l'agent suivi des liaisons IAM de l'agent de service Reasoning Engine. Ces liaisons doivent être effectuées après le déploiement, car cet agent de service n'existe qu'une fois le premier moteur du projet créé.

**Importation de documents.** Discovery Engine n'a pas de ressource Terraform pour l'importation de documents, donc `null_resource.import_cymbal_docs` appelle `documents:import` avec `gs://<bucket>/drive/*` et réessaie pendant environ deux minutes pendant que l'octroi du bucket par l'agent de service se propage. L'importation est asynchrone : l'apply retourne une fois qu'elle a *commencé*, et l'indexation se termine quelques minutes plus tard. L'importation est relancée si le contenu de l'un des documents change.

**Déploiement et identité de l'agent.** `adk deploy agent_engine` n'a pas d'option d'emprunt d'identité, donc le module l'exécute via `scripts/adk_deploy.py`. Ce wrapper remplace `google.auth.default()` par des identifiants impersonnalisés de courte durée pour `resource_creator_identity` avant le chargement de l'ADK, de sorte que le moteur est créé par la même identité que toutes les autres ressources. Avec `resource_creator_identity` vide, il se comporte exactement comme `adk`. Le wrapper écrit le nom de ressource `reasoningEngines` résultant dans `scripts/reasoning_engine.txt`, et la sortie `reasoning_engine` lit ce fichier.

**Emplacement du modèle vs. région de déploiement.** `adk deploy --region X` force `GOOGLE_CLOUD_LOCATION=X` à l'intérieur du conteneur déployé, annulant toute valeur dans `.env` de l'agent. (La ligne `GOOGLE_CLOUD_LOCATION=global` du lab original est donc ignorée.) Le module transmet l'emplacement du modèle séparément en tant que `MODEL_LOCATION` (`agent_model_location`, par défaut `global`), et l'agent l'applique avant la création du client du modèle.

**Accès BigQuery par utilisateur vs. par agent de service.** Avec `agent_auth_id` vide (par défaut), l'agent interroge en tant qu'agent de service Reasoning Engine, de sorte que la démonstration fonctionne que l'agent ait été enregistré ou non avec une autorisation OAuth. Définissez `agent_auth_id` sur l'ID d'autorisation Gemini Enterprise (par exemple `bq-auth`) pour que les requêtes s'exécutent en tant qu'utilisateur connecté ; l'agent lit alors le jeton que Gemini Enterprise stocke dans l'état de session sous cette clé. Le modifier redéploie l'agent.

**Les modifications de la console sont conservées.** L'application ignore la dérive sur `data_store_ids`, `features` et `knowledge_graph_config`. Par conséquent, les connecteurs que l'instructeur attache et les commutateurs de gestion des fonctionnalités (Agent Designer, modèle d'image, partage de session) ne sont pas annulés par un apply ultérieur.

**Suivi manuel effectué par l'instructeur.** Téléchargez les documents Drive, créez les connecteurs Drive/Agenda et le magasin de données Annonces, créez l'écran de consentement OAuth et le client Web, enregistrez l'agent BigQuery (éventuellement avec une autorisation), accordez le rôle d'utilisateur d'agent à tous les utilisateurs, confirmez l'identité de la main-d'œuvre sur la page d'intégration de l'application et activez les options de gestion des fonctionnalités. Toutes ces étapes sont énumérées pas à pas dans le Guide de Lab.

**Comportement de nettoyage.** Destroy supprime l'application, le magasin de données, la configuration ACL, le bucket (détruit de force avec son contenu), l'ensemble de données BigQuery (avec son contenu), le modèle Model Armor, les liaisons IAM et le moteur Agent Runtime. Le provisionneur de destruction du moteur le trouve par son nom d'affichage plutôt que par le fichier local, car ce fichier ne survit pas entre les exécutions de la plateforme. Destroy ne supprime **pas** tout ce qui a été créé à la main. La suppression de l'application ne supprime pas les magasins de données qui y sont attachés, de sorte que les magasins de données Drive, Agenda et Annonces doivent être supprimés de **Gemini Enterprise → Magasins de données** par la suite. Il en va de même pour le client OAuth et l'écran de consentement, la ressource d'autorisation et les fichiers téléchargés sur Google Drive. L'enregistrement de l'agent réside dans l'application et disparaît avec elle. Les API restent activées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et emplacement {#group-1--project--location}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet cible. Doit déjà exister. Pour Qwiklabs, le projet de lab avec le compte étudiant, afin que les connecteurs et l'application partagent une identité Workspace. |
| `region` | `us-central1` | Région Agent Runtime pour l'agent ADK. Doit être autorisée par toute politique `constraints/gcp.resourceLocations`. |

### Groupe 2 — Application Gemini Enterprise {#group-2--gemini-enterprise-app}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_gemini_enterprise_app` | `true` | Crée l'application et le magasin de données de documents Cymbal Pools. Nécessite que l'essai gratuit (ou une licence) ait été démarré au préalable. |
| `ge_location` | `global` | `global`, `us` ou `eu`. L'application, les magasins de données, l'IdP, les connecteurs et l'enregistrement de l'agent doivent tous le partager. |
| `app_display_name` | `Cymbal Pools GE` | Nom d'affichage de l'application. |
| `company_name` | `Cymbal Pools` | Nom de l'entreprise sur l'application (Options avancées). |
| `configure_google_identity` | `true` | Sélectionne Google Identity comme IdP pour `ge_location`. Obligatoire avant les connecteurs Drive/Agenda. |

### Groupe 3 — Contenu de démonstration {#group-3--demo-content}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `bucket_location` | `US` | Emplacement du bucket de contenu. |
| `public_announcement_image` | `true` | Rend seulement `pool party.png` public-read afin que l'annonce s'affiche pour chaque utilisateur. |
| `bq_dataset_id` | `cymbal_pools` | Ensemble de données BigQuery pour `installation_requests`. |
| `bq_location` | `US` | Emplacement de l'ensemble de données BigQuery. |

### Groupe 4 — Agent ADK personnalisé {#group-4--custom-adk-agent}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_adk_agent` | `true` | Déploie l'agent BigQuery sur Agent Runtime et accorde à son agent de service les rôles Utilisateur Vertex AI, Utilisateur BigQuery et Éditeur de données BigQuery. |
| `agent_display_name` | `BigQuery Pool Data Agent` | Nom d'affichage d'Agent Runtime ; l'ID de déploiement est ajouté. |
| `agent_model` | `gemini-3.5-flash` | Modèle utilisé par l'agent. Le modifier redéploie l'agent en tant que nouveau moteur. |
| `agent_model_location` | `global` | Emplacement Vertex AI pour les appels de modèle. |
| `agent_auth_id` | _(vide)_ | ID d'autorisation Gemini Enterprise ; lorsqu'il est défini, les requêtes s'exécutent en tant qu'utilisateur connecté. |

### Groupe 5 — Model Armor {#group-5--model-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_model_armor_template` | `true` | Crée le modèle Model Armor de démonstration. |
| `model_armor_location` | _(vide → `ge_location`, avec `global` → `us`)_ | Emplacement du modèle. Model Armor n'a pas de modèles `global`. |
| `model_armor_confidence` | `MEDIUM_AND_ABOVE` | Seuil de blocage pour les filtres RAI et d'injection de prompt (`LOW_AND_ABOVE`, `MEDIUM_AND_ABOVE`, `HIGH`). |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Le suffixe de déploiement utilisé dans les noms de ressources. |
| `project_id` | ID du projet GCP. |
| `demo_bucket` | Nom du bucket de contenu. |
| `drive_documents_console_url` | Page de la console listant les deux documents à télécharger sur Google Drive. |
| `agent_source_copy_cmd` | Commande `gcloud storage cp -r` pour récupérer `adk_to_ge/` dans Cloud Shell. |
| `announcement_image_url` | URL de l'image pour l'annonce "Annual pool party". |
| `ph_table_image_url` | URL authentifiée de l'image de la table de pH pour la démonstration image-vers-table. |
| `gemini_enterprise_location` | L'emplacement à utiliser pour les connecteurs et l'enregistrement de l'agent. |
| `gemini_enterprise_app_id` | ID du moteur de l'application (`not created` si désactivé). |
| `gemini_enterprise_console_url` | Page de la console Gemini Enterprise pour le projet. |
| `cymbal_docs_data_store` | Nom de ressource du magasin de données Documents Cymbal Pools. |
| `bigquery_table` | Table `installation_requests` entièrement qualifiée. |
| `reasoning_engine` | Nom de ressource Agent Runtime à coller dans **Agents → Ajouter un agent**. |
| `model_armor_template` | Nom de ressource du modèle à coller dans **Configurations → Assistant → Activer Model Armor**. |
| `oauth_redirect_uris` | Les deux URI de redirection à ajouter au client Web OAuth utilisé par les connecteurs et l'autorisation de l'agent. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `deployment_id` | défini une fois | Critique | Intégré dans chaque nom de ressource. Le modifier recrée l'application (perdant les connecteurs attachés à la main et les enregistrements d'agent), le bucket, le magasin de données et l'agent. |
| `create_gemini_enterprise_app` | `true` | Élevé | Si la création de l'application échoue avec une erreur de licence, Gemini Enterprise n'est pas activé dans le projet : démarrez l'essai gratuit dans la console et redéployez, ou définissez `false` et créez l'application à la main. (Non nécessaire sur le projet Qwiklabs sur lequel cela a été testé.) |
| `agent_model` | un modèle autorisé par `constraints/vertexai.allowedModels` | Élevé | Les projets de lab peuvent restreindre ou refuser tous les modèles Vertex AI. L'agent se déploie toujours, mais chaque requête échoue avec `FAILED_PRECONDITION ... disallowed Gen AI model`. Vérifiez la politique effective avant le cours. |
| `ge_location` | `global` (ou `us` sur les sandboxes à quota limité) | Élevé | Les connecteurs et l'enregistrement de l'agent doivent se trouver au même emplacement que l'application, et une incompatibilité est rejetée. Certains projets sandbox ont un quota d'agents personnalisés de 0 à `global` ; utilisez `us` là-bas. Le modifier recrée l'application. |
| `configure_google_identity` | `true` | Élevé | Sans IdP pour l'emplacement, l'assistant de connecteur Drive/Agenda échoue avec "IdP must be selected before creating an ACLed Data Connector". |
| `region` | une région autorisée par la politique de l'organisation | Élevé | `constraints/gcp.resourceLocations` peut rejeter Agent Runtime dans la région par défaut avec un 412 ; choisissez une région autorisée. |
| `public_announcement_image` | `true`, ou `false` sous prévention d'accès public | Moyen | Avec `constraints/storage.publicAccessPrevention` appliqué, l'ACL publique échoue avec un 412. Définissez `false` et utilisez une image hébergée ailleurs pour l'annonce. |
| `agent_model` / `agent_auth_id` | défini avant d'enregistrer l'agent | Moyen | Chaque modification redéploie l'agent en tant que **nouveau** moteur, de sorte que l'enregistrement Gemini Enterprise pointant vers l'ancien `reasoning_engine` doit être recréé. |
| `agent_model_location` | défini avant le premier déploiement | Faible | Il est transmis à l'agent au moment du déploiement mais n'est pas l'un des déclencheurs du déploiement, donc le modifier sur un déploiement existant ne fait rien tant que quelque chose qui *est* un déclencheur (`agent_model`, `agent_auth_id`, `agent_display_name`, `region` ou la source de l'agent) ne redéploie pas l'agent. |
| `agent_auth_id` | vide sauf si démonstration d'accès par utilisateur | Moyen | Lorsqu'il est défini, les requêtes s'exécutent en tant qu'utilisateur connecté, qui a alors besoin d'un accès BigQuery sur l'ensemble de données ; un ID d'autorisation non enregistré ou incompatible ne donne aucune identifiant à l'agent. |
| `enable_services` | `true` | Élevé | Si les API requises ne sont pas déjà activées et que cela est `false`, la création de la ressource échoue immédiatement. |
| `model_armor_confidence` | `MEDIUM_AND_ABOVE` | Faible | `HIGH` peut laisser passer certains des prompts de test plus doux du lab ; `LOW_AND_ABOVE` peut bloquer les prompts de démonstration ordinaires. |

---

Pour la présentation complète de l'instructeur (liste de contrôle avant le cours, étapes d'enregistrement des connecteurs et des agents, et les prompts de démonstration en classe), consultez le **[Guide de Lab](https://docs.radmodules.dev/docs/labs/Gemini_Enterprise)**.
