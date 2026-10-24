---
title: "Ollama sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Ollama sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ollama_CloudRun.md @ 1665a43e sha256:978c1991b00f -->

# Ollama sur Google Cloud Run {#ollama-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ollama_CloudRun.png" alt="Ollama sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ollama est un serveur d'inférence LLM open source qui sert de grands modèles de langage — Llama,
Mistral, Gemma, Phi et d'autres — via une API REST. Ce module déploie Ollama sur **Cloud
Run v2** (CPU uniquement, sans serveur) sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Ollama utilise et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## Ce que coûte Ollama sur RAD, et comment cela se compare {#what-ollama-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'Ollama sur RAD coûte environ 85 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** Si vous avez besoin qu'Ollama reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](Ollama_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Ollama**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (18 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **85 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **38 crédits par jour**, environ 1 140 par mois (environ 114 $ US au prix de la recharge, 91 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, le réseau et le stockage sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 4x vCPU / 8 GiB (chaud) | 78,85 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 85 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Ollama lui-même**, la comparaison honnête est donc un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Cela nécessite considérablement plus de CPU et de mémoire que les boîtiers de référence ci-dessous, de sorte qu'un équivalent autogéré coûterait nettement plus cher que la classe d'entrée de gamme de 24 à 49 $/mois — probablement une instance dédiée à haute mémoire.
- Il n'existe pas de SaaS géré qui héberge *votre propre* instance Ollama comme le fait ce module — une API d'inférence de modèle hébergée est un produit différent d'un serveur d'inférence privé, ce n'est donc pas une comparaison équivalente et aucun chiffre n'est donné ici. L'alternative réaliste est l'auto-hébergement sur votre propre matériel ou une VM cloud dimensionnée pour les modèles que vous exécutez.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez le système d'exploitation, faites pivoter les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL, Secret Manager et la surveillance gérés par RAD s'en occupent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à un boîtier moins cher — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ollama s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Ollama dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un
projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD commence par dissocier sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. La facturation étant déjà dissociée, rien n'est facturé pendant cette période. Contrairement
  à la suppression d'un module, cela ne détruit pas la ressource de calcul
  une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 85 $ US.** Déployez Ollama, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel Ollama était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart
  des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Ollama et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180
  crédits (18 $ US) dans votre propre projet, ou 162
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois qu'Ollama resterait autrement inutilisé pendant
  environ 6 jours ou plus dans votre propre projet (environ 2,83 $ US par
  jour), ou environ 4 jours ou plus dans un projet géré par RAD (38 crédits par
  jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'Ollama alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul propre à cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  Ollama dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Ollama pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Ollama s'exécute en tant que serveur d'inférence conteneurisé sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (gen2) | Service Ollama, 4 vCPU / 8 GiB par défaut (modèles 3B), autoscaling basé sur les requêtes |
| Stockage de modèles | Cloud Storage + GCS Fuse | Bucket de modèles monté à `/mnt/gcs` ; les poids persistent lors des redémarrages de conteneurs et des nouvelles révisions |
| Secrets | Secret Manager | Pas de secrets gérés par l'application — Ollama ne nécessite aucune information d'identification |
| Ingress | URL Cloud Run (interne au VPC) | Ingress par défaut `internal` ; seuls les services du même VPC peuvent atteindre l'API |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données, pas de Redis.** Ollama est sans état au-delà de son cache de modèles basé sur GCS. Ni
  Cloud SQL ni Redis ne sont provisionnés.
- **GCS Fuse est la couche de persistance.** Les poids des modèles sont stockés dans un bucket GCS dédié
  et montés dans le conteneur à `/mnt/gcs` via GCS Fuse. Les redémarrages de conteneurs chargent les modèles
  depuis GCS plutôt que de les télécharger à nouveau.
- **`ingress_settings = "internal"` par défaut.** Ollama est conçu comme un point de terminaison d'inférence partagé interne au VPC
  appelé par d'autres applications (Flowise, N8N, RAGFlow, Django). La définition de
  `ingress_settings = "all"` expose l'API non authentifiée à l'internet public — toujours
  à associer à IAP dans ce cas.
- **`execution_environment = "gen2"` est requis** pour la prise en charge de GCS Fuse et ne peut pas être
  rétrogradé à gen1.
- **Extraction automatique de modèles.** Lorsque `default_model` est défini et qu'aucun `initialization_jobs` personnalisé
  n'est fourni, un job Cloud Run nommé `model-pull` est créé lors du premier déploiement et stocke
  le modèle dans le bucket GCS.
- **Trois variables d'environnement sont toujours injectées :** `OLLAMA_MODELS`, `OLLAMA_HOST` et
  `OLLAMA_KEEP_ALIVE`. Ne pas écraser `OLLAMA_MODELS` ou `OLLAMA_HOST` dans
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés
dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Ollama {#a-cloud-run--the-ollama-service}

Ollama s'exécute en tant que service Cloud Run v2 (gen2) qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Send a test inference request from within the VPC:
  curl -s "$OLLAMA_API_URL/api/tags" | jq '.models[].name'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud Storage — persistance des poids de modèle {#b-cloud-storage--model-weight-persistence}

Les poids des modèles Ollama sont stockés dans un bucket GCS dédié (nommé
`<resource_prefix>-models`) et montés dans le conteneur via **GCS Fuse** à `/mnt/gcs`.
La variable d'environnement `OLLAMA_MODELS` est définie sur `/mnt/gcs/ollama/models` afin qu'Ollama
découvre et mette en cache les modèles à cet endroit.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket de modèles pour parcourir les fichiers de modèles téléchargés.
- **CLI :**
  ```bash
  # Bucket name is in the Outputs (models_bucket)
  gcloud storage ls gs://<models-bucket>/ollama/models/
  gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
  ```

Le nom du bucket est signalé comme la sortie `models_bucket`. Voir
[App_CloudRun](App_CloudRun.md) pour GCS Fuse, les options CMEK et les politiques de cycle de vie.

### C. Secret Manager {#c-secret-manager}

Ollama ne nécessite aucune information d'identification gérée par l'application — il n'y a pas de mot de passe administrateur ni de
mot de passe de base de données. Secret Manager est disponible pour tous les secrets personnalisés que vous injectez via
`secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par défaut uniquement depuis le même VPC (`ingress_settings =
"internal"`). Tout service Cloud Run, pod GKE ou VM Compute Engine dans le VPC peut appeler l'API Ollama à l'URL du service sur le port 11434. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés pour un accès externe.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec
des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ollama {#3-ollama-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Ollama n'a pas de base de données. Il n'y a pas de job `db-init` et
  pas d'instance Cloud SQL.
- **Extraction de modèle au premier déploiement.** Lorsque `default_model` est défini et que `initialization_jobs` est
  vide, un job Cloud Run nommé `model-pull` s'exécute une fois. Il démarre un serveur Ollama local en
  arrière-plan, extrait le modèle nommé, le stocke dans le bucket GCS, puis s'arrête. Le job
  monte le volume GCS `ollama-models` afin que les poids persistent. Le délai d'attente est contrôlé par
  `model_pull_timeout_seconds` (par défaut 3600 secondes) ; les grands modèles (7B+) peuvent prendre 20 à 30
  minutes lors de la première extraction.

  Inspectez le job et ses exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <model-pull-job-name> \
    --project "$PROJECT" --region "$REGION"
  ```

- **Chargement de modèle à froid.** Au démarrage de chaque instance, Ollama charge les poids du modèle depuis GCS
  Fuse. Cela prend généralement 30 à 120 secondes selon la taille du modèle. La sonde de démarrage utilise un
  délai initial de 30 s avec 20 tentatives d'échec (environ 5 minutes) pour s'adapter à cela.
  `OLLAMA_KEEP_ALIVE` est défini sur `"24h"` afin que les modèles chargés restent résidents entre les requêtes.
  Écraser via `environment_variables`.
- **Variables injectées automatiquement.** `OLLAMA_MODELS` (`/mnt/gcs/ollama/models`),
  `OLLAMA_HOST` (`0.0.0.0:11434`) et `OLLAMA_KEEP_ALIVE` (`24h`) sont injectées
  automatiquement. Ne pas écraser les deux premières ; la troisième peut être écrasée.
- **Point de terminaison de santé.** Le chemin racine d'Ollama (`/`) répond avec `"Ollama is running"` une fois
  que le serveur est prêt. Les sondes de démarrage et de vivacité ciblent ce chemin.
- **Réglage supplémentaire.** Utilisez `environment_variables` pour définir `OLLAMA_NUM_PARALLEL` (par défaut
  `1`, augmenter pour les appelants concurrents), `OLLAMA_ORIGINS` (restreindre CORS) et d'autres
  variables d'environnement Ollama.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Ollama sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ollama` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Ollama LLM Server` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image Ollama ; épingler à une version spécifique (par exemple, `0.3.12`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner le stockage et IAM sans déployer le service. |
| `cpu_limit` | `4000m` | CPU par instance. Modèles 3B : `"4000m"` ; modèles 7B : `"8000m"`. Le maximum de Cloud Run est `"8"`. |
| `memory_limit` | `8Gi` | Mémoire par instance. Modèles 3B : `"8Gi"` ; modèles 7B : `"16Gi"`. |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour éviter une latence de chargement de modèle à froid de 60 à 120 s. |
| `max_instance_count` | `1` | Instances maximales. L'inférence LLM sature le CPU ; plusieurs instances augmentent les coûts. |
| `execution_environment` | `gen2` | **Doit rester `"gen2"`** — requis pour les montages de volume GCS Fuse. |
| `timeout_seconds` | `3600` | Durée maximale de la requête. L'inférence de grands modèles peut être lente ; 3600 s est le maximum de Cloud Run. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `traffic_split` | `[]` | Allocation de trafic entre les révisions pour les déploiements canary. Toutes les entrées doivent totaliser 100. |
| `enable_image_mirroring` | `true` | Mettre en miroir `ollama/ollama` vers Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | **Gardez `"internal"`** pour un accès uniquement VPC. `"all"` expose l'API Ollama non authentifiée à l'internet public. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routage du trafic sortant via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Requis lorsque `ingress_settings = "all"`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `enable_cloud_armor` | `false` | Attacher un WAF Cloud Armor précédé d'un équilibreur de charge HTTPS global. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur l'équilibreur de charge HTTPS. |
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `OLLAMA_MODELS`, `OLLAMA_HOST` et `OLLAMA_KEEP_ALIVE` sont injectés automatiquement. Utilisez `OLLAMA_NUM_PARALLEL`, `OLLAMA_ORIGINS`, etc. ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

Non applicable pour Ollama — les poids des modèles sont stockés de manière durable dans GCS. Ces variables sont
présentes uniquement pour la compatibilité d'interface. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et initialisation personnalisée {#group-9--nfs-instance--custom-initialization}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide et définissez `default_model` pour utiliser le job d'extraction de modèle auto-généré. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS dans `storage_buckets`. Le bucket de modèles est toujours créé quoi qu'il arrive. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de modèles. |
| `enable_nfs` | `false` | Non requis pour Ollama (utilise GCS Fuse). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires. Le bucket `ollama-models` à `/mnt/gcs` est toujours ajouté automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable pour Ollama. `database_type` est fixé à `"NONE"` — aucune instance Cloud SQL n'est
provisionnée. Ces variables sont présentes uniquement pour la compatibilité d'interface.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type="HTTP", path="/", initial_delay_seconds=30, failure_threshold=20 }` | Le seuil de 20 tentatives permet environ 5 minutes pour le chargement du modèle depuis GCS. |
| `liveness_probe` | `{ type="HTTP", path="/", initial_delay_seconds=60, failure_threshold=3 }` | Un délai de 60 s évite les faux redémarrages pendant le chargement du modèle. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |
| `max_revisions_to_retain` | `7` | **Non référencé** — déclaré uniquement pour la compatibilité d'interface ; n'a aucun effet sur le déploiement de ce module. |

### Groupe 19 — Configuration du modèle Ollama {#group-19--ollama-model-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `default_model` | `""` | Modèle à extraire lors du premier déploiement (par exemple, `"llama3.2:3b"`, `"mistral"`, `"llama3:8b"`). Laissez vide pour ignorer le job d'extraction automatique. |
| `model_pull_timeout_seconds` | `3600` | Délai d'attente pour le job Cloud Run d'extraction de modèle. Les grands modèles (7B+) peuvent prendre 20 à 30 minutes. Plage valide : 300 à 7200. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `ollama_api_url` | URL de base de l'API REST Ollama — ajoutez `/api/generate`, `/api/chat`, etc. Construite comme `<api_url>/api`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `models_bucket` | Nom du bucket GCS où les poids du modèle Ollama sont persistés. |
| `storage_buckets` | Tous les buckets Cloud Storage provisionnés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (y compris `model-pull` lorsqu'il est déclenché). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ingress_settings` | `internal` | Critique | `"all"` expose publiquement l'API Ollama non authentifiée — tout appelant Internet peut interroger ou charger des modèles. |
| `enable_iap` | `true` si `ingress_settings = "all"` | Critique | Sans IAP, l'API n'est pas authentifiée et est accessible publiquement. Ollama n'a pas d'authentification intégrée. |
| `memory_limit` | `8Gi` (3B) / `16Gi` (7B) | Critique | Une mémoire insuffisante provoque un OOM-kill en cours d'inférence ; le conteneur redémarre en boucle. Allouez au moins 2 fois la taille des poids quantifiés du modèle. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Gen1 ne prend pas en charge les montages GCS Fuse. La rétrogradation empêche silencieusement la persistance du modèle. |
| `cpu_limit` | `4000m` (3B) / `8000m` (7B) | Élevé | Trop peu de CPU rend la génération de jetons extrêmement lente (minutes par jeton sur les modèles 7B). |
| `min_instance_count` | `1` | Élevé | `0` permet la mise à l'échelle à zéro mais provoque des démarrages à froid de 60 à 120 s pendant que le modèle se recharge depuis GCS. |
| `model_pull_timeout_seconds` | `3600` | Élevé | Un délai d'attente court entraîne l'échec du job d'extraction de modèle avant la fin du téléchargement pour les modèles de plus de 2 Go. |
| `startup_probe.failure_threshold` | `20` (par défaut) | Élevé | Un seuil trop bas entraîne l'arrêt et le redémarrage du conteneur par Cloud Run avant qu'Ollama ne soit prêt après le montage GCS Fuse. |
| `timeout_seconds` | `3600` | Élevé | L'inférence LLM pour les grandes invites peut dépasser 5 minutes. Les requêtes de générations de longue durée sont terminées avec un 504 si le délai est trop court. |
| `max_instance_count` | `1`–`3` | Élevé | Chaque instance charge le modèle indépendamment. Plusieurs instances sont sûres mais augmentent considérablement les coûts et le trafic de lecture GCS. |
| `default_model` | défini sur le modèle souhaité | Moyen | Laisser vide est sûr pour le déploiement initial, mais l'API renvoie une erreur sur toutes les requêtes d'inférence jusqu'à ce qu'un modèle soit extrait manuellement. |
| `environment_variables.OLLAMA_NUM_PARALLEL` | `2`–`4` pour une utilisation partagée | Moyen | Le `1` par défaut sérialise toutes les requêtes. Augmenter pour les points de terminaison VPC partagés avec des appelants concurrents. |
| `environment_variables.OLLAMA_KEEP_ALIVE` | `24h` (injecté automatiquement) | Moyen | La valeur par défaut d'Ollama (`5m`) évince les modèles de la mémoire, ce qui entraîne des délais de rechargement de 30 à 60 s. Le module injecte `24h` automatiquement. |
| `environment_variables.OLLAMA_ORIGINS` | restreindre pour l'utilisation du navigateur | Moyen | La politique CORS par défaut d'Ollama accepte toute origine. Restreindre aux origines d'interface utilisateur spécifiques lorsqu'elle est exposée via un équilibreur de charge. |
| `gcs_volumes` options de montage | inclure `implicit-dirs` | Moyen | Sans `implicit-dirs`, les listes de répertoires GCS Fuse échouent et Ollama ne peut pas découvrir les modèles mis en cache. |
| `enable_image_mirroring` | `true` | Moyen | Désactivation des extractions depuis Docker Hub, qui est soumise à des limites de débit. Conserver `true` en production. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application partagée spécifique à Ollama
est décrite dans **[Ollama_Common](Ollama_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Ollama sur Cloud Run](../labs/Ollama_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Ollama sur GKE Autopilot](Ollama_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Ollama Common — Configuration d'application partagée](Ollama_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md), [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Assistant IA privé**.
