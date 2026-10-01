---
title: "Environnement de démonstration Gemini Enterprise"
description: "Référence de configuration du module RAD Gemini Enterprise sur Google Cloud — l'application de démonstration Cymbal Pools, le data store, l'agent BigQuery sur Agent Runtime, Model Armor, les variables et les outputs."
---

<!-- translated-from: docs/modules/Gemini_Enterprise.md @ 3055034 sha256:33ba991f042b -->

# Environnement de démonstration Gemini Enterprise {#gemini-enterprise-demo-environment}

Ce module prépare un projet Google Cloud pour une **démonstration de Gemini Enterprise animée par un formateur**, construite autour de l'entreprise fictive **Cymbal Pools**. Il s'agit d'un **module autonome** : il crée son propre bucket, son propre dataset, son propre agent et sa propre application, et ne dépend d'aucune infrastructure socle partagée.

Lors de l'apply, le module crée l'application Gemini Enterprise avec Google Identity configuré, un data store interrogeable de documents Cymbal Pools, un bucket de contenu (documents Drive, image d'annonce, image du tableau de pH, données d'amorçage BigQuery, source de l'agent ADK), une table BigQuery `installation_requests`, un agent BigQuery ADK personnalisé sur Vertex AI Agent Runtime avec l'IAM dont il a besoin, et un modèle Model Armor. Le formateur effectue ensuite les quelques étapes qui nécessitent une connexion Google Workspace interactive (connecteurs Drive/Calendar, client OAuth, enregistrement de l'agent) et exécute les démonstrations.

Ce guide présente les services cloud que le module provisionne et la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. La checklist complète d'avant-cours et le script de démonstration en cours figurent dans le [Guide du lab](https://docs.radmodules.dev/docs/labs/Gemini_Enterprise).

Les ressources portent le suffixe de déploiement `<id>` : bucket `<project>-ge-<id>`, application `cymbal-pools-ge-<id>`, data store `cymbal-pools-docs-<id>`, modèle Model Armor `cymbal-pools-ma-<id>`, et moteur Agent Runtime « BigQuery Pool Data Agent (\<id>) ».

---

## 1. Vue d'ensemble {#1-overview}

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Application d'espace de travail agentique | Gemini Enterprise (Discovery Engine) | Application `APP_TYPE_INTRANET`, niveau de recherche Enterprise avec le module complémentaire LLM, nom d'entreprise « Cymbal Pools » |
| Identité | Configuration ACL de Gemini Enterprise | Google Identity (`GSUITE`) sélectionné pour l'emplacement de l'application |
| Documents de l'entreprise | Data store Discovery Engine | Adossé à Cloud Storage, non structuré ; indexe la brochure PDF et l'analyse DOCX |
| Contenu de démonstration | Cloud Storage | Documents Drive, image d'annonce, image du tableau de pH, CSV d'amorçage, source de l'agent `adk_to_ge/` |
| Données d'installation de piscines | BigQuery | `cymbal_pools.installation_requests`, amorcée avec 60 lignes d'exemple |
| Agent personnalisé | Vertex AI Agent Runtime (Agent Engine) + ADK | Agent BigQuery déployé avec `adk deploy agent_engine`, s'exécutant en tant que `resource_creator_identity` |
| Sécurité de l'IA | Model Armor | Modèle avec filtres SDP, RAI, injection de prompt/jailbreak et URI malveillantes |

**À savoir dès le départ :**

- **Gemini Enterprise doit d'abord être activé dans le projet.** Sur un projet qui ne l'a jamais utilisé, ouvrez Gemini Enterprise une fois dans la console et cliquez sur **Start free trial**. Activer `discoveryengine.googleapis.com` n'est pas la même chose, et la création de l'application échoue tant que l'essai n'a pas démarré. Définissez `create_gemini_enterprise_app = false` pour créer l'application manuellement à la place.
- **Plusieurs étapes sont volontairement manuelles.** Les connecteurs Google Drive et Calendar ainsi que l'écran de consentement/le client OAuth nécessitent des flux OAuth interactifs que seule la console fournit. L'enregistrement de l'agent BigQuery nécessite ce client OAuth, et l'attribution du rôle « Agent User » de l'agent à tous les utilisateurs n'a pas d'API. Les annonces, les bascules de Feature Management et le rattachement de Model Armor à l'assistant sont démontrés en direct.
- **Tout partage un même emplacement Gemini Enterprise.** L'application, ses data stores, le fournisseur d'identité, les connecteurs Drive/Calendar et l'enregistrement de l'agent doivent tous se trouver dans `ge_location` (`global` par défaut).
- **Le déploiement de l'agent exécute Python sur le runner Terraform.** `null_resource.deploy_adk_agent` crée un virtualenv sous `$HOME/.local/ge-adk-venv`, installe `google-adk` et exécute `adk deploy agent_engine` via un petit wrapper (`scripts/adk_deploy.py`) qui fait emprunter à l'ADK l'identité de `resource_creator_identity`. Le déploiement prend 5 à 10 minutes.
- **Le contenu de démonstration est original.** Cymbal Pools est fictive ; le PDF, le DOCX, les images et le CSV de `assets/` ont été écrits pour ce module et peuvent être régénérés avec `assets/generate_assets.py`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que ces variables sont définies pour correspondre à votre déploiement. Les noms des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

```bash
export PROJECT="<project_id>"
export REGION="us-central1"      # region (Agent Runtime)
export GE_LOCATION="global"      # ge_location
export ID="<deployment_id>"
export GE_HOST=discoveryengine.googleapis.com   # use ${GE_LOCATION}-discoveryengine.googleapis.com for us/eu
```

### A. Application Gemini Enterprise, identité et data store {#a-gemini-enterprise-app-identity-and-data-store}

L'application (`cymbal-pools-ge-<id>`) est un moteur de type intranet avec le niveau de recherche Enterprise et le module complémentaire LLM. Google Identity est défini comme fournisseur d'identité pour `ge_location`, afin que des connecteurs soumis aux ACL (Drive, Calendar) puissent y être créés. Le data store `cymbal-pools-docs-<id>` est rattaché à l'application à sa création et indexe les documents situés sous `gs://<bucket>/drive/`.

- **Console :** **Gemini Enterprise** → Apps (réglez le filtre d'emplacement sur `ge_location` ou *All locations*) → **Cymbal Pools GE**. Les data stores connectés, Integration, Agents et Configurations se trouvent dans la navigation de gauche de l'application.
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
| `drive/Cymbal Pools Convention Brochure.pdf` | À téléverser dans Google Drive ; démonstration de ciblage de fichier « Summarize @ » |
| `drive/Cymbal Pools Pool Installation Analysis.docx` | À téléverser dans Google Drive ; démonstration de recherche d'entreprise « how do we conduct a pool site inspection? » |
| `pool party.png` | URL de l'image de l'annonce « Annual pool party » (lecture publique lorsque `public_announcement_image = true`) |
| `pH table.png` | À coller dans l'omnibar pour la démonstration « Convert this image to tabular data » |
| `bigquery/installation_requests.csv` | Données d'amorçage chargées dans BigQuery |
| `adk_to_ge/` | Source de l'agent ADK (`bigquery_agent/`, `construct_auth_uri.py`, `requirements.txt`) |

- **Console :** **Cloud Storage** → Buckets → `<project>-ge-<id>` (lien direct dans l'output `drive_documents_console_url`).
- **CLI :**
  ```bash
  gcloud storage ls -r "gs://$PROJECT-ge-$ID/"
  gcloud storage cp "gs://$PROJECT-ge-$ID/drive/*" .           # the two Drive documents
  gcloud storage cp -r "gs://$PROJECT-ge-$ID/adk_to_ge" .      # the agent source
  curl -sI "https://storage.googleapis.com/$PROJECT-ge-$ID/pool%20party.png" | head -1   # expect 200 if public
  ```

### C. BigQuery — demandes d'installation {#c-bigquery--installation-requests}

`cymbal_pools.installation_requests` contient des demandes d'installation de piscines résidentielles : `request_id`, `request_date`, `length_m`, `width_m`, `depth_m`, `has_hot_tub`, `has_waterfall`, `zip_code`, `customer_phone`, `customer_email`. Elle est amorcée par un job de chargement BigQuery dont l'ID intègre le hash du CSV, de sorte que les lignes insérées par l'agent pendant une démonstration survivent aux apply ultérieurs, sauf si le CSV d'amorçage lui-même change.

- **Console :** **BigQuery** → Explorer → `<project>` → `cymbal_pools` → `installation_requests`. Les requêtes exécutées par l'agent apparaissent sous **Job history → Project history**.
- **CLI :**
  ```bash
  bq show --schema --format=prettyjson "$PROJECT:cymbal_pools.installation_requests"
  bq query --use_legacy_sql=false \
    "SELECT COUNT(*) AS requests, ROUND(AVG(length_m*width_m*depth_m),1) AS avg_volume_m3 FROM \`$PROJECT.cymbal_pools.installation_requests\`"
  ```

### D. Vertex AI Agent Runtime — agent BigQuery {#d-vertex-ai-agent-runtime--bigquery-agent}

L'agent ADK (`adk_to_ge/bigquery_agent`) utilise le `BigQueryToolset` de l'ADK avec le mode écriture autorisé et des instructions qui le limitent à `SELECT`/`INSERT` sur `installation_requests`. Par défaut, il interroge en tant qu'**agent de service AI Platform Reasoning Engine** (`service-<number>@gcp-sa-aiplatform-re.iam.gserviceaccount.com`), auquel le module accorde `roles/aiplatform.user`, `roles/bigquery.user` et `roles/bigquery.dataEditor`. Définir `agent_auth_id` lui fait utiliser à la place le jeton OAuth de l'utilisateur Gemini Enterprise (voir [Comportement](#3-behaviour)).

- **Console :** **Vertex AI** → Agent Runtime (sélectionnez `region`) → « BigQuery Pool Data Agent (\<id>) ».
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

Un seul modèle, `cymbal-pools-ma-<id>`, dans `model_armor_location` (par défaut `ge_location`, sauf qu'une application `global` obtient un modèle `us` : Model Armor rejette les modèles dans `global` avec `UNSUPPORTED_REQUEST_LOCATION`, et l'assistant d'une application `global` accepte un modèle `us`, deux comportements confirmés en conditions réelles). Chaque filtre correspond à un groupe de prompts de test du lab : Sensitive Data Protection de base (numéros de carte, identifiants), filtres d'IA responsable (harcèlement, discours haineux, contenu dangereux, contenu sexuellement explicite) au niveau `model_armor_confidence`, détection d'injection de prompt/jailbreak, et détection d'URI malveillantes. L'application des règles est `INSPECT_AND_BLOCK`. Le module ne le rattache **pas** à l'assistant ; le formateur le fait en direct sous **Configurations → Assistant → Enable Model Armor**.

- **Console :** **Security → Model Armor** → `cymbal-pools-ma-<id>`.
- **CLI :**
  ```bash
  gcloud model-armor templates describe "cymbal-pools-ma-$ID" --location="$GE_LOCATION" --project="$PROJECT"
  ```

---

## 3. Comportement {#3-behaviour}

**Ce qui est provisionné lors de l'apply.** Dans l'ordre des dépendances : les API du projet (Discovery Engine, Vertex AI, BigQuery, Cloud Storage, IAM et IAM Credentials, Resource Manager, Service Usage, Model Armor, Cloud Build, Logging, Monitoring, Cloud Trace) ; le bucket de contenu et ses objets ; le dataset BigQuery, la table et le job de chargement d'amorçage ; la configuration ACL Google Identity ; l'agent de service Discovery Engine (avec un accès en lecture au bucket), le data store de documents et un appel `documents:import` ; l'application Gemini Enterprise ; le modèle Model Armor ; et enfin le déploiement de l'agent, suivi des liaisons IAM de l'agent de service Reasoning Engine. Ces liaisons doivent venir après le déploiement, car cet agent de service n'existe qu'une fois le premier moteur du projet créé.

**Import des documents.** Discovery Engine n'a pas de ressource Terraform pour importer des documents ; `null_resource.import_cymbal_docs` appelle donc `documents:import` avec `gs://<bucket>/drive/*` et réessaie pendant environ deux minutes au maximum, le temps que l'autorisation de l'agent de service sur le bucket se propage. L'import est asynchrone : l'apply rend la main dès qu'il a *démarré*, et l'indexation se termine quelques minutes plus tard. L'import est relancé lorsque le contenu de l'un ou l'autre des documents change.

**Déploiement et identité de l'agent.** `adk deploy agent_engine` n'a pas d'option d'emprunt d'identité ; le module l'exécute donc via `scripts/adk_deploy.py`. Ce wrapper remplace `google.auth.default()` par des identifiants empruntés de courte durée pour `resource_creator_identity` avant le chargement de l'ADK, de sorte que le moteur est créé par la même identité que toutes les autres ressources. Lorsque `resource_creator_identity` est vide, il se comporte exactement comme `adk`. Le wrapper écrit le nom de ressource `reasoningEngines` obtenu dans `scripts/reasoning_engine.txt`, et l'output `reasoning_engine` lit ce fichier.

**Emplacement du modèle et région de déploiement.** `adk deploy --region X` force `GOOGLE_CLOUD_LOCATION=X` dans le conteneur déployé, en écrasant toute valeur du `.env` de l'agent. (La ligne `GOOGLE_CLOUD_LOCATION=global` du lab d'origine est donc ignorée.) Le module transmet séparément l'emplacement du modèle sous la forme `MODEL_LOCATION` (`agent_model_location`, `global` par défaut), et l'agent l'applique avant la création du client du modèle.

**Accès BigQuery par utilisateur ou par l'agent de service.** Lorsque `agent_auth_id` est vide (par défaut), l'agent interroge en tant qu'agent de service Reasoning Engine, si bien que la démonstration fonctionne que l'agent ait été enregistré ou non avec une autorisation OAuth. Définissez `agent_auth_id` sur l'Authorization ID de Gemini Enterprise (par ex. `bq-auth`) pour que les requêtes s'exécutent en tant qu'utilisateur connecté ; l'agent lit alors le jeton que Gemini Enterprise stocke dans l'état de session sous cette clé. Le modifier redéploie l'agent.

**Les modifications faites dans la console sont préservées.** L'application ignore les dérives sur `data_store_ids`, `features` et `knowledge_graph_config`. Par conséquent, les connecteurs que le formateur rattache et les bascules de Feature Management (Agent Designer, modèle d'image, partage de session) ne sont pas annulés par un apply ultérieur.

**Suivi manuel effectué par le formateur.** Téléverser les documents Drive, créer les connecteurs Drive/Calendar et le data store Announcements, créer l'écran de consentement OAuth et le client Web, enregistrer l'agent BigQuery (éventuellement avec une Authorization), accorder à All Users le rôle Agent User, confirmer Workforce Identity sur la page Integration de l'application, et activer les options de Feature Management. Toutes ces étapes sont détaillées pas à pas dans le Guide du lab.

**Comportement au nettoyage.** La destruction supprime l'application, le data store, la configuration ACL, le bucket (détruit de force avec son contenu), le dataset BigQuery (avec son contenu), le modèle Model Armor, les liaisons IAM et le moteur Agent Runtime. Le provisioner de destruction du moteur le retrouve par son nom d'affichage plutôt que par le fichier local, car ce fichier ne survit pas d'une exécution de la plateforme à l'autre. La destruction ne supprime **pas** ce qui a été créé manuellement. Supprimer l'application ne supprime pas les data stores qui lui sont rattachés : les data stores Drive, Calendar et Announcements doivent donc être supprimés ensuite depuis **Gemini Enterprise → Data stores**. Il en va de même pour le client et l'écran de consentement OAuth, la ressource Authorization et les fichiers téléversés dans Google Drive. L'enregistrement de l'agent réside dans l'application et disparaît avec elle. Les API restent activées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et emplacement {#group-1--project--location}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet cible. Il doit déjà exister. Pour Qwiklabs, le projet du lab avec le compte étudiant, afin que les connecteurs et l'application partagent une même identité Workspace. |
| `region` | `us-central1` | Région Agent Runtime de l'agent ADK. Elle doit être autorisée par toute règle `constraints/gcp.resourceLocations`. |

### Groupe 2 — Application Gemini Enterprise {#group-2--gemini-enterprise-app}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_gemini_enterprise_app` | `true` | Crée l'application et le data store de documents Cymbal Pools. Nécessite que l'essai gratuit (ou une licence) ait été démarré au préalable. |
| `ge_location` | `global` | `global`, `us` ou `eu`. L'application, les data stores, l'IdP, les connecteurs et l'enregistrement de l'agent doivent tous le partager. |
| `app_display_name` | `Cymbal Pools GE` | Nom d'affichage de l'application. |
| `company_name` | `Cymbal Pools` | Nom de l'entreprise sur l'application (Advanced Options). |
| `configure_google_identity` | `true` | Sélectionne Google Identity comme IdP pour `ge_location`. Obligatoire avant les connecteurs Drive/Calendar. |

### Groupe 3 — Contenu de démonstration {#group-3--demo-content}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `bucket_location` | `US` | Emplacement du bucket de contenu. |
| `public_announcement_image` | `true` | Rend uniquement `pool party.png` lisible publiquement afin que l'annonce s'affiche pour tous les utilisateurs. |
| `bq_dataset_id` | `cymbal_pools` | Dataset BigQuery pour `installation_requests`. |
| `bq_location` | `US` | Emplacement du dataset BigQuery. |

### Groupe 4 — Agent ADK personnalisé {#group-4--custom-adk-agent}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_adk_agent` | `true` | Déploie l'agent BigQuery sur Agent Runtime et accorde à son agent de service Vertex AI User, BigQuery User et BigQuery Data Editor. |
| `agent_display_name` | `BigQuery Pool Data Agent` | Nom d'affichage Agent Runtime ; l'ID de déploiement y est ajouté. |
| `agent_model` | `gemini-3.5-flash` | Modèle utilisé par l'agent. Le modifier redéploie l'agent sous la forme d'un nouveau moteur. |
| `agent_model_location` | `global` | Emplacement Vertex AI pour les appels au modèle. |
| `agent_auth_id` | _(vide)_ | Authorization ID de Gemini Enterprise ; lorsqu'il est défini, les requêtes s'exécutent en tant qu'utilisateur connecté. |

### Groupe 5 — Model Armor {#group-5--model-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_model_armor_template` | `true` | Crée le modèle Model Armor de démonstration. |
| `model_armor_location` | _(vide → `ge_location`, avec `global` → `us`)_ | Emplacement du modèle. Model Armor n'a pas de modèles `global`. |
| `model_armor_confidence` | `MEDIUM_AND_ABOVE` | Seuil de blocage des filtres RAI et d'injection de prompt (`LOW_AND_ABOVE`, `MEDIUM_AND_ABOVE`, `HIGH`). |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Le suffixe de déploiement utilisé dans les noms des ressources. |
| `project_id` | ID du projet GCP. |
| `demo_bucket` | Nom du bucket de contenu. |
| `drive_documents_console_url` | Page de la console listant les deux documents à téléverser dans Google Drive. |
| `agent_source_copy_cmd` | Commande `gcloud storage cp -r` pour récupérer `adk_to_ge/` dans Cloud Shell. |
| `announcement_image_url` | URL de l'image de l'annonce « Annual pool party ». |
| `ph_table_image_url` | URL authentifiée de l'image du tableau de pH pour la démonstration image vers tableau. |
| `gemini_enterprise_location` | L'emplacement à utiliser pour les connecteurs et l'enregistrement de l'agent. |
| `gemini_enterprise_app_id` | ID du moteur de l'application (`not created` lorsqu'elle est désactivée). |
| `gemini_enterprise_console_url` | Page de la console Gemini Enterprise du projet. |
| `cymbal_docs_data_store` | Nom de ressource du data store Cymbal Pools Documents. |
| `bigquery_table` | Table `installation_requests` entièrement qualifiée. |
| `reasoning_engine` | Nom de ressource Agent Runtime à coller dans **Agents → Add agent**. |
| `model_armor_template` | Nom de ressource du modèle à coller dans **Configurations → Assistant → Enable Model Armor**. |
| `oauth_redirect_uris` | Les deux URI de redirection à ajouter au client OAuth Web utilisé par les connecteurs et par l'autorisation de l'agent. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `deployment_id` | défini une seule fois | Critique | Intégré dans chaque nom de ressource. Le modifier recrée l'application (en perdant les connecteurs et enregistrements d'agents rattachés manuellement), le bucket, le data store et l'agent. |
| `create_gemini_enterprise_app` | `true` | Élevé | Si la création de l'application échoue avec une erreur de licence, Gemini Enterprise n'est pas activé dans le projet : démarrez l'essai gratuit dans la console et redéployez, ou définissez `false` et créez l'application manuellement. (Inutile sur le projet Qwiklabs sur lequel ce module a été testé.) |
| `agent_model` | un modèle autorisé par `constraints/vertexai.allowedModels` | Élevé | Les projets de lab peuvent restreindre ou refuser tous les modèles Vertex AI. L'agent se déploie quand même, mais chaque requête échoue avec `FAILED_PRECONDITION ... disallowed Gen AI model`. Vérifiez la règle effective avant le cours. |
| `ge_location` | `global` (ou `us` sur les sandbox à quota limité) | Élevé | Les connecteurs et l'enregistrement de l'agent doivent se trouver au même emplacement que l'application, et une incohérence est rejetée. Certains projets sandbox ont un quota d'agents personnalisés de 0 à `global` ; utilisez `us` dans ce cas. Le modifier recrée l'application. |
| `configure_google_identity` | `true` | Élevé | Sans IdP pour l'emplacement, l'assistant de création des connecteurs Drive/Calendar échoue avec « IdP must be selected before creating an ACLed Data Connector ». |
| `region` | une région autorisée par la règle d'administration | Élevé | `constraints/gcp.resourceLocations` peut rejeter Agent Runtime dans la région par défaut avec une erreur 412 ; choisissez une région autorisée. |
| `public_announcement_image` | `true`, ou `false` en cas de prévention de l'accès public | Moyen | Lorsque `constraints/storage.publicAccessPrevention` est appliquée, l'ACL publique échoue avec une erreur 412. Définissez `false` et utilisez une image hébergée ailleurs pour l'annonce. |
| `agent_model` / `agent_auth_id` | définis avant l'enregistrement de l'agent | Moyen | Toute modification de l'un ou l'autre redéploie l'agent sous la forme d'un **nouveau** moteur ; l'enregistrement Gemini Enterprise qui pointe vers l'ancien `reasoning_engine` doit donc être recréé. |
| `agent_auth_id` | vide, sauf pour démontrer l'accès par utilisateur | Moyen | Lorsqu'il est défini, les requêtes s'exécutent en tant qu'utilisateur connecté, qui a alors besoin d'un accès BigQuery au dataset ; un Authorization ID non enregistré ou incohérent ne fournit aucun identifiant à l'agent. |
| `enable_services` | `true` | Élevé | Si les API requises ne sont pas déjà activées et que ce paramètre vaut `false`, la création des ressources échoue immédiatement. |
| `model_armor_confidence` | `MEDIUM_AND_ABOVE` | Faible | `HIGH` peut laisser passer certains des prompts de test les plus modérés du lab ; `LOW_AND_ABOVE` peut bloquer des prompts de démonstration ordinaires. |

---

Pour la procédure complète du formateur (checklist d'avant-cours, étapes d'enregistrement des connecteurs et de l'agent, et prompts de démonstration en cours), consultez le **[Guide du lab](https://docs.radmodules.dev/docs/labs/Gemini_Enterprise)**.
