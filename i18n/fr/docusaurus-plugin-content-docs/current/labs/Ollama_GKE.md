---
title: "Ollama sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Ollama sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Ollama_GKE.md @ 3055034 sha256:7ecb1f6e8fab -->

# Ollama sur GKE Autopilot — Guide de lab {#ollama-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ollama_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Ollama est un serveur open source d'inférence de LLM qui sert de grands modèles de langage — Llama,
Mistral, Gemma, Phi et d'autres — via une API REST. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Ollama on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités
du produit Ollama ou les workflows propres à chaque modèle. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ollama_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer le stockage des modèles et les jobs.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Ollama (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Ne configurez
   que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ollama_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail Ollama dans le cluster GKE Autopilot, provisionne un bucket
   GCS pour le stockage des poids des modèles (monté via GCS Fuse CSI sur `/mnt/gcs`), construit ou
   met en miroir l'image du conteneur et exécute éventuellement un Job Kubernetes ponctuel de récupération de modèle si
   `default_model` est défini. Il n'y a pas de base de données.
   Les premiers déploiements prennent généralement **15–30 minutes** (davantage si un modèle volumineux est récupéré).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep ollama | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

Ollama est déployé avec un service `ClusterIP` par défaut — l'API est joignable depuis
l'intérieur du cluster, mais pas depuis l'internet public. Pour y accéder depuis votre machine locale, utilisez
`kubectl port-forward` :

```bash
SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
kubectl port-forward "svc/${SVC}" 11434:11434 -n "$NS"
```

Laissez la redirection de port tourner dans un terminal séparé, puis vérifiez que le service
répond :

```bash
curl http://localhost:11434   # expect: Ollama is running
```

Ollama n'a aucun identifiant administrateur ni aucun secret Secret Manager à récupérer — l'API est
non authentifiée au sein du cluster, par conception.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods, le HPA et (s'ils sont activés) les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est mise en miroir et une mise à jour progressive remplace les pods.

4. **Inspectez le bucket de stockage des modèles et les jobs Kubernetes :**

   ```bash
   MODELS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~ollama" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
   kubectl get jobs -n "$NS"   # model-pull job if default_model was configured
   ```

5. Ollama n'a pas de base de données SQL — il n'y a ni instance Cloud SQL ni job `db-init` à
   gérer.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les événements de mise à l'échelle du HPA. L'utilisation de la mémoire reste élevée
   tant que les poids des modèles sont chargés en mémoire. Le module provisionne également un **test de disponibilité** (uptime check)
   (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Ollama.

- **Pod non Ready / CrashLoopBackOff :** la sonde de démarrage cible `GET /` avec un seuil d'échec
  généreux pour tenir compte du chargement des modèles via GCS Fuse (30–120 s). Inspectez les événements et
  les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs GCS Fuse / modèle introuvable :** vérifiez que le bucket des modèles existe, que le compte de service
  Workload Identity du pod dispose du rôle Storage Object Viewer sur celui-ci et que le volume GCS Fuse CSI
  est correctement monté sur `/mnt/gcs`.
- **OOM / boucle de redémarrage du conteneur :** Ollama nécessite en mémoire au moins 2× la taille des poids
  quantifiés du modèle. Augmentez `container_resources.memory_limit` dans la plateforme RAD et appliquez-le via **Update**.
- **Échec du job de récupération de modèle :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<model-pull-job>
  ```
- **Pod en attente / planification bloquée :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou
  de quotas ; GKE Autopilot peut avoir besoin de quelques minutes pour provisionner la capacité de nœuds requise.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, le bucket GCS des modèles (et tous les poids de modèles téléchargés), les images Artifact Registry
et les tests de disponibilité Cloud Monitoring. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le stockage GCS des modèles et un job facultatif de récupération de modèle |
| 2 — Accéder et vérifier | Manuel | Redirection de port vers le service interne au cluster ; la vérification d'état réussit sur `/` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer le stockage des modèles et les jobs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de GCS Fuse, d'OOM, de job de récupération de modèle, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris les poids des modèles |
