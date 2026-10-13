---
title: "Ollama sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Ollama sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ollama_GKE.md @ e69407af sha256:92759126ad5a -->

# Ollama sur GKE Autopilot {#ollama-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ollama_GKE.png" alt="Ollama sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ollama est un serveur d'inférence LLM open source qui sert de grands modèles linguistiques — Llama,
Mistral, Gemma, Phi et autres — via une API REST. Ce module déploie Ollama sur **GKE
Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Ollama utilise et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Ollama sur RAD, et comment cela se compare {#what-ollama-costs-on-rad-and-how-that-compares}

**Le module Ollama sur GKE Autopilot de RAD coûte environ 323 à 396 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à Ollama qui doit rester actif, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Ollama_CloudRun.md) exécute le même Ollama pour environ 85 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Ollama**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **323 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **180 crédits par jour**, environ 5 400 par mois (environ 540 $ US au prix de la recharge, 432 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 8x vCPU / 16 GiB | 317,38 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 323 $ US** (environ 396 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Ollama lui-même**, donc la comparaison honnête est un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Cela nécessite considérablement plus de CPU et de mémoire que les boîtiers de référence ci-dessous, de sorte qu'un équivalent autogéré coûterait nettement plus cher que la classe d'entrée de gamme de 24 à 49 $/mois — probablement une instance dédiée à haute mémoire.
- Il n'existe pas de SaaS géré qui héberge *votre propre* instance Ollama comme le fait ce module — une API d'inférence de modèle hébergée est un produit différent d'un serveur d'inférence privé, ce n'est donc pas une comparaison équivalente et aucun chiffre n'est donné ici. L'alternative réaliste est l'auto-hébergement sur votre propre matériel ou une VM cloud dimensionnée pour les modèles que vous exécutez.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez l'OS, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL géré par RAD, Secret Manager et la surveillance s'en chargent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à un boîtier moins cher — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ollama s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Ollama dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à
  la suppression d'un module, cela ne détruit pas le cluster ou la ressource de calcul
  un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande de
  exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 323 $ US.** Déployez Ollama, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds et le temps
  pendant lequel Ollama était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et pour lequel RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart
  des services sont à nouveau entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Ollama et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305
  crédits (30,50 $ US) dans votre propre projet, ou 275
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois qu'Ollama resterait autrement inutilisé pendant
  environ 3 jours ou plus dans votre propre projet (environ 10,78 $ US par
  jour), ou environ 2 jours ou plus dans un projet géré par RAD (180 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'Ollama alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul propre à cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit
  Ollama dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Ollama pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Ollama s'exécute comme un serveur d'inférence conteneurisé. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Ollama, 8 vCPU / 16 GiB par défaut (modèles 7B), autoscalés horizontalement |
| Stockage de modèles | Cloud Storage + GCS Fuse CSI | Bucket de modèles monté à `/mnt/gcs` ; les poids persistent après les redémarrages de pods |
| Secrets | Secret Manager | Pas de secrets gérés par l'application — Ollama ne nécessite aucune information d'identification |
| Ingress | Kubernetes ClusterIP | Interne uniquement par défaut ; utilisez `LoadBalancer` uniquement lorsque l'accès externe est requis |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Ollama est sans état au-delà de son cache de modèles basé sur GCS. Ni
  Cloud SQL ni Redis ne sont provisionnés.
- **GCS Fuse est la couche de persistance.** Les poids des modèles sont stockés dans un bucket GCS dédié
  et montés dans le pod à `/mnt/gcs`. Les redémarrages de pods chargent les modèles depuis GCS plutôt que
  de les télécharger à nouveau.
- **ClusterIP par défaut.** Ollama est conçu comme un point de terminaison d'inférence partagé dans le cluster. Tout
  pod dans le même cluster l'atteint à
  `http://<service-name>.<namespace>.svc.cluster.local:11434`. La définition de `service_type =
  "LoadBalancer"` expose l'API non authentifiée publiquement — ne faites pas cela sans IAP ou
  Cloud Armor.
- **Extraction automatique de modèles.** Lorsque `default_model` est défini et qu'aucun `initialization_jobs` personnalisé
  n'est fourni, un job Kubernetes nommé `model-pull` est créé lors du premier déploiement et stocke
  le modèle dans le bucket GCS.
- **Trois variables d'environnement sont toujours injectées :** `OLLAMA_MODELS`, `OLLAMA_HOST` et
  `OLLAMA_KEEP_ALIVE`. Ne pas écraser `OLLAMA_MODELS` ou `OLLAMA_HOST` dans
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ollama {#a-gke-autopilot--the-ollama-workload}

Les pods Ollama sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent réellement.
L'autoscaling horizontal des pods ajuste le déploiement entre le nombre minimal et maximal
de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Ollama pour voir les pods et
  les événements. Kubernetes Engine → Services et Ingress affiche le ClusterIP (ou l'IP externe lorsque
  `service_type = "LoadBalancer"`).
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Verify Ollama is responding inside the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://localhost:11434/api/tags | jq '.models[].name'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud Storage — persistance des poids de modèle {#b-cloud-storage--model-weight-persistence}

Les poids des modèles Ollama sont stockés dans un bucket GCS dédié (nommé
`<resource_prefix>-models`) et montés dans chaque pod via le **pilote CSI GCS Fuse** à
`/mnt/gcs`. La variable d'environnement `OLLAMA_MODELS` est définie sur
`/mnt/gcs/ollama/models` afin qu'Ollama découvre et mette en cache les modèles à cet endroit.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket de modèles pour parcourir les fichiers de modèles téléchargés.
- **CLI :**
  ```bash
  # Bucket name is in the Outputs (models_bucket)
  gcloud storage ls gs://<models-bucket>/ollama/models/
  gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
  # Confirm the GCS volume is mounted inside a running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/gcs/ollama/models/
  ```

Le nom du bucket est rapporté comme la sortie `models_bucket`. Voir
[App_GKE](App_GKE.md) pour GCS Fuse, les options CMEK et les politiques de cycle de vie des buckets.

### C. Secret Manager {#c-secret-manager}

Ollama ne nécessite aucune information d'identification gérée par l'application — il n'y a pas de mot de passe administrateur ni de
mot de passe de base de données. Secret Manager est disponible pour tout secret personnalisé que vous injectez via
`secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service Ollama est exposé uniquement au sein du cluster (ClusterIP). Lorsque
`service_type = "LoadBalancer"` est défini, une IP Cloud Load Balancing externe est provisionnée.
Un domaine personnalisé, Cloud Armor WAF et IAP peuvent être superposés pour les scénarios d'accès externe.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau → Équilibrage de charge ;
  Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Internal cluster URL (printed as ollama_cluster_url output):
  echo "http://<service-name>.$NAMESPACE.svc.cluster.local:11434"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ollama {#3-ollama-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Ollama n'a pas de base de données. Il n'y a pas de job `db-init` et
  pas d'instance Cloud SQL.
- **Extraction de modèle au premier déploiement.** Lorsque `default_model` est défini et que `initialization_jobs` est
  vide, un job Kubernetes nommé `model-pull` s'exécute une fois. Il démarre un serveur Ollama local en
  arrière-plan, extrait le modèle nommé, le stocke dans le bucket GCS, puis s'arrête. Le
  job monte le volume GCS `ollama-models` afin que les poids persistent. Le délai d'attente est contrôlé
  par `model_pull_timeout_seconds` (par défaut 3600 secondes) ; les grands modèles (7B+) peuvent prendre 20 à 30
  minutes lors de la première extraction.
- **Chargement de modèle au démarrage à froid.** À chaque démarrage de pod, Ollama charge les poids du modèle depuis GCS Fuse.
  Cela prend généralement 30 à 120 secondes selon la taille du modèle. La sonde de démarrage utilise un délai initial de 30 s
  avec 20 tentatives d'échec (environ 5 minutes) pour s'adapter à cela.
  `OLLAMA_KEEP_ALIVE` est défini sur `"24h"` afin que les modèles chargés restent résidents en mémoire entre
  les requêtes. Écraser via `environment_variables`.
- **Variables injectées automatiquement.** `OLLAMA_MODELS` (`/mnt/gcs/ollama/models`),
  `OLLAMA_HOST` (`0.0.0.0:11434`) et `OLLAMA_KEEP_ALIVE` (`24h`) sont injectées
  automatiquement. Ne pas écraser les deux premières ; la troisième peut être écrasée.
- **Point de terminaison de santé.** Le chemin racine d'Ollama (`/`) répond avec `"Ollama is running"` une fois
  que le serveur est prêt. Les sondes de disponibilité et de vivacité ciblent ce chemin.
- **Réglage supplémentaire.** Utilisez `environment_variables` pour définir `OLLAMA_NUM_PARALLEL` (par défaut
  `1`, augmenter pour les appelants concurrents), `OLLAMA_ORIGINS` (restreindre CORS) et d'autres
  variables d'environnement Ollama.
- **Gestion manuelle des modèles.** Extrayez des modèles supplémentaires ou supprimez des modèles existants directement :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama pull mistral
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama list
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama rm mistral
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Ollama sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ollama` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Ollama LLM Server` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag d'image Ollama ; épingler à une version spécifique (par exemple, `0.3.12`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner le stockage et IAM sans déployer la charge de travail. |
| `container_resources` | `{ cpu_limit="8", memory_limit="16Gi", cpu_request="4", mem_request="8Gi" }` | CPU et mémoire du conteneur. Modèles 3B : `cpu_limit="4"`, `memory_limit="8Gi"`. Modèles 7B : `cpu_limit="8"`, `memory_limit="16Gi"`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Maintenez ≥ 1 pour éviter la latence de chargement de modèle au démarrage à froid à chaque requête. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). Chaque pod charge indépendamment le modèle en mémoire — dimensionnez en conséquence. |
| `timeout_seconds` | `300` | Période de grâce de terminaison du pod. Augmentez pour les requêtes d'inférence de longue durée. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend avant de tuer de force le pod après SIGTERM. |
| `service_type` | `ClusterIP` | Type de service Kubernetes. `ClusterIP` maintient l'API interne. `LoadBalancer` l'expose publiquement sans authentification. |
| `session_affinity` | `None` | Affinité de session pour le service Kubernetes. `ClientIP` améliore la continuité du contexte multi-tours mais biaise la distribution de la charge. |
| `enable_image_mirroring` | `true` | Mettez en miroir `ollama/ollama` vers Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |
| `container_image_source` | `prebuilt` | Non transféré — `main.tf` épingle `"prebuilt"`, donc `ollama/ollama:<application_version>` est toujours mis en miroir et jamais construit. |
| `container_image` | `ollama/ollama` | URI complet de l'image lorsque `container_image_source = "prebuilt"`. |
| `enable_cloudsql_volume` | `false` | Non nécessaire pour Ollama (pas de base de données). |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Recommandé lorsque `service_type = "LoadBalancer"`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé. |
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge. |
| `enable_custom_domain` | `true` | Configurer un domaine personnalisé et un certificat géré. |
| `reserve_static_ip` | `true` | Réserver une adresse IP externe stable. |
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `OLLAMA_MODELS`, `OLLAMA_HOST` et `OLLAMA_KEEP_ALIVE` sont injectés automatiquement. Utilisez `OLLAMA_NUM_PARALLEL`, `OLLAMA_ORIGINS`, etc. ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

Non applicable pour Ollama — les poids des modèles sont stockés durablement dans GCS. Ces variables sont
présentes uniquement pour la compatibilité d'interface. Voir [App_GKE](App_GKE.md).

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

Également dans ce groupe : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`,
`quota_max_pvcs`. Lorsque `enable_resource_quota = true`, les valeurs de mémoire **doivent utiliser des suffixes d'unité binaire**
(`4Gi`, `8192Mi`) — les entiers nus sont traités comme des octets par Kubernetes et bloquent toute
planification de pod.

### Groupe 9 — Jobs et tâches planifiées {#group-9--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide et définissez `default_model` pour utiliser le job d'extraction de modèle auto-généré. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents pour la gestion de modèles ou d'autres tâches. |
| `additional_services` | `[]` | Conteneurs supplémentaires déployés en tant que déploiements Kubernetes distincts (par exemple, une base de données vectorielle Qdrant à côté d'Ollama). |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones pour une plus grande disponibilité. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS dans `storage_buckets`. Le bucket de modèles est toujours créé quoi qu'il arrive. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de modèles. |
| `enable_nfs` | `false` | Non requis pour Ollama (utilise GCS Fuse). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires. Le bucket `ollama-models` à `/mnt/gcs` est toujours ajouté automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable pour Ollama. `database_type` est fixé à `"NONE"` — aucune instance Cloud SQL n'est
provisionnée. Ces variables sont présentes uniquement pour la compatibilité d'interface.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type="HTTP", path="/", initial_delay_seconds=30, failure_threshold=20 }` | Le seuil de 20 tentatives permet environ 5 minutes pour le chargement du modèle depuis GCS. |
| `liveness_probe` | `{ type="HTTP", path="/", initial_delay_seconds=60, failure_threshold=3 }` | Un délai de 60 s évite les faux redémarrages pendant le chargement du modèle. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring ; désactivée par défaut, activez-la explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 15 — Redis {#group-15--redis}

Non applicable pour Ollama. `enable_redis` est codé en dur à `false` quelle que soit cette
configuration.

### Groupe 16 — Backend GKE et cluster {#group-16--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la découverte automatique depuis Services_GCP. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; auto-généré à partir du nom de l'application lorsqu'il est vide. |
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Assurez-vous que `max_instance_count ≥ 2` lors de l'utilisation d'un PDB afin que les mises à niveau progressives puissent se poursuivre. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement du déploiement. Augmentez à `1200` pour les grands modèles (13B+). |

### Groupe 17 — StatefulSet {#group-17--statefulset}

S'applique uniquement lorsque `workload_type = "StatefulSet"`. La charge de travail de déploiement par défaut avec GCS
La persistance Fuse est recommandée ; ces paramètres ne sont pas nécessaires dans le cas typique.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer un PVC pour le stockage local de modèles. Non requis lors de l'utilisation de GCS Fuse. |
| `stateful_pvc_size` | `50Gi` | Taille du PVC (par exemple, `"100Gi"` pour plusieurs grands modèles). |
| `stateful_pvc_mount_path` | `/mnt/data` | Chemin du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Groupe 19 — Configuration du modèle Ollama {#group-19--ollama-model-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `default_model` | `""` | Modèle à extraire lors du premier déploiement (par exemple, `"llama3.2:3b"`, `"mistral"`, `"phi3:mini"`). Laissez vide pour ignorer le job d'extraction automatique. |
| `model_pull_timeout_seconds` | `3600` | Délai d'attente pour le job Kubernetes d'extraction de modèle. Les grands modèles (7B+) peuvent prendre 20 à 30 minutes. Plage valide : 300 à 7200. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `ollama_cluster_url` | URL Kubernetes interne : `http://<service-name>.<namespace>.svc.cluster.local:11434`. Utilisez-la dans d'autres pods pour appeler l'API Ollama. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsque `service_type = "LoadBalancer"` et qu'une IP statique est réservée). |
| `api_url` | URL du service. |
| `models_bucket` | Nom du bucket GCS où les poids du modèle Ollama sont persistés. |
| `storage_buckets` | Tous les buckets Cloud Storage provisionnés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (y compris `model-pull` lorsqu'il est déclenché). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que les charges de travail sont déployées. `false` lors de la première application d'un nouveau cluster intégré — réexécutez l'application pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` | `ClusterIP` | Critique | `LoadBalancer` expose publiquement l'API Ollama non authentifiée sur le port 11434. Ollama n'a pas d'authentification intégrée. |
| `container_resources.memory_limit` | `16Gi` (7B) / `8Gi` (3B) | Critique | Une mémoire insuffisante provoque un OOM-kill en cours d'inférence et un redémarrage en boucle du pod. Allouez au moins 2 fois la taille du poids du modèle quantifié. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8Gi`) | Critique | Les entiers nus (par exemple, `"4"`) sont traités comme des octets par Kubernetes et bloquent toute planification de pod dans l'espace de noms. |
| `enable_iap` | `true` si `service_type = "LoadBalancer"` | Critique | Sans IAP ou restriction VPC, l'API Ollama n'est pas authentifiée et est publiquement accessible. |
| `container_resources.cpu_limit` | `8` (7B) / `4` (3B) | Élevé | Trop peu de CPU rend la génération de jetons extrêmement lente. Pour l'inférence 7B en production, 6 à 8 cœurs sont nécessaires. |
| `min_instance_count` | `1` | Élevé | `0` permet la mise à l'échelle à zéro mais provoque des démarrages à froid de 60 à 120 s pendant que le modèle se recharge depuis GCS. |
| `model_pull_timeout_seconds` | `3600` | Élevé | Un délai d'attente court entraîne l'échec du job d'extraction de modèle avant que le téléchargement ne soit terminé pour les modèles de plus de 2 Go. |
| `deployment_timeout` | `600` | Élevé | Trop court pour un grand modèle (13B+) se chargeant depuis GCS au premier démarrage. Augmentez à `1200`. |
| `max_instance_count` | `3` | Élevé | Chaque pod charge indépendamment le modèle complet en mémoire. Trois réplicas 7B nécessitent environ 48 GiB. |
| `default_model` | défini sur le modèle souhaité | Moyen | Laisser vide est sûr pour le déploiement initial, mais l'API renvoie une erreur sur toutes les requêtes d'inférence jusqu'à ce qu'un modèle soit extrait manuellement. |
| `environment_variables.OLLAMA_NUM_PARALLEL` | `2`–`4` pour une utilisation partagée | Moyen | La valeur par défaut `1` sérialise toutes les requêtes. Augmentez pour les déploiements de clusters partagés avec des appelants concurrents. |
| `environment_variables.OLLAMA_KEEP_ALIVE` | `24h` (injecté automatiquement) | Moyen | La valeur par défaut d'Ollama (`5m`) évince les modèles de la mémoire après inactivité, ce qui entraîne des délais de rechargement de 30 à 60 s. Le module injecte `24h` automatiquement. |
| `enable_pod_disruption_budget` | `true` | Moyen | Avec `pdb_min_available = 1` et un seul réplica, les mises à niveau de nœuds glissantes bloquent. Assurez-vous que `max_instance_count ≥ 2`. |
| `enable_resource_quota` | activer pour les clusters partagés | Moyen | Sans ResourceQuota, un pod mal configuré peut consommer toutes les ressources du cluster. |
| `gcs_volumes` options de montage | inclure `implicit-dirs` | Moyen | Sans `implicit-dirs`, les listes de répertoires GCS Fuse échouent et Ollama ne peut pas découvrir les modèles mis en cache. |
| `enable_image_mirroring` | `true` | Moyen | Désactiver les extractions de Docker Hub, qui est soumis à des limites de débit. Gardez `true` en production. |

---

Pour le comportement du socle référencé tout au long — Workload Identity, autoscaling, ingress
et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application partagée spécifique à Ollama
est décrite dans **[Ollama_Common](Ollama_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Ollama sur GKE Autopilot](../labs/Ollama_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ollama sur Google Cloud Run](Ollama_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ollama Common — Configuration d'application partagée](Ollama_Common.md) — la configuration partagée par les deux cibles de déploiement.
