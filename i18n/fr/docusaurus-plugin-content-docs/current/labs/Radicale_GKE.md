---
title: "Radicale sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployez Radicale sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Radicale_GKE.md @ 15fd4c7 sha256:6b17aa20bade -->

# Radicale sur GKE Autopilot — Guide de Lab {#radicale-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 30 à 60 minutes

Radicale est un serveur CalDAV/CardDAV open-source auto-hébergé pour la
synchronisation de calendriers et de contacts. Ce lab vous guide à travers le
cycle de vie opérationnel complet du module **Radicale sur GKE Autopilot**
sur Google Cloud : déployez-le, accédez-y et vérifiez-le, utilisez-le au
quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Radicale. Pour la
liste complète des services provisionnés et de chaque entrée de
configuration (organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE) — ce
lab ne duplique délibérément pas ces détails afin qu'ils restent précis au
fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD (avec un PVC de type bloc de
  production) et localiser les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution et la vérifier,
  récupérer les identifiants d'administrateur générés et connecter un client
  CalDAV/CardDAV.
- Créer un NOUVEAU calendrier sur GKE (ce qui fonctionne nativement,
  contrairement à Cloud Run) et comprendre où les valeurs par défaut
  pré-remplies atterrissent lorsqu'un PVC est utilisé.
- Effectuer des opérations de jour 2 — inspecter, mettre à l'échelle et
  mettre à jour.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les
  plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact
  Registry et les comptes de service partagés dont ce module dépend). Vous
  n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et le
  provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation de déploiement vous demande de prouver
  que vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes affichées en tant que Propriétaire du projet, puis **Vérifier**)
  et de donner le rôle de **Propriétaire** au compte de service de
  déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de
  tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de
  création ne demande que la première page d'entrées (et, dans un projet
  créé par RAD pour vous, guère plus que le nom du locataire et la région).
  Toutes les autres entrées du Guide de configuration — y compris les entrées
  de mise à l'échelle et de version dans les tâches de jour 2 — sont
  modifiées ultérieurement avec **Update** sur la page du déploiement après
  avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits
  couvrant le coût de build estimé de la mise à jour (les mises à jour
  n'entraînent jamais de frais de module). Dans un environnement de lab, seul
  un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.
- (Facultatif) Un client CalDAV/CardDAV pour vérifier la synchronisation de
  bout en bout — par exemple Thunderbird, Apple Calendar/Contacts ou DAVx5.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les
réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD
   modules**, puis ouvrez **Radicale (GKE)** depuis la liste **Platform
   Modules**, choisissez **Configuration Form** sous *How would you like to
   configure this deployment?* (le formulaire s'ouvre sur l'**Assistant
   Conversationnel** si vous détenez des crédits achetés ou si vous êtes un
   partenaire ou un administrateur), définissez `project_id`, et
   examinez les entrées. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut.
   **Définissez `application_display_name = "Radicale"` explicitement** (la valeur par défaut
   du module contient actuellement une valeur obsolète héritée de sa source
   de clonage), et **gardez `stateful_pvc_enabled = true`** (la valeur par défaut) : la
   création d'un calendrier ou d'un carnet d'adresses échoue sur
   l'alternative GCS FUSE. Cliquez sur **Deploy Module**, examinez le coût
   estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle
   apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite
   une étape de confirmation, comme la vérification d'un projet que vous
   apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les logs en temps réel.

2. La plateforme provisionne la charge de travail Kubernetes (un StatefulSet
   avec un PVC de type bloc par défaut), un secret Secret Manager contenant
   un `ADMIN_PASSWORD` généré, et exécute le Job d'initialisation
   `seed-default-collections`. Les premiers déploiements prennent généralement **5 à
   10 minutes**.

3. Une fois terminé, découvrez les ressources avec des filtres
   indépendants du nom :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep radicale | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est sain et fonctionne :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code}\n'   # expect 302
   ```

2. Radicale n'est livré avec **aucun compte administrateur par défaut
   intégré** — récupérez les identifiants générés depuis Secret Manager :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~radicale-admin-password" \
     --format="value(name)" --limit=1)
   ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Username: admin"
   echo "Password: $ADMIN_PASSWORD"
   ```

