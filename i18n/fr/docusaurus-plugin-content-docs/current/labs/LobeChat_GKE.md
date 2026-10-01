---
title: "LobeChat sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez LobeChat sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/LobeChat_GKE.md @ 3055034 sha256:5b189839c5d4 -->

# LobeChat sur GKE Autopilot — Guide de lab {#lobechat-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LobeChat_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 20 à 40 minutes

Une interface de chat LLM open source et sans état, prenant en charge plusieurs fournisseurs d'IA. Ce lab vous fait parcourir le cycle de vie opérationnel complet
du module **LobeChat on GKE Autopilot** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit LobeChat. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LobeChat_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
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
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, ouvrez **LobeChat (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LobeChat_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, construit l'image du conteneur et crée le namespace et le Deployment Kubernetes. Aucune base de données ni aucun job d'initialisation n'est nécessaire. Les premiers déploiements prennent environ
   **10 à 20 minutes** (la construction de l'image domine).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep lobechat | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Contrôle de santé** — confirmez que les pods sont en cours d'exécution et que le service répond :

   ```bash
   kubectl get pods -n "$NS"
   # Retrieve the external IP or ingress hostname
   kubectl get svc,gateway,httproute -n "$NS"
   ```

   Une fois que vous disposez du point de terminaison du service ou de l'adresse de la Gateway, confirmez le code HTTP **200** :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://<ENDPOINT>/"
   ```

   Attendez-vous à un HTTP **200**. Le corps de la réponse est l'interface de chat Next.js de LobeChat.

2. **Ouvrez l'application** — accédez au point de terminaison du service dans votre navigateur. LobeChat est une application sans état ; aucun identifiant n'est nécessaire pour accéder à l'interface. Dans le mode par défaut avec stockage côté client, les clés d'API des fournisseurs d'IA (OpenAI, Anthropic, etc.) sont fournies par chaque utilisateur directement dans le navigateur — LobeChat ne génère aucun secret, et le module ne propose aucun paramètre « choisir les fournisseurs à activer ». Un opérateur peut, s'il le souhaite, injecter côté serveur des clés de fournisseur via la map générique `secret_environment_variables` (Guide de configuration, groupe 5) afin de préconfigurer un fournisseur pour tous les utilisateurs. Confirmez que l'interface de chat se charge et, si vous avez ajouté votre propre clé de fournisseur dans l'interface, que ce fournisseur apparaît dans le sélecteur de modèle.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment ou le StatefulSet, les pods et (s'ils sont activés) l'autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module détient la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de l'application suivante).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~lobechat"
   gcloud storage buckets list --project="$PROJECT" --filter="name~lobechat"
   kubectl get jobs,cronjobs -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Lorsqu'ils sont activés, examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LobeChat.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
  Une cause courante et précise : le processus SSR Next.js de LobeChat (avec ses dépendances de rendu
  `pdfjs-dist`/canvas) manque de mémoire (OOM) sous 512Mi — les journaux `--previous` affichent `FATAL ERROR:
  Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of
  memory`. `container_resources.memory_limit` vaut par défaut `1Gi`, le minimum pour un
  démarrage stable ; s'il a été abaissé, remontez-le à au moins `1Gi`.
- **Pod en attente / contraintes de ressources :** consultez les événements de `kubectl describe pod` pour détecter
  des problèmes de ressources ou de quota Autopilot.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Charge de travail GKE déployée ; namespace et image créés |
| 2 — Accéder et vérifier | Manuel | Interface de chat accessible sur le point de terminaison du cluster ; fournisseur(s) d'IA confirmé(s) dans le sélecteur de modèle |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les défaillances de pods, CrashLoopBackOff, les erreurs de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
