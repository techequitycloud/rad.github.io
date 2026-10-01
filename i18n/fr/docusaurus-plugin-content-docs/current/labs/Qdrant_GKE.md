---
title: "Qdrant sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Qdrant sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Qdrant_GKE.md @ 3055034 sha256:b9fb069f82d7 -->

# Qdrant sur GKE Autopilot — Guide de lab {#qdrant-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Qdrant est une base de données vectorielle et un moteur de recherche par similarité hautes performances conçus
pour les charges de travail d'IA — pipelines RAG, systèmes de recommandation, recherche sémantique et
stockage d'embeddings. Ce lab vous fait parcourir tout le cycle de vie opérationnel du
module **Qdrant on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Qdrant. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

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
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Qdrant (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   le stockage persistant (un PVC de StatefulSet lorsque `stateful_pvc_enabled = true`, ou sinon un
   bucket Cloud Storage monté via GCS FUSE), construit l'image de conteneur
   et stocke une clé d'API dans Secret Manager lorsque `enable_api_key = true`. Qdrant
   n'a ni base de données SQL ni job d'initialisation. Un premier déploiement prend généralement
   **10 à 20 minutes** (le build de l'image et le provisionnement des nœuds dominent).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep qdrant | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute. Qdrant expose deux points de terminaison de santé distincts
   — `/readyz` (signale l'état prêt une fois toutes les collections chargées) et `/livez`
   (répond toujours tant que le processus est actif). Redirigez le port du service pour
   les atteindre depuis votre shell :

   ```bash
   kubectl get pods,svc -n "$NS"
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward "svc/$SVC" 6333:6333 -n "$NS" &
   sleep 3
   curl -s http://localhost:6333/readyz    # expect {"result":true,"status":"ok",...}
   curl -s http://localhost:6333/livez     # expect {"result":true,"status":"ok",...}
   ```

   Si le type de service est `LoadBalancer`, utilisez plutôt directement l'IP externe :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:6333/readyz"
   ```

2. Si `enable_api_key = true`, récupérez la clé d'API dans Secret Manager avant
   d'effectuer des requêtes authentifiées :

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~qdrant AND name~api-key" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT"
   ```

   Transmettez la valeur récupérée dans l'en-tête `api-key` de tous les appels REST à Qdrant.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — pods, HPA et (s'ils sont activés) volumes persistants :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances dans la plateforme RAD et
   en l'appliquant via **Update** — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration et non un `kubectl scale` manuel (une modification manuelle serait annulée lors de la
   prochaine application). Conservez `max_instance_count = 1` ; Qdrant est un magasin à écrivain unique
   et plusieurs pods partageant le même PVC (RWO) ou le même bucket GCS corrompent les collections.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans l'interface
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~qdrant"
   kubectl get jobs,cronjobs -n "$NS"      # any scheduled snapshot or maintenance jobs
   ```

5. **Inspectez le stockage** — vérifiez que le PVC est lié ou que le bucket GCS existe :

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls /qdrant/storage
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module
   provisionne également un **contrôle de disponibilité** (uptime check, lorsqu'il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Qdrant.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Démarrage lent / `/readyz` renvoie 503 :** au démarrage, Qdrant charge en mémoire toutes les collections depuis
  le disque. Les collections volumineuses peuvent prendre de quelques dizaines de secondes à
  plusieurs minutes. La sonde de démarrage attend `/readyz` ; prévoyez un délai supplémentaire
  avant de déclarer le pod non sain.
- **PVC non lié / erreurs de stockage :** vérifiez que le PVC a bien été provisionné
  et que le fsGroup est correctement défini pour l'accès en écriture :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Erreurs de clé d'API (401/403) :** vérifiez que `enable_api_key = true` a été défini au
  moment du déploiement, que le secret a été matérialisé dans le namespace et que l'en-tête `api-key`
  figure dans les requêtes.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a reçu une
  IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail
Kubernetes et son namespace, le PVC et le Persistent Disk sous-jacent (s'ils sont utilisés), le bucket
Cloud Storage (s'il est utilisé), les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le stockage persistant et un secret de clé d'API facultatif |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; les contrôles de santé réussissent sur `/readyz` et `/livez` ; clé d'API récupérée si elle est activée |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets, le stockage et les jobs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de stockage, de clé d'API, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
