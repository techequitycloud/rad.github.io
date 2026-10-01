---
title: "NodeRED sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer NodeRED sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/NodeRED_GKE.md @ 3055034 sha256:c6859cf7323e -->

# NodeRED sur GKE Autopilot — Guide de lab {#nodered-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Node-RED est un outil open source de programmation par flux qui permet de relier des appareils IoT,
des API et des services en ligne au moyen d'un éditeur visuel dans le navigateur. Ce lab vous fait parcourir
l'intégralité du cycle de vie opérationnel du module **Node-RED on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Node-RED. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Filestore NFS,
  Artifact Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce
  module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **NodeRED (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne un
   partage Filestore NFS monté sur `/data` pour le stockage persistant des flux, un bucket Cloud Storage,
   un secret Secret Manager pour la clé de chiffrement des identifiants des flux, et met en miroir
   ou construit l'image du conteneur. Aucune base de données n'est provisionnée. Les premiers déploiements prennent
   environ **10–20 minutes** (le provisionnement de Filestore en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep nodered | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe. Node-RED écoute sur
   le port 1880 ; le module l'expose via un Service LoadBalancer :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"
   # expect: 200
   ```

2. Ouvrez l'éditeur Node-RED dans votre navigateur à l'adresse `http://${EXTERNAL_IP}`. Aucun identifiant
   n'est requis par défaut ; pour les déploiements de production, IAP est recommandé (voir le
   Guide de configuration). L'éditeur permet la modification complète des flux et la gestion des identifiants
   — ne le laissez pas accessible publiquement en production.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et (s'ils sont activés) l'autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Conservez
   `max_instance_count = 1` sauf si les flux sont sans état ou si le stockage de contexte externe adossé à Redis
   est activé ; l'affinité de session (`ClientIP`) est requise pour les connexions WebSocket
   de l'éditeur.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est mise en miroir ou construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~nodered"
   kubectl get jobs,cronjobs -n "$NS"          # any custom scheduled jobs
   ```

5. **Inspectez le stockage adossé à NFS** — tous les flux, identifiants et nœuds de palette installés
   sont conservés dans le partage Filestore monté sur `/data` :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl exec -n "$NS" \
     deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls /data
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Le module provisionne également un
   **test de disponibilité** (uptime check) sur `/` (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Node-RED.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  cible HTTP GET `/` avec un délai initial de 30 secondes ; le montage NFS allonge le temps de démarrage.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Échec du montage NFS :** vérifiez que l'instance Filestore est `READY` et que le tag réseau
  `nfsserver` (requis pour les règles de pare-feu NFS) est présent sur le pool de nœuds.
  Vérifiez que `enable_nfs = true` et `nfs_mount_path = "/data"` sont correctement définis.
- **Identifiants des flux illisibles après un **Update** :** le `NODE_RED_CREDENTIAL_SECRET`
  a peut-être été renouvelé ou modifié. Récupérez la valeur actuelle du secret et vérifiez qu'elle
  correspond à la clé utilisée lors du dernier déploiement des flux.
  ```bash
  CRED_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~nodered" --format="value(name)" --limit=1)
  gcloud secrets versions access latest --secret="$CRED_SECRET" --project="$PROJECT"
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, l'instance Filestore NFS, les secrets Secret Manager, le bucket GCS, l'IP statique et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Filestore NFS, le bucket GCS et le secret des identifiants |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit (HTTP 200 depuis `/`) ; l'éditeur se charge dans le navigateur |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, inspecter NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage NFS, d'identifiants, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
