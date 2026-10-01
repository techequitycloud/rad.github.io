---
title: "Radicale sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Radicale sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Radicale_GKE.md @ 3055034 sha256:403ddef60236 -->

# Radicale sur GKE Autopilot — Guide de lab {#radicale-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 60 minutes

Radicale est un serveur CalDAV/CardDAV open source et auto-hébergé pour la synchronisation
des calendriers et des contacts. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **Radicale on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Radicale. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD (avec un PVC bloc de type production) et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution et la vérifier, récupérer l'identifiant administrateur généré et connecter un client CalDAV/CardDAV.
- Créer un NOUVEAU calendrier sur GKE (ce qui fonctionne nativement, contrairement à Cloud Run) et comprendre où atterrissent les collections par défaut pré-créées lorsqu'un PVC est utilisé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- (Facultatif) Un client CalDAV/CardDAV pour vérifier la synchronisation de bout en bout — par exemple Thunderbird, Apple Calendar/Contacts ou DAVx5.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Radicale (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. **Définissez
   explicitement `application_display_name = "Radicale"`** (la valeur par défaut du module
   contient actuellement une valeur obsolète héritée du module dont il a été cloné),
   et **définissez `stateful_pvc_enabled = true`** pour un déploiement de type production
   avec un véritable stockage en mode bloc. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes (un StatefulSet lorsque
   `stateful_pvc_enabled = true`, sinon un Deployment adossé à GCS
   FUSE), un secret Secret Manager contenant un `ADMIN_PASSWORD` généré, et
   exécute le Job d'initialisation `seed-default-collections`. Les premiers déploiements
   prennent généralement **5 à 10 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep radicale | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est sain et qu'il répond :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code}\n'   # expect 302
   ```

2. Radicale est livré **sans compte administrateur intégré par défaut** — récupérez
   l'identifiant généré dans Secret Manager :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~radicale-admin-password" \
     --format="value(name)" --limit=1)
   ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Username: admin"
   echo "Password: $ADMIN_PASSWORD"
   ```

3. Vérifiez que l'accès authentifié fonctionne avec un `PROPFIND` sur le principal
   de l'administrateur (résultat attendu : `207 Multi-Status`) :

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X PROPFIND "http://$EXTERNAL_IP/admin/" \
     -H "Depth: 1" -o /dev/null -w '%{http_code}\n'
   ```

4. **Si vous avez déployé avec `stateful_pvc_enabled = true`**, le Default Calendar et le
   Default Address Book pré-créés **n'apparaîtront pas** (le job d'amorçage
   ne peut pas monter le PVC du StatefulSet — voir la tâche 5). Créez directement votre premier
   calendrier — cela fonctionne nativement sur GKE, contrairement à Cloud Run :

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X MKCOL "http://$EXTERNAL_IP/admin/my-calendar/" \
     -o /dev/null -w '%{http_code}\n'   # expect 201 Created
   ```

   Si vous avez déployé **sans** PVC, connectez un client CalDAV/CardDAV
   (Thunderbird, Apple Calendar, DAVx5) à `http://$EXTERNAL_IP/admin/` et
   vous devriez voir le **Default Calendar** et le **Default Address
   Book** pré-créés.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"     # if stateful_pvc_enabled = true
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # otherwise
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** — `max_instance_count` est fixé à `1` et ne doit **pas** être
   augmenté : le backend de stockage de Radicale n'est pas conçu pour un accès concurrent
   par plusieurs instances. `min_instance_count` peut être porté à `1` via le
   flux **Update** de la plateforme RAD si vous souhaitez éviter les démarrages à froid.

3. **Mettez à jour le tag de version de l'application** via le flux **Update**
   de la plateforme RAD. Attention : les tags du registre de conteneurs de Radicale n'ont **pas de préfixe `v`**
   (par exemple `3.7.7`, et non `v3.7.7`).

4. **Gérez les secrets et le PVC :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~radicale"
   kubectl get jobs -n "$NAMESPACE"
   kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=100
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads de la charge de travail et
   examinez l'utilisation CPU/mémoire et le nombre de réplicas.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod non sain / CrashLoopBackOff :** examinez les événements et les journaux du pod. La
  sonde de démarrage cible `/`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=200
  ```
- **`seed-default-collections` a réussi, mais aucun calendrier par défaut n'apparaît
  sur un déploiement adossé à un PVC.** C'est **attendu, et non un bogue**, lorsque
  `stateful_pvc_enabled = true`. Le job d'amorçage (un Job partagé du module Common
  Cloud-Run/GKE) ne monte que le bucket GCS `storage` partagé — il ne peut pas
  s'attacher au PVC bloc `ReadWriteOnce` du StatefulSet, déjà
  détenu par le pod en cours d'exécution. Les écritures du job atterrissent sans conséquence dans le
  bucket GCS inutilisé. Créez plutôt votre premier calendrier via `curl -X MKCOL` ou un véritable
  client CalDAV (voir la tâche 2, étape 4) — cela fonctionne nativement sur GKE.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<seed-default-collections-job-name>
  ```
- **PVC bloqué en `Pending` :** vérifiez la StorageClass et le quota régional.
  `stateful_pvc_storage_class` vaut `standard` (HDD) par défaut précisément pour
  éviter le quota `SSD_TOTAL_GB`, très limité — si vous l'avez remplacé par
  `standard-rwo`/`premium-rwo` (SSD), vérifiez que vous disposez d'une marge de quota SSD.
  ```bash
  kubectl describe pvc -n "$NAMESPACE"
  ```
- **401 Unauthorized sur chaque requête, même avec un identifiant
  apparemment correct :** vérifiez que vous avez récupéré le `ADMIN_PASSWORD` *actuel*
  dans Secret Manager, et que vous utilisez `admin` (ou votre
  `ADMIN_USERNAME` configuré), et non une adresse e-mail.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. La suppression retire tout ce que le module a créé —
la charge de travail Kubernetes, le Service, le PVC (s'il est utilisé), les secrets Secret Manager et
le bucket GCS. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE (StatefulSet + PVC recommandé) et un secret administrateur généré, puis exécute le job d'amorçage des collections par défaut |
| 2 — Accéder et vérifier | Manuel | Pod Ready, 0 redémarrage ; récupérer le mot de passe administrateur généré ; créer/vérifier un calendrier (MKCOL fonctionne nativement sur GKE) |
| 3 — Exploiter | Manuel | Inspecter le déploiement, comprendre la limite de mise à l'échelle `max=1`, mettre à jour la version, gérer le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de job d'amorçage/montage du PVC et d'authentification |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le PVC et chaque collection stockée |
