---
title: "Seerr sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Seerr sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Seerr_GKE.md @ 3055034 sha256:8a0f5caeecd3 -->

# Seerr sur GKE Autopilot — Guide de lab {#seerr-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Seerr est la fusion, en 2026, de Jellyseerr et d'Overseerr — une interface de
demandes placée devant Jellyfin, Plex ou Emby, qui permet aux utilisateurs de
parcourir et de demander des titres qu'un administrateur approuve. Ce lab vous
fait parcourir tout le cycle de vie opérationnel du module **Seerr on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Seerr. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et terminer l'assistant de première configuration de Seerr.
- Confirmer que le correctif d'autorisations GCS-FUSE propre à GKE sur `/app/config` est en vigueur, et comprendre ce qui ne fonctionne pas sans lui.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- (Facultatif) Une instance Jellyfin, Plex ou Emby existante, ainsi que Sonarr/Radarr, à connecter pendant l'assistant de configuration de Seerr.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Seerr (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le Deployment Kubernetes (ou un StatefulSet, si vous
   avez choisi `stateful_pvc_enabled = true`), une base de données et un rôle Cloud SQL
   PostgreSQL 15, un bucket GCS `storage` monté sur `/app/config` via GCS
   FUSE, et un secret Secret Manager contenant le mot de passe de base de données
   généré. Il n'y a **aucun identifiant administrateur initial à récupérer** — le
   compte administrateur est créé via l'assistant de configuration propre à l'application. Un premier
   déploiement prend généralement **5 à 10 minutes**.

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep seerr | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est opérationnel et répond — 3/3 `Ready`, conformément à ce qui a été
   constaté lors du déploiement réel :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/api/v1/status" | head -c 300; echo
   # expect JSON: {"version":"...","commitTag":"...", ...}
   ```

   Vous pouvez aussi le vérifier directement depuis l'intérieur du pod :

   ```bash
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NAMESPACE" "$POD" -- curl -s http://localhost:5055/api/v1/status
   ```

2. Ouvrez `http://$EXTERNAL_IP` (ou votre domaine personnalisé, s'il est configuré) dans un
   navigateur et terminez l'**assistant de première configuration** de Seerr : connectez-vous, connectez
   votre serveur Jellyfin/Plex/Emby, puis Sonarr/Radarr.

3. **Vérifiez que le correctif d'autorisations GCS-FUSE de GKE a pris effet.** Si le pod est
   `Running` avec `0` redémarrage (vérifié ci-dessus), cette vérification est déjà réussie — une
   option de montage `uid`/`gid` absente ou mal configurée se manifesterait par un
   `CrashLoopBackOff` avec `EACCES: permission denied` dans les événements du pod,
   et non par un échec silencieux. Pour une confirmation positive, vérifiez que le répertoire
   de paramètres monté est accessible en écriture et rempli :

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /app/config
   # expect: settings.json, settings.old.json, db/, logs/ — all owned by uid 1000
   ```

4. **Vérifiez que Postgres est bien utilisé, et non le repli SQLite :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].env}' | grep -o '"name":"DB_TYPE"[^}]*'
   # expect: "name":"DB_TYPE","value":"postgres"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiements progressifs (rollout) :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # Deployment mode (default)
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"       # StatefulSet mode, if stateful_pvc_enabled = true
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** — la valeur par défaut du module est `min_instance_count = 1` /
   `max_instance_count = 5`. Si plusieurs pods risquent de modifier simultanément les paramètres de Seerr
   (configuration du serveur multimédia, curseurs de découverte, agents de notification),
   envisagez d'abaisser `max_instance_count` à `1` via le flux **Update** de la
   plateforme RAD — `settings.json` est un fichier modifiable unique,
   et non une base de données transactionnelle, si bien que des écritures concurrentes risquent d'entraîner une perte d'écriture.

3. **Mettez à jour l'étiquette de version de l'application** via le flux **Update**
   de la plateforme RAD. L'image étant réellement préconstruite (`ghcr.io/seerr-team/seerr`),
   aucune étape Cloud Build locale n'intervient.

4. **Gérez les secrets et le stockage :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~seerr"
   kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads de la charge de travail et
   examinez l'utilisation CPU/mémoire et le nombre de réplicas.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod en `CrashLoopBackOff` avec `EACCES: permission denied` sur
  `/app/config/logs/`.** Il s'agit du bogue d'UID/GID GCS-FUSE sur GKE que ce module
  corrige — si vous le rencontrez, vous exécutez très probablement un fork ou un remplacement
  personnalisé de `gcs_volumes` qui a contourné les `mount_options` de `Seerr_Common`
  (`uid=1000`, `gid=1000`, `file-mode=0664`, `dir-mode=0775`). Vérifiez :
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```

- **Les paramètres (connexion au serveur multimédia, curseurs, agents de notification) semblent
  se « réinitialiser » après un redéploiement ou un redémarrage.** C'est le symptôme classique du
  piège `DB_TYPE` — Seerr s'est rabattu sans avertissement sur une base de données SQLite propre
  à chaque pod. Vérifiez que `DB_TYPE=postgres` est bien injecté (voir la tâche 2, étape
  4).

- **Pod non opérationnel pour une autre raison :** inspectez les événements et les journaux du pod. La
  sonde de démarrage cible `/api/v1/status`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```

- **L'application démarre et réussit les contrôles de santé, mais l'historique des demandes est vide
  après une replanification du pod.** Vérifiez que l'instance Cloud SQL et le rôle de base de données
  existent, et que `enable_cloudsql_volume = true` :
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project="$PROJECT"
  ```

- **Erreurs 401/403 lors des appels à Sonarr/Radarr depuis le flux d'approbation des demandes
  de Seerr.** Problème d'identifiants au niveau applicatif, dans les paramètres propres à Seerr,
  et non un problème de plateforme ou de module — revérifiez la clé d'API et l'URL de base
  saisies dans la page Settings → Services de Seerr.

- **Erreurs 403 / d'autorisation provenant de GCP lui-même :** vérifiez la liaison Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. La suppression retire tout ce que le module a créé —
la charge de travail Kubernetes, le Service, le PVC (s'il est utilisé), la base de données
et le rôle Cloud SQL, les secrets Secret Manager et le bucket GCS de paramètres.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre, l'instance Cloud
SQL elle-même) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL PostgreSQL et un volume de paramètres GCS-FUSE |
| 2 — Accéder et vérifier | Manuel | Pod Ready, `0` redémarrage ; `/api/v1/status` renvoie du JSON ; vérifier le correctif d'autorisations GCS-FUSE et `DB_TYPE=postgres` |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, comprendre le compromis concurrence/écriture des paramètres, mettre à jour la version, gérer le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'autorisations GCS-FUSE, de repli DB_TYPE et de santé des pods |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le stockage et la base de données |
