---
title: "Karakeep sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Karakeep sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Karakeep_GKE.md @ 3055034 sha256:66fa2ee0c01f -->

# Karakeep sur GKE Autopilot — Guide de lab {#karakeep-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Karakeep est une application open source et auto-hébergeable qui permet de tout
mettre en favoris, avec un étiquetage automatique par IA et une recherche plein
texte. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Karakeep on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Karakeep. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne, y compris le Service sidecar de recherche Meilisearch requis.
- Accéder à la charge de travail en cours d'exécution, la vérifier et créer le premier compte (administrateur).
- Effectuer les opérations du jour 2 : inspecter, connaître les limites de mise à l'échelle, mettre à jour et gérer les sauvegardes.
- Observer la charge de travail et son sidecar de recherche avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, NFS/Filestore,
  Artifact Registry et les comptes de service partagés dont dépend ce module). Vous
  n'avez pas besoin de le déployer vous-même au préalable : la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le provisionne
  avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Karakeep (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez
   en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes, le sidecar de recherche
   **Meilisearch** requis, uniquement interne, sous forme de second Service, les deux
   secrets de l'application (`NEXTAUTH_SECRET`, `MEILI_MASTER_KEY`), et monte le volume
   NFS partagé pour les deux. Il n'y a pas d'étape Cloud SQL — un premier déploiement
   prend généralement **5–10 minutes**.

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres indépendants des noms :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep karakeep | grep -v meilisearch | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   MEILI_SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep meilisearch | head -1 | cut -d/ -f2)
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   echo "Meilisearch sidecar: $MEILI_SERVICE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est sain et qu'il répond :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Ouvrez `http://$EXTERNAL_IP/` dans un navigateur (ou utilisez `kubectl port-forward` si
   `service_type = "ClusterIP"`). Karakeep affiche sa page d'inscription/de connexion.
   **Créez le premier compte** — la première personne qui s'inscrit devient
   automatiquement administrateur. Après l'avoir créé, enregistrez un favori pour
   confirmer le chemin d'écriture SQLite sur NFS, puis recherchez-le par mot-clé pour
   confirmer que le sidecar Meilisearch est joignable et qu'il indexe.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et l'historique de ses déploiements :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **N'augmentez pas `max_instance_count` au-delà de 1.** Plusieurs pods écrivant dans
   le même fichier SQLite sur NFS risquent de le corrompre — ce module n'offre aucun
   moyen pris en charge de mettre Karakeep à l'échelle horizontalement.

3. **Mettez à jour le tag de version de l'application** via le flux **Update** de la
   plateforme RAD ; un déploiement progressif `Recreate` applique la nouvelle image
   récupérée (aucun nouveau build — l'image provient directement de
   `ghcr.io/karakeep-app/karakeep`).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~karakeep"
   ```

5. **Inspectez le sidecar Meilisearch de manière indépendante :**

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app=meilisearch
   kubectl logs -n "$NAMESPACE" deploy/"$MEILI_SERVICE" --tail=50
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — l'application principale et le sidecar de recherche journalisent indépendamment :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   kubectl logs -n "$NAMESPACE" deploy/"$MEILI_SERVICE" --tail=100
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads pour l'application
   principale et pour le sidecar — une application principale saine avec un sidecar
   en difficulté paraît normale sur le tableau de bord de l'application principale ;
   vérifiez donc les deux.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod en mauvaise santé / CrashLoopBackOff :** inspectez les événements et les journaux
  du pod. La sonde de démarrage (startup probe) cible `/` avec un délai initial de 30 secondes.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **L'application se charge mais la recherche ne renvoie rien :** le sidecar
  Meilisearch est probablement arrêté ou l'injection de `MEILI_ADDR` a échoué —
  vérifiez indépendamment l'état et les journaux de son pod (tâche 3, étape 5).
- **Les favoris ne sont pas conservés / erreurs SQLite dans les journaux :** vérifiez
  que le volume NFS a bien été monté et qu'aucune seconde réplique n'écrit en même temps.
- **Déploiement bloqué après une mise à jour :** les applications reposant sur NFS
  utilisent automatiquement la stratégie de déploiement `Recreate` pour éviter que deux
  pods s'exécutent brièvement sur le même fichier SQLite — vérifiez que l'ancien pod
  s'est complètement arrêté avant le démarrage du nouveau.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire
les ressources cloud. La suppression retire tout ce que le module a créé — la
charge de travail Kubernetes, les deux Services (application principale et sidecar
Meilisearch) et les secrets Secret Manager. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE, le NFS partagé, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE (application principale + sidecar Meilisearch), le montage NFS et deux secrets |
| 2 — Accéder et vérifier | Manuel | Pod Ready, 0 redémarrage ; création du premier compte (administrateur), enregistrement et recherche d'un favori |
| 3 — Exploiter | Manuel | Inspecter le déploiement, mettre à jour la version, gérer les secrets, inspecter le sidecar indépendamment |
| 4 — Observer | Manuel | Interroger Cloud Logging pour les deux charges de travail ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de NFS, de sidecar et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime les deux Services et les secrets |