3. Confirmez que l'accès authentifié fonctionne avec un `PROPFIND`
   contre le principal de l'administrateur (attendez `207 Multi-Status`) :

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X PROPFIND "http://$EXTERNAL_IP/admin/" \
     -H "Depth: 1" -o /dev/null -w '%{http_code}\n'
   ```

4. **Si vous avez déployé avec `stateful_pvc_enabled = true`**, le calendrier par
   défaut/carnet d'adresses par défaut pré-rempli **n'apparaîtra pas** (le
   job de pré-remplissage ne peut pas monter le PVC du StatefulSet — voir
   Tâche 5). Créez votre premier calendrier directement — cela fonctionne
   nativement sur GKE, contrairement à Cloud Run :

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X MKCOL "http://$EXTERNAL_IP/admin/my-calendar/" \
     -o /dev/null -w '%{http_code}\n'   # expect 201 Created
   ```

   Si vous avez déployé **sans** PVC, connectez un client CalDAV/CardDAV
   (Thunderbird, Apple Calendar, DAVx5) à `http://$EXTERNAL_IP/admin/` et vous
   devriez voir le **Calendrier par défaut** et le **Carnet d'adresses par
   défaut** pré-remplis.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"     # if stateful_pvc_enabled = true
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # otherwise
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Mise à l'échelle** — `max_instance_count` est épinglé à `1` et ne
   devrait **pas** être augmenté : le backend de stockage de Radicale n'est
   pas conçu pour un accès concurrentiel multi-instance. `min_instance_count` peut
   être augmenté à `1` via le flux **Update** de la
   plateforme RAD si vous souhaitez éviter les démarrages à froid.

3. **Mettez à jour le tag de version de l'application** via le flux
   **Update** de la plateforme RAD. Rappelez-vous : les tags du registre de
   conteneurs de Radicale n'ont **pas de préfixe `v`** (par
   exemple `3.7.7`, pas `v3.7.7`).

4. **Gérez les secrets et le PVC :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~radicale"
   kubectl get jobs -n "$NAMESPACE"
   kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs :**

   ```bash
   kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=100
   ```

2. **Monitoring** — ouvrez le tableau de bord GKE Workloads pour la charge de
   travail et examinez l'utilisation du CPU/mémoire et le nombre de réplicas.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod non sain / CrashLoopBackOff :** inspectez les événements et les logs
  du pod. La sonde de démarrage cible `/`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=200
  ```
- **`seed-default-collections` a réussi, mais aucun calendrier par défaut
  n'apparaît sur un déploiement basé sur PVC.** C'est **attendu, pas un
  bug**, lorsque `stateful_pvc_enabled = true`. Le job de pré-remplissage (un
  job de module commun Cloud-Run/GKE partagé) ne monte que le bucket GCS
  partagé `storage` — il ne peut pas s'attacher au PVC de type
  bloc `ReadWriteOnce` du StatefulSet, qui est déjà détenu par le pod en
  cours d'exécution. Les écritures du job atterrissent sans danger dans le
  bucket GCS inutilisé. Créez votre premier calendrier via `curl -X MKCOL`
  ou un vrai client CalDAV à la place (voir Tâche 2, étape 4) — cela
  fonctionne nativement sur GKE.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<seed-default-collections-job-name>
  ```
- **PVC bloqué `Pending` :** vérifiez la StorageClass et le quota
  régional. `stateful_pvc_storage_class` utilise par défaut `standard` (HDD)
  spécifiquement pour éviter le quota serré `SSD_TOTAL_GB` — si vous
  l'avez remplacé par `standard-rwo`/`premium-rwo` (SSD),
  vérifiez que vous disposez d'une marge de quota SSD.
  ```bash
  kubectl describe pvc -n "$NAMESPACE"
  ```
- **401 Non autorisé sur chaque requête, même avec les identifiants
  corrects :** vérifiez que vous avez récupéré le `ADMIN_PASSWORD`
  *actuel* de Secret Manager, et que vous utilisez `admin` (ou
  votre `ADMIN_USERNAME` configuré), et non une adresse e-mail.
- **403 / erreurs de permission :** vérifiez la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges spécifiques aux paramètres.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est
irréversible. Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer, utilisez **Purge** à la place (depuis la même boîte de
dialogue **Delete**) — cela supprime le déploiement des enregistrements de
RAD **sans** détruire les ressources cloud. Cela supprime tout ce que le
module a créé — la charge de travail Kubernetes, le Service, le PVC (si
utilisé), les secrets Secret Manager et le bucket GCS. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE (StatefulSet + PVC recommandé), un secret d'administrateur généré, et exécute le job de pré-remplissage de la collection par défaut |
| 2 — Accéder et vérifier | Manuel | Pod Ready 0 redémarrages ; récupérer le mot de passe administrateur généré ; créer/vérifier un calendrier (MKCOL fonctionne nativement sur GKE) |
| 3 — Opérer | Manuel | Inspecter le déploiement, comprendre la limite de mise à l'échelle `max=1`, mettre à jour la version, gérer le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de pod, de job de pré-remplissage/montage de PVC et d'authentification |
| 6 — Supprimer | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module, y compris le PVC et toutes les collections stockées |
