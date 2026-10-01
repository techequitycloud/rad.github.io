---
title: "OpenClaw sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer OpenClaw sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OpenClaw_GKE.md @ 3055034 sha256:a94496e89515 -->

# OpenClaw sur GKE Autopilot — Guide de lab {#openclaw-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

OpenClaw est une passerelle d'agents d'IA multi-tenant permettant d'exécuter des assistants d'IA isolés et persistants
reposant sur des modèles Anthropic, avec des espaces de travail GCS-Fuse dédiés et une intégration facultative
de canaux Telegram ou Slack. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **OpenClaw on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit OpenClaw. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE) — ce
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
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **OpenClaw (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Une clé API Anthropic est requise lors du premier déploiement — saisissez-la dans le champ de
   paramètre correspondant. Ne configurez que ce dont vous avez besoin par ailleurs — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur personnalisée (en ajoutant `entrypoint.sh` par-dessus
   l'image OpenClaw amont), crée un bucket d'espace de travail GCS monté sur `/data` via le
   pilote CSI GCS Fuse, stocke la clé API Anthropic et le jeton de passerelle dans Secret Manager,
   puis déploie la charge de travail Kubernetes. OpenClaw ne nécessite ni Cloud SQL ni job d'initialisation — l'état
   des agents réside entièrement sur GCS. Les premiers déploiements prennent environ **15–25 minutes** (Cloud Build
   en représente l'essentiel ; le provisionnement des nœuds GKE allonge la durée pour les nouveaux clusters).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep openclaw | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Si `service_type` vaut `ClusterIP` (interne uniquement), utilisez plutôt une redirection de port :

   ```bash
   kubectl port-forward svc/$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     8080:8080 -n "$NS"
   # Access at http://localhost:8080
   ```

2. Vérifiez que le service est en bonne santé :

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"   # expect {"status":"ok"}
   ```

3. Récupérez le jeton de passerelle dans Secret Manager pour authentifier les appels d'API :

   ```bash
   GW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~openclaw~gateway-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$GW_SECRET" --project="$PROJECT"
   ```

   Le jeton de passerelle est l'identifiant utilisé par les clients et intégrations OpenClaw. La
   clé API Anthropic peut, si nécessaire, être récupérée de la même façon depuis son secret Secret Manager
   (filtrez sur `~openclaw~anthropic-api-key`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Notez
   qu'OpenClaw est avec état (stateful) ; le Service utilise l'affinité de session `ClientIP` afin que
   les connexions WebSocket soient systématiquement acheminées vers le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~openclaw"
   kubectl get jobs,cronjobs -n "$NS"   # any scheduled backup jobs
   ```

5. **Inspectez l'espace de travail GCS** qui héberge tout l'état des agents, et vérifiez qu'il est monté
   dans le pod :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~openclaw~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/"
   kubectl exec -n "$NS" \
     deploy/$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     -- ls /data
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Lorsque le test de disponibilité (uptime check) est activé,
   consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OpenClaw.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  cible `GET /health` sur le port 8080 et accorde environ 3 minutes pour le montage GCS Fuse
  et le démarrage de Node.js (36 tentatives × 5 s).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Échec du montage GCS Fuse :** vérifiez que le bucket d'espace de travail existe et que le compte de service
  Workload Identity du pod dispose du rôle Storage Object Admin sur celui-ci.
- **Erreurs de l'API Anthropic (401) :** vérifiez que le secret `anthropic-api-key` possède une
  version valide matérialisée dans l'espace de noms. Récupérez-la et vérifiez-la via Secret Manager.
- **Erreurs de jeton de passerelle :** si des clients rencontrent des échecs d'authentification après la rotation d'un secret,
  les pods doivent être recyclés (redémarrage progressif) pour prendre en compte la nouvelle valeur du jeton.
- **Échec du clonage du dépôt de skills :** une valeur `skills_repo_url`
  / `skills_repo_ref` injoignable ou inexistante place le pod en CrashLoopBackOff. Recherchez dans les journaux les entrées
  `skill-library` et corrigez l'URL/la référence dans la plateforme RAD.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou
  de quota, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, le bucket d'espace de travail GCS, les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image, provisionne l'espace de travail GCS, stocke les secrets et déploie la charge de travail GKE |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état réussit ; jeton de passerelle récupéré |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, inspecter l'espace de travail GCS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de GCS Fuse, d'API Anthropic, de jeton de passerelle, de synchronisation des skills, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
