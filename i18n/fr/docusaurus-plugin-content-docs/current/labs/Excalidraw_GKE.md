---
title: "Excalidraw sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Excalidraw sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Excalidraw_GKE.md @ 3055034 sha256:7398367b75f7 -->

# Excalidraw sur GKE Autopilot — Guide de lab {#excalidraw-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Excalidraw est un tableau blanc virtuel open source permettant d'esquisser des diagrammes au style
dessiné à la main, des maquettes et des dessins collaboratifs rapides. La distribution auto-hébergée est
une **application monopage statique servie par nginx** — il n'y a ni backend, ni base de données, ni
comptes utilisateurs. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module
**Excalidraw on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Excalidraw. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE) — ce
lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Réaliser les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour le déploiement.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Excalidraw (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme construit une image personnalisée minimale (`FROM excalidraw/excalidraw`), la copie
   dans Artifact Registry et déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   simple `Deployment` derrière un Service `LoadBalancer`. Il n'y a **ni instance Cloud SQL,
   ni secret Secret Manager, ni bucket GCS, ni NFS, ni Redis** — Excalidraw est un
   frontend statique entièrement sans état ; ce déploiement est donc l'un des plus rapides du
   catalogue, généralement **10 à 15 minutes** (dominé par le build de l'image et le provisionnement
   du LoadBalancer).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep excalidraw | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. nginx répond `200` sur le chemin racine dès qu'un
   pod est Ready — il n'y a ni base de données ni backend à attendre :

   ```bash
   curl -sI "http://${EXTERNAL_IP}/" | head -1     # expect: HTTP/1.1 200 OK
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Le tableau blanc se charge immédiatement — il n'y a
   ni connexion, ni compte administrateur, ni configuration initiale. Dessinez quelque chose et utilisez
   **Export** (menu → Export) pour enregistrer un fichier `.excalidraw`, PNG ou SVG ; c'est le seul
   mécanisme de persistance, puisque les dessins ne résident sinon que dans le stockage local
   du navigateur.

4. Notez que la fonctionnalité de collaboration en temps réel par « lien partageable » n'est **pas**
   disponible — elle dépend d'un serveur WebSocket `excalidraw-room` distinct que ce
   module ne déploie pas. L'édition par un seul utilisateur fonctionne entièrement dès l'installation.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant le paramètre de nombre maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait annulée lors de
   l'application suivante). `min_instance_count` est codé en dur à `1` dans `excalidraw.tf`,
   quelle que soit la valeur du paramètre — GKE n'offre pas de mise à l'échelle jusqu'à zéro ; un pod résident maintient donc
   toujours le tableau blanc accessible. Chaque pod est identique et sans état ; la montée en charge horizontale
   ne requiert donc ni affinité de session ni coordination.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite à partir d'une nouvelle étiquette `excalidraw/excalidraw`
   et une mise à jour progressive remplace les pods. Notez que, contrairement à certains modules apparentés,
   `latest` ne correspond **pas** ici à une étiquette figée connue pour être fiable — elle suit directement l'étiquette mobile
   `excalidraw/excalidraw:latest` de Docker Hub ; fixez donc une version explicite
   (par exemple `v1.11.86`) pour un déploiement de production reproductible. Comme il n'y a aucun
   état côté serveur, les mises à niveau et les retours arrière sont triviaux et non destructifs.

4. **Vérifiez qu'il n'y a rien d'autre à gérer :** contrairement à la plupart des modules, Excalidraw n'a ni
   secrets, ni PVC, ni base de données à inspecter :

   ```bash
   kubectl get secrets,pvc -n "$NS"                                            # no app secrets/PVCs
   gcloud secrets list --project="$PROJECT" --filter="name~excalidraw"          # (none)
   gcloud sql instances list --project="$PROJECT" --filter="name~excalidraw"    # (none)
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux (journaux d'accès et d'erreurs nginx) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du processeur et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Comme l'application est un serveur de fichiers
   statiques, l'utilisation des ressources doit rester constamment faible. Le module peut provisionner un
   **test de disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Excalidraw à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible la racine `/`, à laquelle nginx devrait répondre en une ou deux secondes — une
  sonde qui échoue de manière persistante signale presque toujours un problème de conteneur ou d'image, et non une
  dépendance applicative (il n'y a aucune base de données à attendre).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **La sonde de démarrage ne réussit jamais / mauvais port :** vérifiez que le port d'écoute du pod correspond
  au port nginx intégré à l'image (`80`) — il est fixé dans l'image et ne doit pas être modifié
  via `container_port`.
- **`build_and_push_application_image` échoue sans Dockerfile / chemin d'image non construite :**
  vérifiez que `container_image_source` vaut `custom` (la valeur par défaut).
- **Le pod sert un contenu obsolète après une reconstruction :** vérifiez que `imagePullPolicy: Always` est défini
  sur le conteneur (App_GKE le définit automatiquement pour les images construites sur mesure) et comparez
  l'empreinte (digest) de l'image en cours d'exécution à celle de l'image fraîchement construite :
  ```bash
  kubectl get pod -n "$NS" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou
  de quota, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée :
  ```bash
  kubectl get svc -n "$NS"
  ```
- **La collaboration en temps réel ne fonctionne pas :** c'est le comportement attendu — le module ne
  déploie pas le serveur WebSocket `excalidraw-room` distinct que requiert la fonctionnalité
  « lien partageable ».

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment le port fixe, le `min_instance_count = 1` codé en dur et la
mise en garde sur l'étiquette `latest` en production).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes,
l'espace de noms, le Service et l'image Artifact Registry. Il n'y a ni base de données Cloud SQL,
ni secret Secret Manager, ni bucket GCS, ni PVC à nettoyer, puisqu'aucun n'a été créé.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit et copie l'image statique, et déploie un Deployment sans état + un LoadBalancer — ni base de données, ni secrets, ni stockage |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit immédiatement ; le tableau blanc se charge sans connexion ni configuration |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (min=1 codé en dur), mettre à jour/fixer la version — aucun secret, PVC ni base de données à gérer |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de port, d'image et de LoadBalancer |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
