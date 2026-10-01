---
title: "Préparation PCA, section 5 : gérer la mise en œuvre"
description: "Préparez la section 5 de l'examen Professional Cloud Architect (PCA) — gestion de la mise en œuvre — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PCA_Section_5_Exploration_Guide.md @ cb682e8 sha256:f04ecd349cdb -->

# Guide de préparation à la certification PCA : Section 5 — Gestion de la mise en œuvre (Managing implementation) (~12,5 % de l'examen) {#pca-certification-preparation-guide-section-5--managing-implementation-125-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pca_section5.png" alt="Guide de préparation à la certification PCA : Section 5 — Gestion de la mise en œuvre (~12.5 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide d'examen officiel :** [Professional Cloud Architect certification](https://cloud.google.com/learn/certification/cloud-architect) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Gérer la mise en œuvre, c'est permettre aux autres équipes de réussir : fournir des chemins balisés, des garde-fous et des modèles d'accès programmatique. La plateforme RAD en est elle-même la démonstration — une architecture Terraform/OpenTofu à quatre niveaux que les équipes de développement consomment via un portail, avec des validations qui font échouer les mauvaises configurations au moment du plan et une hygiène du registre intégrée. Déployez n'importe quel profil de la [Carte des labs](PCA_Certification_Guide.md) ; le profil **Sécurité et livraison** rend visibles le plus grand nombre d'artefacts. Modules sollicités : les quatre, avec un accent sur les scripts partagés et les validations au moment du plan de la plateforme.

---

## 5.1 Conseiller les équipes de développement et d'exploitation (Advising development and operation teams) {#51-advising-development-and-operation-teams}

> ⏱ ~60 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : n'importe quel profil déployé

**Pourquoi l'examen s'y intéresse** — Les architectes sont des conseillers : ils codifient les normes pour que les équipes ne puissent pas facilement mal faire, choisissent les approches de gestion des API et de test, et définissent les règles relatives aux artefacts et aux dépendances. Les scénarios d'examen demandent quelle recommandation ou quel garde-fou empêche une défaillance décrite.

**Comment RAD le met en œuvre** — Trois modèles de conseil sont observables dans le code :

