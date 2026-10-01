---
title: "BookStack sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez BookStack sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/BookStack_GKE.md @ 3055034 sha256:355591f98819 -->

# BookStack sur GKE — Guide de lab {#bookstack-on-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/BookStack_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

BookStack est une plateforme de wiki et de documentation libre et open source qui
organise les connaissances selon une hiérarchie simple : étagères → livres →
chapitres → pages. Elle repose sur Laravel (PHP) et s'appuie sur MySQL. Ce lab vous
fait parcourir tout le cycle de vie opérationnel du module **BookStack on GKE** sur
Google Cloud (GKE Autopilot) : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit BookStack. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/BookStack_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le cluster GKE Autopilot, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable : la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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
export NAMESPACE="<bookstack-namespace>"   # the module's Kubernetes namespace (from Task 1)
```

Récupérez les identifiants du cluster afin que `kubectl` cible le cluster Autopilot :

```bash
CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **BookStack (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez
   en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/BookStack_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE Autopilot (Deployment) et un
   Service `LoadBalancer` doté d'une adresse IP statique réservée, une base de données
   Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager (la clé Laravel `APP_KEY` et
   le mot de passe de la base de données), un bucket Cloud Storage (`gcs-<service>-data`),
   un volume NFS monté sur `/var/lib/bookstack` pour les images et pièces jointes
   téléversées ; elle copie l'image prédéfinie `linuxserver/bookstack` dans Artifact
   Registry et exécute une tâche ponctuelle d'initialisation de la base de données
   (`db-init`) qui crée la base, l'utilisateur applicatif et les droits. Sur GKE, la
   base de données est atteinte via un sidecar Cloud SQL Auth Proxy sur
   `127.0.0.1:3306`. L'image LinuxServer de BookStack exécute ensuite automatiquement
   `php artisan migrate` au premier démarrage, de sorte que le schéma est créé au
   lancement (il n'y a pas de tâche de migration distincte). Un premier déploiement
   prend environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres
   indépendants des noms (pour que les commandes fonctionnent quel que soit le
   suffixe du déploiement) :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $SERVICE_IP"
   export SERVICE_URL="http://$SERVICE_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et connecté à sa base de données. BookStack expose
   un point de terminaison de santé JSON non authentifié qui indique l'état de
   l'application, de la base de données, du cache et des sessions :

   ```bash
   curl -s "$SERVICE_URL/status"   # expect a JSON object with status fields
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur (l'adresse IP externe du LoadBalancer
   obtenue à la tâche 1). BookStack est livré avec un administrateur par défaut pour
   le premier lancement : **`admin@admin.com`** / **`password`**. Connectez-vous, puis
   changez **immédiatement** le mot de passe et l'adresse e-mail de l'administrateur
   sous **Settings → Users**. Une fois connecté, organisez votre contenu selon la
   hiérarchie de BookStack : les **étagères** contiennent des **livres**, les livres
   contiennent des **chapitres** et les chapitres contiennent des **pages**.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et ses pods** (chaque déploiement déploie un
   nouveau modèle de pod ; le Deployment bascule le trafic vers les pods sains) :

   ```bash
   kubectl get deployment,pods -n "$NAMESPACE"
   kubectl describe deployment -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification de la charge de travail ; la mise à l'échelle est
   donc une modification de configuration, et non une modification manuelle via
   `kubectl scale` (une modification manuelle serait annulée lors de l'application
   suivante). BookStack sur GKE utilise par défaut `min_instance_count = 1` et
   `max_instance_count = 1` ; GKE ne propose **pas de mise à l'échelle à zéro**, si bien
   qu'au moins une réplique s'exécute toujours. Comme les fichiers téléversés résident
   sur un volume NFS partagé, le module se déploie avec la stratégie `Recreate` et un
   seul pod — ne dépassez pas une réplique sans activer Redis (`enable_redis = true`)
   pour partager le cache et les sessions. Un PodDisruptionBudget peut protéger la
   charge de travail contre une éviction volontaire pendant la maintenance des nœuds,
   mais il est désactivé par défaut (`enable_pod_disruption_budget = false`) car le
   nombre de répliques par défaut est de 1.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update**. BookStack utilise l'image
   prédéfinie `linuxserver/bookstack` ; un changement de version récupère donc à
   nouveau le tag d'image copié et déploie un nouveau pod (aucun build personnalisé
   n'est exécuté). En production, fixez un tag précis (par ex. `version-v24.10`)
   plutôt que la valeur par défaut `latest`.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~bookstack"
   kubectl get jobs -n "$NAMESPACE"   # db-init job
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. bookstackdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^bookstack" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" -l app --tail=50
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes de la charge de
   travail et examinez le débit des requêtes, la latence, le nombre de pods et leurs
   redémarrages, ainsi que l'utilisation du CPU et de la mémoire. Le module provisionne
   également un **test de disponibilité** (uptime check) sur le point de terminaison du
   LoadBalancer ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et
   examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de BookStack à l'autre.

- **Pod en mauvaise santé / le service ne répond pas :** inspectez le pod et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables
  d'environnement et les secrets ont été résolus. La sonde de vivacité (liveness probe)
  cible `/status` avec une fenêtre généreuse au premier démarrage (délai initial de
  300s) afin que le `php artisan migrate` automatique de l'image puisse se terminer
  avant que la sonde n'échoue.
  ```bash
  kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
  kubectl describe pod -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app --tail=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret `DB_PASSWORD` existe, que le sidecar Cloud SQL Auth Proxy
  s'exécute sur `127.0.0.1:3306` et que la tâche `db-init` s'est terminée avec succès.
  BookStack se connecte à l'aide des variables d'environnement natives de Laravel
  `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`.
- **Échec de la tâche d'initialisation :** inspectez la tâche `db-init` et lisez les journaux du pod en échec :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```
- **Erreurs de copie / de récupération d'image :** vérifiez que l'image
  `linuxserver/bookstack` a bien été copiée dans Artifact Registry et que le tag
  récupéré existe (`kubectl describe pod` signale `ImagePullBackOff`).
- **Erreurs 403 / d'autorisation :** vérifiez le compte de service Workload Identity de
  la charge de travail et ses rôles IAM.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner
`APP_KEY` après le premier démarrage — cela rend indéchiffrables toutes les valeurs de
la base de données chiffrées auparavant). Le chemin par défaut du `liveness_probe`
livré avec la variante GKE est déjà le point de terminaison de santé de BookStack
(`/status`) — aucune surcharge n'est nécessaire.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail GKE et son namespace,
le LoadBalancer et l'adresse IP statique réservée, la base de données Cloud SQL, les
secrets Secret Manager (y compris `APP_KEY`), les buckets GCS et les images Artifact
Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le cluster GKE, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, le LoadBalancer, Cloud SQL (MySQL 8.0), les secrets, le bucket `gcs-<service>-data`, le NFS, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; connexion et modification des identifiants d'administrateur par défaut |
| 3 — Exploiter | Manuel | Inspecter les pods, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche d'initialisation, d'image et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
