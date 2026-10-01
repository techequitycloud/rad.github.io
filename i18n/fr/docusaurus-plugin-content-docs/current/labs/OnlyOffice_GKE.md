---
title: "OnlyOffice sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer OnlyOffice sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OnlyOffice_GKE.md @ 3055034 sha256:5cf05a9fea39 -->

# OnlyOffice sur GKE Autopilot — Guide de lab {#onlyoffice-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ONLYOFFICE Document Server est une suite bureautique collaborative en ligne et open source pour la
coédition en temps réel de documents, de feuilles de calcul, de présentations et de PDF — une
alternative auto-hébergée à Google Docs / Microsoft Office Online. Elle n'est généralement pas
ouverte directement par les utilisateurs finaux : elle est intégrée par une application hôte (Nextcloud,
ownCloud, Seafile ou une intégration personnalisée) via son API et un secret JWT partagé. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **OnlyOffice on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit OnlyOffice. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au Document Server en cours d'exécution.
- Récupérer le secret JWT nécessaire à l'intégration d'une application hôte (Nextcloud, ownCloud, etc.).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, la
  VM NFS/Redis colocalisée, Artifact Registry et les comptes de service partagés dont dépend ce
  module). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible
  et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **OnlyOffice (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie une charge de travail StatefulSet dans le cluster GKE Autopilot
   (`stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`, avec un PVC en mode bloc
   `standard-rwo` de 20Gi par pod sur `/var/www/onlyoffice/Data`), provisionne une base de données
   Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (un
   `JWT_SECRET` de 48 caractères et le mot de passe de la base de données), monte le
   Filestore (NFS) partagé sur `/opt/onlyoffice/storage`, construit l'image du conteneur et
   exécute une tâche ponctuelle d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL en représente l'essentiel) ; le pod lui-même a ensuite besoin
   d'environ 10 minutes supplémentaires au maximum pour devenir Ready (un budget de sonde de démarrage généreux pour la pile
   intégrée client Postgres/client Redis/RabbitMQ/nginx/convertisseur gérée par
   `supervisord`).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep onlyoffice | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le Document Server est en bonne santé. `/healthcheck` ne renvoie `true` qu'une fois
   nginx et les services documentaires démarrés et la base de données joignable ; il est
   servi sans authentification :

   ```bash
   curl -s "http://${EXTERNAL_IP}/healthcheck"   # expect: true
   ```

3. OnlyOffice ne présente pas d'interface d'administration à configurer dans le navigateur — il est intégré par une
   application hôte. Récupérez le secret JWT généré automatiquement, avec lequel l'application
   hôte (Nextcloud, ownCloud, Seafile, une intégration personnalisée) doit être
   configurée à l'identique :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~onlyoffice AND name~jwt" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

   Ne renouvelez jamais ce secret une fois qu'une application hôte a été configurée avec lui —
   cela romprait la confiance entre le Document Server et chaque application connectée
   jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, les pods et les revendications de volumes persistants :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Chaque
   pod du StatefulSet dispose de son propre PVC indépendant de 20Gi — l'état d'édition et de session est
   partagé via Postgres et Redis, et non via le PVC ; augmenter le nombre de pods est donc sans risque tant
   que les deux restent joignables. `session_affinity = "ClientIP"` maintient un client
   sur le même pod pendant une session.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite (en figeant `latest` sur une
   `ONLYOFFICE_VERSION` fixe au moment du build) et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~onlyoffice"
   kubectl get jobs -n "$NS"          # db-init job
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. onlyofficedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^onlyoffice" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez la connexion Redis partagée** — Redis est obligatoire (coordination de l'état des sessions
   et de l'édition entre les pods) et utilise par défaut le Redis de la VM NFS colocalisée
   lorsque `redis_host` est laissé vide :

   ```bash
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'REDIS_SERVER|DB_|JWT_'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (la pile intégrée utilise par défaut 2 vCPU / 4Gi — surveillez les OOM
   au démarrage), le nombre de redémarrages et l'utilisation des PVC. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsque le point de terminaison est joignable publiquement) ; consultez Monitoring →
   Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OnlyOffice.

- **Pod non Ready / CrashLoopBackOff :** la sonde de démarrage accorde environ 10 minutes
  de marge au premier démarrage (`/healthcheck`, délai initial de 90 s, période de 15 s, 40
  échecs) — la pile intégrée client Postgres/client Redis/RabbitMQ/nginx/convertisseur
  est réellement lente à démarrer. Laissez-lui du temps avant de conclure à un échec, puis
  inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  sidecar Auth Proxy (`enable_cloudsql_volume = true`) s'exécute aux côtés du
  conteneur de l'application et que la tâche `db-init` s'est terminée.
- **Échec de la tâche d'initialisation :** inspectez la tâche et les journaux de son pod — elle ne fait que
  provisionner le rôle, la base de données et les droits ; le Document Server installe son propre
  schéma au premier démarrage :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Erreurs de connexion Redis / de session d'édition :** `enable_redis = false` est
  rejeté au moment du plan — Redis est obligatoire. Si `redis_host` a été laissé vide,
  vérifiez que la VM NFS colocalisée est `RUNNING` (`enable_nfs` doit alors valoir `true`)
  et qu'elle est joignable depuis le pod.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée (`reserve_static_ip = true` la maintient stable d'un redéploiement à l'autre).
- **Quota de PVC / SSD épuisé :** chaque pod du StatefulSet détient un PVC `standard-rwo` (SSD)
  de 20Gi qui survit à la mise à l'échelle à zéro ; une campagne étendue d'applications
  avec état peut épuiser le quota `SSD_TOTAL_GB` du projet. Définissez plutôt
  `stateful_pvc_storage_class = "standard"` (HDD) si nécessaire.
- **Échecs de l'intégration JWT :** vérifiez que la valeur du secret JWT correspond à celle
  configurée dans l'application hôte connectée (Nextcloud, ownCloud, etc.).
  Récupérez la valeur actuelle dans Secret Manager comme indiqué dans la tâche 2.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment les règles essentielles de ne jamais renouveler `JWT_SECRET` une fois que des
intégrations existent, et de ne jamais modifier `database_type`, `enable_redis` ni le nom ou l'utilisateur de la base
de données de l'application après le premier déploiement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, ses PVC en mode bloc, la base de données Cloud SQL, les secrets Secret Manager et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, la VM NFS/Redis, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail StatefulSet GKE (PVC en mode bloc + NFS), Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; `/healthcheck` renvoie `true` ; récupérer le secret JWT pour l'intégration de l'application hôte |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage/Redis, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche d'initialisation, de Redis, de PVC/quota et d'intégration JWT |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
