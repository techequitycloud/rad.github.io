---
title: "SearXNG sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez SearXNG sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/SearXNG_GKE.md @ 3055034 sha256:e664ecf0f369 -->

# SearXNG sur GKE Autopilot — Guide de lab {#searxng-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

SearXNG est un métamoteur de recherche auto-hébergé et respectueux de la vie
privée, qui agrège les résultats de plus de 70 services de recherche sans suivre
les utilisateurs ni afficher de publicités. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **SearXNG on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de SearXNG. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **SearXNG (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, génère
   la clé de session `SEARXNG_SECRET` dans Secret Manager (injectée dans les pods via
   le pilote CSI), et construit ou met en miroir l'image de conteneur. Comme SearXNG
   est entièrement sans état (ni base de données, ni job d'initialisation), les déploiements
   se terminent en quelques minutes une fois le cluster prêt.

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep searxng | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"
   ```

   Attendez-vous à un code HTTP `200`. SearXNG expose son point de terminaison de santé intégré sur `/healthz`.
   Les démarrages à froid sont rapides (moins de 5 secondes), car il n'y a ni connexion à une base de données
   ni migration de schéma au démarrage. La variante GKE maintient toujours au moins un pod
   en cours d'exécution (`min_instance_count = 1`).

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur pour accéder à l'interface de recherche
   de SearXNG. Aucun identifiant d'administration n'est requis — SearXNG n'a pas de connexion administrateur.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances dans la plateforme RAD et
   en les appliquant via **Update** — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans l'interface RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~searxng"
   ```

   `SEARXNG_SECRET` est la clé de session générée automatiquement et injectée dans les pods à
   l'exécution via le pilote Kubernetes Secret Store CSI. Elle est générée une seule fois et
   partagée par tous les réplicas de pods. Sa rotation invalide toutes les sessions utilisateur
   actives — évitez-la sauf nécessité.

5. **Inspectez les jobs** (SearXNG ne requiert par défaut aucun job d'initialisation ni job planifié, mais
   les cron jobs que vous configurez apparaissent ici) :

   ```bash
   kubectl get jobs,cronjobs -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les événements de mise à l'échelle du HPA. Le module provisionne également un
   **test de disponibilité** (uptime check, lorsqu'il est activé) ; consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de SearXNG.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Résultats de recherche vides / moteurs en amont injoignables :** SearXNG doit joindre
  les moteurs de recherche externes via Internet. Vérifiez que l'accès Internet sortant du cluster
  n'est pas bloqué par des règles de pare-feu ou des restrictions de sortie du VPC.
- **`SEARXNG_SECRET` non injecté :** vérifiez que le secret existe dans Secret Manager
  et que le compte de service du pod dispose de `secretmanager.versions.access`. Consultez les
  événements du pod du pilote CSI si le montage du volume échoue.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~searxng"
  ```
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a reçu une
  IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, les secrets Secret Manager et les images Artifact Registry.
SearXNG étant sans état, il n'y a ni base de données ni stockage persistant à supprimer.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, génère SEARXNG_SECRET et met l'image en miroir |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit sur `/healthz` ; l'interface de recherche se charge |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de sortie réseau, d'injection de secret, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
