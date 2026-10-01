---
title: "Miniflux sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Miniflux sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Miniflux_GKE.md @ 3055034 sha256:4256f1e84599 -->

# Miniflux sur GKE Autopilot — Guide de lab {#miniflux-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un unique binaire
Go statique qui stocke tout son état dans PostgreSQL. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Miniflux on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Miniflux. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, trouver l'espace de noms et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les jobs.
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
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Miniflux (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Miniflux_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un Deployment
   sans état (Miniflux conserve tout son état dans PostgreSQL, aucun PVC n'est donc nécessaire),
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (le `ADMIN_PASSWORD` généré automatiquement et le mot de passe de la base), construit
   l'image de conteneur et exécute un job ponctuel d'initialisation de la base qui crée la
   base de données/le rôle `miniflux` et installe l'extension `hstore`. Les premiers déploiements prennent
   environ **20 à 35 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep miniflux | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. Les sondes de démarrage et de vivacité de Miniflux ciblent par défaut
   le chemin racine `/` (la page de connexion, un `200 OK` sans authentification) ; un point de terminaison
   `/healthcheck` dédié est également disponible sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Récupérez dans Secret Manager le mot de passe initial du propriétaire pré-créé (le compte est
   créé au premier démarrage — il n'existe pas d'inscription en libre-service) :

   ```bash
   gcloud secrets versions access latest \
     --secret=secret-<resource-prefix>-miniflux-admin-password --project="$PROJECT"
   ```

   Remplacez `<resource-prefix>` par le nom réel du secret obtenu avec
   `gcloud secrets list --project="$PROJECT" --filter="name~miniflux"`.

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous avec le nom d'utilisateur `admin` (ou
   le `ADMIN_USERNAME` que vous avez configuré) et le mot de passe récupéré. Si vous activez un
   domaine personnalisé, définissez `BASE_URL` (via `environment_variables`) sur cette URL afin que
   Miniflux génère des liens absolus corrects.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Conservez `min_instance_count = 1` (la valeur par défaut et le
   minimum GKE) afin que l'interrogateur de flux intégré au processus continue d'actualiser les flux ; chaque réplique supplémentaire
   interroge les flux indépendamment, car aucune file partagée ne les coordonne. L'affinité
   de session (`ClientIP`) est définie par défaut pour maintenir un client sur un même pod et garantir
   une session d'interface cohérente.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods. Miniflux applique lui-même ses migrations de schéma au démarrage, aucune
   étape de migration distincte n'est donc nécessaire — prévoyez un délai supplémentaire au premier démarrage après une
   mise à niveau.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~miniflux"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. minifluxdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^miniflux" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^miniflux" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Au démarrage, le point d'entrée journalise son
   mode de connexion `DATABASE_URL` — utile pour diagnostiquer la connectivité
   à la base :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Miniflux.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde
  de vivacité cible `/` ; un échec de connexion à PostgreSQL (via le sidecar Cloud SQL Auth
  Proxy) empêche le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l'espace de noms, que `enable_cloudsql_volume =
  true` (le sidecar proxy est requis sur GKE) et que le job `db-init` s'est terminé —
  il crée la base de données/le rôle `miniflux` et l'extension `hstore` appartenant au
  rôle de l'application, puis signale au sidecar de s'arrêter.
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Les flux ne s'actualisent pas :** l'interrogateur de flux s'exécute dans le processus selon
  `POLLING_FREQUENCY` dans chaque pod. Vérifiez que `min_instance_count >= 1` — GKE
  ne réduit pas à zéro, mais une charge de travail sans aucune réplique saine arrête complètement
  l'interrogation.
- **Impossible de se connecter / mot de passe administrateur perdu :** relisez le secret `ADMIN_PASSWORD`
  (voir la tâche 2) ; `CREATE_ADMIN` ne crée le compte qu'au premier démarrage et est
  idempotent lors des démarrages suivants.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment l'immuabilité de `application_database_name`/
`application_database_user` après le premier déploiement et l'obligation d'utiliser des unités binaires pour
`quota_memory_requests`/`quota_memory_limits`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS, tout
montage NFS Filestore et les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15) et les secrets, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; récupérer le mot de passe administrateur pré-créé et se connecter |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/les jobs, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, d'interrogateur de flux, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
