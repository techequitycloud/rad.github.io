---
title: "SparkyFitness sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez SparkyFitness sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/SparkyFitness_GKE.md @ 3055034 sha256:d549b75ffd1e -->

# SparkyFitness sur GKE Autopilot — Guide de lab {#sparkyfitness-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 75 minutes

SparkyFitness est un outil auto-hébergé de suivi familial de l'alimentation, de la forme physique, de l'hydratation et de la santé,
assisté par l'IA. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **SparkyFitness on GKE Autopilot** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit SparkyFitness. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder à l'application en cours d'exécution et la vérifier (backend et frontend sous forme de
  Deployments/Services distincts).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer les charges de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace-from-outputs>"
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la plateforme RAD, puis ouvrez **SparkyFitness (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le **backend** comme Deployment/Service principal, le
   **frontend** comme Deployment/Service `additional_services` distinct doté d'une
   **IP externe statique réservée pour le LoadBalancer**, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager
   (`SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
   `SPARKY_FITNESS_APP_DB_PASSWORD` et le mot de passe de la base de données), et exécute un job ponctuel
   `db-init`. Les premiers déploiements prennent environ **20 à 30 minutes** (le provisionnement de Cloud SQL et du
   cluster représente l'essentiel de ce temps). L'image du frontend est préconstruite ; l'image du backend est construite
   par Cloud Build à partir de `SparkyFitness_Common/scripts/Dockerfile` (une fine surcouche
   corrigée pour SSL).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   kubectl get deployments -n "$NAMESPACE"
   FRONTEND_IP=$(kubectl get service -n "$NAMESPACE" \
     -l app.kubernetes.io/component=frontend -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || \
     kubectl get services -n "$NAMESPACE" -o wide | grep frontend)
   echo "Frontend: http://$FRONTEND_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le Service frontend dispose d'une véritable IP externe et qu'il répond :

   ```bash
   kubectl get service -n "$NAMESPACE" -o wide
   curl -s -o /dev/null -w '%{http_code}\n' "http://$FRONTEND_IP"   # expect 200
   ```

2. Ouvrez `http://$FRONTEND_IP` dans un navigateur. Lors de la première visite, inscrivez-vous pour créer le
   premier compte utilisateur — SparkyFitness ne dispose d'aucun identifiant administrateur prédéfini dans Secret
   Manager. `admin_email` ne fait qu'ÉLEVER les privilèges d'un compte existant, il n'en crée pas ;
   l'inscription doit donc avoir lieu en premier.

3. Après avoir créé le compte, définissez `admin_email` dans la plateforme RAD et cliquez sur
   **Update** pour lui accorder les privilèges d'administrateur. Envisagez ensuite de définir `disable_signup = true`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les deux Deployments et leurs pods :**

   ```bash
   kubectl get deployments -n "$NAMESPACE"
   kubectl get pods -n "$NAMESPACE" -o wide
   kubectl describe deployment <backend-deployment> -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est maître de la spécification de la charge de travail ; la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply, même si `kubectl scale --replicas=0` reste acceptable
   temporairement pour réduire les coûts entre deux sessions).

3. **Mettez à jour l'étiquette de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update**. Elle étiquette À LA FOIS l'image du frontend et
   celle du backend de façon identique — utilisez exactement le format d'étiquette en amont (par ex. `v0.17.3`,
   et non `0.17.3` seul).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~sparkyfitness"
   kubectl get secret -n "$NAMESPACE"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (connectez-vous avec le rôle
   administrateur — le rôle de niveau application est géré en interne par le backend) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. sparkyfitnessdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^sparkyfitness" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer, par Deployment :

   ```bash
   kubectl logs -n "$NAMESPACE" deployment/<backend-deployment> --tail=100
   kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads et examinez les redémarrages de pods,
   l'utilisation du CPU et de la mémoire, et la latence des requêtes (si elle est configurée). Examinez Monitoring →
   Uptime checks / Alerting → Policies s'ils sont activés.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de SparkyFitness.

- **Pod frontend sain mais les appels `/api/*` restent bloqués :** le frontend relaie les requêtes vers le
  Service du backend sur le port **80** (le port fixe des Services App_GKE), et non sur
  `container_port` (3010) — vérifiez avec `kubectl get service <backend-service> -n "$NAMESPACE"`
  que le port 80 existe et qu'il pointe vers le targetPort du backend.
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=50
  ```
- **Pod backend en CrashLoopBackOff :** recherchez un échec de connexion à la base de données —
  vérifiez que le sidecar Cloud SQL Auth Proxy est sain et que l'instance est `RUNNABLE`.
  ```bash
  kubectl describe pod <backend-pod> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <backend-pod> -c cloud-sql-proxy
  ```
- **Échec du job `db-init` :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<service-name>-db-init
  ```
- **Le LoadBalancer du frontend n'a pas d'IP externe :** l'IP statique réservée
  (`google_compute_address`) a peut-être épuisé le quota global
  `IN_USE_ADDRESSES` du projet — vérifiez `gcloud compute addresses list --project "$PROJECT"`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service de la charge de travail.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner `BETTER_AUTH_SECRET` une fois que
des utilisateurs ont activé la 2FA).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec
l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — les deux Deployments/Services,
l'IP statique réservée du frontend, la base de données Cloud SQL et les secrets Secret Manager.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne les Deployments/Services backend et frontend, Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le LB du frontend renvoie 200 ; s'inscrire pour créer le premier compte, puis définir `admin_email` |
| 3 — Exploiter | Manuel | Inspecter les Deployments et les pods, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging par Deployment ; examiner le tableau de bord GKE Workloads |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pods frontend/backend, de base de données, de job d'initialisation et de quota d'IP |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
