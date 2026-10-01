---
title: "Homebox sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Homebox sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Homebox_GKE.md @ 3055034 sha256:7de04aaeb107 -->

# Homebox sur GKE Autopilot — Guide de lab {#homebox-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homebox_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Homebox est un système open source et auto-hébergé d'inventaire et d'organisation
domestique — suivez vos objets, joignez-y des photos et organisez-les par emplacement. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Homebox on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Homebox. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homebox_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et enregistrer le premier compte (administrateur).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les sauvegardes.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Homebox (GKE)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Homebox_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes, une base de données Cloud SQL (PostgreSQL)
   avec son secret Secret Manager contenant le mot de passe, le secret
   `HBOX_AUTH_API_KEY_PEPPER`, un bucket GCS `data`, et exécute un
   Job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **15–25 minutes**.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep homebox | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en bonne santé et répond :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/api/v1/status" -o /dev/null -w '%{http_code}\n'
   ```

2. Homebox n'a **aucun compte administrateur prédéfini** — il utilise l'auto-inscription
   ouverte. La première personne à soumettre le formulaire « Register » sur
   l'instance neuve devient administrateur. Il n'y a aucun identifiant à récupérer.

3. Ouvrez `http://$EXTERNAL_IP/` dans un navigateur (ou utilisez `kubectl port-forward` si
   `service_type = "ClusterIP"`) et cliquez sur **Register**. Créez le premier
   compte — il devient automatiquement administrateur. Ajoutez ensuite un objet de test (avec
   un emplacement) pour vérifier le chemin d'écriture en base de données. Une fois que vous avez confirmé
   l'existence du compte administrateur, envisagez de définir
   `HBOX_OPTIONS_ALLOW_REGISTRATION=false` via le flux **Update** de la plateforme
   RAD afin de fermer les inscriptions publiques.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement progressif (rollout) :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances via le flux
   **Update** de la plateforme RAD.

3. **Mettez à jour le tag de version de l'application** via le flux **Update** de la plateforme
   RAD.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homebox"
   kubectl get jobs -n "$NAMESPACE"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. homeboxdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^homebox" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du déploiement et
   examinez l'utilisation du CPU / de la mémoire et le nombre de répliques.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod en mauvaise santé / CrashLoopBackOff :** inspectez les événements et les journaux du pod. La
  sonde de démarrage cible `/api/v1/status`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE` et consultez les journaux du conteneur pour la valeur résolue de
  `HBOX_DATABASE_HOST` — sur GKE, elle doit être `127.0.0.1` (le
  sidecar cloud-sql-proxy).
- **Échec du Job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Quelqu'un d'autre s'est inscrit en premier / impossible de créer le compte administrateur :**
  avec l'auto-inscription ouverte de Homebox, la première personne qui soumet le formulaire « Register »
  sur une instance accessible devient administrateur. Si cela se produit
  de façon inattendue, utilisez le propre flux de récupération de compte de Homebox, ou redéployez sur une
  base de données neuve si l'instance n'était pas censée être publique.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez
plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes, le Service, la base de données Cloud SQL, les secrets Secret Manager
et le bucket GCS. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL), les secrets, un bucket GCS, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | Pod Ready, 0 redémarrage ; enregistrer le premier compte (administrateur) et ajouter un objet de test |
| 3 — Exploiter | Manuel | Inspecter le rollout, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de Job d'initialisation et d'inscription |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
