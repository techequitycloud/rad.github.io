---
title: "Chroma sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Chroma sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Chroma_GKE.md @ 3055034 sha256:bdb2f5293625 -->

# Chroma sur GKE Autopilot — Guide de lab {#chroma-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Chroma est une base de données vectorielle open source conçue pour l'IA, dédiée
aux embeddings et à la recherche par similarité. Elle alimente les pipelines RAG,
la recherche sémantique et les workflows LangChain/LlamaIndex. Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **Chroma on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Chroma. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Chroma (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne un
   PersistentVolumeClaim (lorsque `stateful_pvc_enabled = true`) ou un bucket Cloud Storage
   adossé à GCS FUSE comme backend de persistance de Chroma, construit l'image de conteneur
   et crée éventuellement un jeton d'authentification dans Secret Manager. `reserve_static_ip` et
   `enable_custom_domain` valent tous deux `true` par défaut, si bien qu'une IP statique est réservée même si
   vous ne définissez jamais `application_domains`. Chroma ne requiert ni base de données ni
   job d'initialisation — un grand groupe de paramètres de base de données/Redis n'est déclaré que
   par souci de cohérence avec les conventions et n'a aucun effet (voir le Guide de configuration). Un
   premier déploiement prend environ **10 à 20 minutes** (le build de l'image domine).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chroma | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez le service :

   ```bash
   kubectl get pods,svc -n "$NS"
   ```

   Le service est par défaut de type `ClusterIP` (accès interne au cluster uniquement). Si
   `service_type = "LoadBalancer"` a été défini, récupérez l'IP externe :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez le heartbeat depuis l'intérieur du cluster (ou via l'IP du LoadBalancer si
   le service est exposé à l'extérieur). Chroma expose un unique point de terminaison de santé sur le port 8000 :

   ```bash
   # From outside the cluster via LoadBalancer
   curl -s "http://${EXTERNAL_IP}:8000/api/v2/heartbeat"   # expect {"nanosecond heartbeat": <timestamp>}

   # From inside the cluster via port-forward
   kubectl port-forward svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     8000:8000 -n "$NS" &
   curl -s "http://localhost:8000/api/v2/heartbeat"
   ```

3. Si `enable_auth_token = true` a été défini au moment du déploiement, récupérez le
   jeton d'authentification dans Secret Manager avant tout autre appel d'API :

   ```bash
   AUTH_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~chroma AND name~auth-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$AUTH_SECRET" --project="$PROJECT"
   ```

   Transmettez le jeton sous la forme `Authorization: Bearer <token>` dans chaque requête d'API.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — pods, HPA et (lorsqu'elle repose sur un PVC) les volumes persistants :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS" 2>/dev/null || kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Conservez
   `max_instance_count = 1` : plusieurs pods Chroma partageant le même PVC ou le même chemin GCS
   n'ont aucun verrou d'écriture distribué et corrompraient les collections.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chroma"
   kubectl get pvc -n "$NS"          # PVC status when stateful_pvc_enabled = true
   ```

5. **Listez les éventuels jobs planifiés :**

   ```bash
   kubectl get jobs,cronjobs -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et le comportement du HPA. Le module provisionne également un
   **test de disponibilité** (uptime check, lorsqu'il est activé) ciblant `/api/v2/heartbeat` ; consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Chroma.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Chroma charge les index
  HNSW depuis son backend de stockage au démarrage — laissez à la sonde `/api/v2/heartbeat`
  le temps de réussir.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC non lié (Bound) :** vérifiez que `stateful_pvc_enabled = true` est défini et que la
  classe de stockage existe dans le cluster (`kubectl get storageclass`).
- **Erreurs de montage GCS FUSE (lorsque le PVC n'est pas utilisé) :** vérifiez que le bucket GCS existe et que
  le compte de service de la charge de travail dispose de `storage.objectAdmin` sur le bucket.
- **Erreurs de jeton d'authentification (401) :** vérifiez que `enable_auth_token = true` a été défini, que le secret
  existe et que l'en-tête `Authorization: Bearer <token>` figure dans chaque requête.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quota, et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de
  service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, le PVC et toutes les collections stockées, le bucket de données GCS, les secrets Secret Manager
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le PVC ou le bucket de données GCS et un jeton d'authentification facultatif |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle heartbeat réussit ; jeton d'authentification récupéré s'il est activé |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage PVC/GCS, de jeton d'authentification, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