*Chemin balisé avec garde-fous.* Les modules de fondation exposent une surface de variables sélectionnée et rejettent les mauvaises configurations au moment du plan — App_GKE comporte 32 préconditions (instances min ≤ max, complétude d'IAP, exigences des PVC, prérequis CDN/Armor, longueur des noms ≤ 55 caractères, `gateway_backend_stage` doit exister). Les équipes disposent d'une grande expressivité ; l'équipe plateforme obtient des invariants imposés. C'est « conseiller par l'outillage », et c'est ainsi que l'examen attend que les normes passent à l'échelle au-delà de la documentation.

*Règles relatives aux artefacts.* Artifact Registry est découvert automatiquement ou créé (`shared-repo-{prefix}`), avec des règles de nettoyage — `max_images_to_retain` (par défaut `7`), `delete_untagged_images` (par défaut `true`), `image_retention_days` (par défaut `30`) — ainsi que CMEK (`enable_artifact_registry_cmek`) et l'analyse des vulnérabilités en option. Les dépendances tierces ne sont pas récupérées depuis Internet à l'exécution : les images requises (par exemple le Cloud SQL Auth Proxy) sont copiées dans AR avec Crane, avec **comparaison des condensés** — un tag existant est écrasé lorsque son condensé ne correspond plus à la source, de sorte qu'un miroir obsolète ou altéré n'est jamais utilisé à votre insu.

*Valeurs opérationnelles par défaut.* L'outillage client de base de données est livré sous forme d'image dédiée, les jobs d'initialisation sont des éléments à part entière (`initialization_jobs` avec un ordonnancement `depends_on_jobs`), et l'élagage des révisions/images maintient les environnements propres sans effort de la part des équipes.

**À vous de jouer**

1. Examinez cinq des préconditions vérifiées au moment du plan d'App_GKE ; pour chacune, décrivez l'incident de production qu'elle empêche.
2. Enfreignez-en volontairement une dans le portail (par exemple `min_instance_count = 5`, `max_instance_count = 2`) et observez l'erreur au moment du plan — le message nomme les variables et la correction.
3. Examinez les règles d'artefacts en vigueur :

```bash
gcloud artifacts repositories describe <repo-name> \
  --location=<region> \
  --format="yaml(cleanupPolicies,vulnerabilityScanningConfig)"
```

4. Vous savez que cela a fonctionné lorsque la mauvaise configuration n'a jamais atteint l'étape d'application et que le dépôt affiche des règles de nettoyage qu'aucun développeur n'a eu à écrire.

**Testez-vous**
<details>
<summary>Q1 : Des équipes de développement continuent de déployer des conteneurs qui récupèrent un sidecar tiers depuis Docker Hub à l'exécution, ce qui provoque des pannes lorsque le registre limite le débit. Que conseillez-vous, et quelle subtilité rend un miroir naïf dangereux ?</summary>

R : Copiez les images tierces requises dans votre propre Artifact Registry et ne déployez qu'à partir de celui-ci — comme le fait cette plateforme pour le Cloud SQL Auth Proxy. La subtilité : un tag peut dériver silencieusement en amont ; le miroir doit donc comparer les condensés (comme le fait cette plateforme avec Crane) plutôt que de supposer que « le tag existe = à jour » ; sinon, vous restez figé sur une image obsolète ou erronée indéfiniment.
</details>

<details>
<summary>Q2 : Les normes écrites d'une équipe plateforme sont ignorées. Quelle alternative évolutive ce dépôt démontre-t-il ?</summary>

R : Encoder les normes sous forme de validations au moment du plan et de variables de modules sélectionnées — la norme devient impossible à enfreindre au lieu d'être simplement documentée. Les mauvaises configurations échouent avec des messages d'erreur exploitables avant la création de toute ressource, ce qui coûte moins cher qu'un échec en production et va plus vite qu'une application fondée sur la revue.
</details>

**Au-delà des modules** — Étudiez ce que couvre le conseil au-delà des garde-fous IaC : le choix de la gestion des API (Apigee pour la monétisation, l'analytique et la médiation avec l'existant, ou API Gateway pour une façade serverless légère), les frameworks de test (unitaires/d'intégration/de charge, et où chacun s'exécute dans la CI), Database Migration Service pour conseiller sur les déplacements de données, et **Gemini Cloud Assist** en tant qu'assistant d'IA que les équipes peuvent utiliser pour concevoir, déployer, dépanner et optimiser les charges de travail (il apparaît aux points 1.2 et 5.1 du guide actuel). Essayez de créer une API Gateway dans un projet de test pour mesurer la différence avec le périmètre d'Apigee.

**⚠️ Piège d'examen** — « Stocker les images dans Container Registry » est une réponse dépassée : Container Registry est obsolète au profit d'Artifact Registry, qui ajoute l'IAM par dépôt, les règles de nettoyage, CMEK et l'analyse — les fonctionnalités dont dépend cette plateforme.

---

## 5.2 Interagir avec Google Cloud de manière programmatique (Interacting with Google Cloud programmatically) {#52-interacting-with-google-cloud-programmatically}

> ⏱ ~60 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : n'importe quel profil déployé + Cloud Shell ou un poste de travail avec `gcloud`

**Pourquoi l'examen s'y intéresse** — L'examen évalue votre aisance sur l'ensemble de la surface programmatique : IaC déclarative ou CLI impérative, quand chacune est appropriée, et comment fonctionne l'authentification sans fichier de clé. Attendez-vous à des questions du type « quelle commande/quelle approche ».

**Comment RAD le met en œuvre** — Le portail compile vos choix de variables et exécute pour vous le cycle de vie OpenTofu (`tofu init → plan → apply`) — chaque déploiement que vous avez réalisé dans ces guides était une interaction programmatique. Les modules montrent aussi la *limite* de l'IaC déclarative : là où le fournisseur présente des lacunes, ils font délibérément appel à `gcloud` — par exemple, les modules complémentaires GKE sont activés via `gcloud container clusters update --enable-secret-manager`, les jobs Cloud Run sont exécutés avec `gcloud run jobs execute --wait`, et la découverte exécute `gcloud compute networks subnets list --filter=...` dans des scripts de données externes. L'emprunt d'identité de compte de service (`--impersonate-service-account`, et la variable `impersonation_service_account`) est utilisé partout à la place des fichiers de clé.

**À vous de jouer**

1. Lancez un déploiement depuis le portail — en coulisses, il exécute la moitié en lecture seule du cycle de vie (init → validate → plan) avant toute application, rejetant les configurations invalides au moment du plan.
2. Comparez l'état déclaré à l'état réel de manière impérative :

```bash
gcloud run services list --region=us-central1
gcloud sql instances list
gcloud container clusters list
```

3. Notez où la plateforme sort délibérément de l'IaC déclarative : la découverte est alimentée par des appels `gcloud ... --format=json` (par exemple la découverte des sous-réseaux), et les modules complémentaires sont activés avec des commandes `gcloud` impératives là où le fournisseur présente des lacunes.
4. Vous savez que cela a fonctionné lorsque le plan n'affiche aucune différence inattendue (la vérité déclarative) et que les listes `gcloud` y correspondent (l'observation impérative).

**Testez-vous**
<details>
<summary>Q1 : Un opérateur a « rapidement corrigé » la limite de mémoire d'un service avec `gcloud run services update`. Que se passe-t-il lors du prochain déploiement de la plateforme, et comment l'examen appelle-t-il cela ?</summary>

R : Une dérive de configuration — le prochain `tofu apply` annule la modification manuelle au profit de la valeur déclarée (ou la fait apparaître comme une différence au moment du plan). L'examen attend que la dérive soit résolue en modifiant la déclaration (la variable du portail), jamais par des correctifs impératifs répétés ; l'IaC est la source de vérité.
</details>

<details>
<summary>Q2 : Un système de CI doit appeler les API GCP en tant que compte de service privilégié sans stocker de clé JSON. Quels modèles cette plateforme utilise-t-elle ?</summary>

R : L'emprunt d'identité de compte de service — les appelants disposant des droits `roles/iam.serviceAccountUser`/créateur de jetons agissent en tant que compte de service cible via `--impersonate-service-account`, et reçoivent des jetons de courte durée (les modules transmettent `impersonation_service_account` à l'authentification du fournisseur et aux appels gcloud). Sur GKE, Workload Identity lie les comptes de service Kubernetes aux comptes de service GCP de la même manière, sans clé. Les clés JSON de longue durée sont la mauvaise réponse.
</details>

**Au-delà des modules** — La surface programmatique de l'examen est plus large : Cloud Shell Editor, Cloud Shell Terminal et Cloud Code, `gsutil` et son remplaçant moderne `gcloud storage`, `bq` pour BigQuery, les bibliothèques clientes (Python/Java/Node) avec l'ordre de résolution des Application Default Credentials, les émulateurs locaux (Pub/Sub, Firestore, Spanner, Bigtable) et le comportement des quotas/nouvelles tentatives des API (intervalle exponentiel entre les tentatives sur `429`/`5xx`). L'examen de renouvellement mentionne aussi **Gemini Code Assist**, l'assistant de codage par IA de Cloud Shell Editor, de Cloud Code et des IDE. Entraînez-vous dans Cloud Shell : `gcloud config list`, `gcloud auth application-default login`, et un démarrage rapide d'une bibliothèque cliente de bout en bout.

**⚠️ Piège d'examen** — `gcloud auth login` (votre utilisateur) et les Application Default Credentials (`gcloud auth application-default login`, ce que voient les bibliothèques clientes) sont des magasins d'identifiants distincts. Un script qui fonctionne dans votre terminal mais échoue avec « could not find default credentials » dans le code en est le symptôme classique — et un distracteur récurrent à l'examen.
