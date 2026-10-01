---
title: "Cal.com sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Cal.com sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CalCom_GKE.md @ 3055034 sha256:38ddb35fe363 -->

# Cal.com sur GKE Autopilot — Guide de lab {#calcom-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Cal.com est une plateforme de planification de rendez-vous open source — l'alternative auto-hébergée à Calendly — construite avec Next.js et Prisma sur PostgreSQL. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Cal.com on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Cal.com. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Accéder à la charge de travail en cours d'exécution, la vérifier et terminer la prise en main initiale (onboarding) de Cal.com.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable : la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Cal.com (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` générés automatiquement, ainsi que le
   mot de passe de la base de données), construit/copie l'image Cal.com et exécute une
   tâche ponctuelle `db-init` qui crée la base vide et le rôle. **Aucun bucket GCS n'est
   créé** — Cal.com conserve tout son état dans PostgreSQL. La tâche ne crée pas le
   schéma de l'application ; Cal.com exécute `prisma migrate deploy` à chaque démarrage,
   de sorte que le schéma est créé au premier démarrage du pod. Un premier déploiement
   prend environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et repérez le namespace à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep calcom | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est sain. Le chemin de santé de Cal.com est `/`, qui renvoie
   HTTP 200 une fois que l'application a fini d'exécuter ses migrations Prisma au
   premier démarrage — le schéma est créé **au démarrage**, et non par la tâche
   d'initialisation ; prévoyez donc plusieurs minutes sur un nouveau déploiement (la
   fenêtre de la sonde de démarrage est généreuse — jusqu'à ~15 minutes — précisément
   pour cette raison) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et terminez l'onboarding de
   Cal.com pour créer le compte administrateur/propriétaire initial, puis connectez au
   moins un calendrier. **Renforcement à effectuer immédiatement :** Cal.com
   auto-hébergé autorise par défaut l'inscription en libre-service — restreignez-la (ou
   placez le service derrière IAP) si l'instance ne doit pas être publique.

4. **Rigueur sur l'URL :** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` prennent par
   défaut l'URL du cluster à l'exécution. Avant de partager des liens de réservation
   (ou dès qu'un domaine personnalisé est attribué), définissez `webapp_url` sur
   l'adresse IP du LoadBalancer ou l'adresse du domaine personnalisé et appliquez-la via
   **Update** — cette URL est intégrée dans chaque lien de réservation et chaque lien
   OAuth ; une valeur erronée ou absente les rend donc inutilisables.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant
   sur **Update** sur la page de détails du déploiement — le module gère la
   spécification de la charge de travail ; la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification
   manuelle serait annulée lors de l'application suivante). Cal.com est sans état
   (`workload_type = Deployment`) ; l'affinité de session (`ClientIP`) est définie par
   défaut pour maintenir les requêtes d'un client sur le même pod. Activer
   `enable_redis` nécessite soit `redis_host`, soit `enable_nfs = true` pour le point de
   terminaison Redis co-localisé sur le NFS.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite/copiée et une mise à jour progressive remplace les pods, en appliquant
   les éventuelles migrations Prisma en attente à leur premier démarrage.

4. **Gérez les secrets et les tâches** — et sachez quels secrets sont immuables :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~calcom"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   `CALENDSO_ENCRYPTION_KEY` chiffre les identifiants de calendrier/OAuth stockés et
   `NEXTAUTH_SECRET` signe les sessions — **ne faites jamais tourner l'un ou l'autre
   après le premier démarrage** en dehors d'une fenêtre de maintenance planifiée (la
   rotation rend orphelines toutes les intégrations de calendrier connectées ou
   déconnecte tous les utilisateurs, respectivement).

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. calcomdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^calcom" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et les
   métriques de requêtes. Le module peut provisionner un **test de disponibilité**
   (uptime check) sur `/` (lorsqu'il est activé) ; examinez Monitoring
   → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Cal.com à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez d'abord les événements et les
  journaux — la sonde de démarrage cible `/` et accorde une fenêtre généreuse aux
  migrations Prisma du premier démarrage :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Plantage OOM au démarrage :** `memory_limit` doit être **≥ 2 GiB** — en dessous,
  Next.js 16 plante par manque de mémoire et le pod ne devient jamais Ready.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL
  (PostgreSQL 15) est `RUNNABLE`, que le secret du mot de passe de la base a bien été
  matérialisé dans le namespace et que `enable_cloudsql_volume = true` (le sidecar
  Auth Proxy fournit à Cal.com son point de terminaison PostgreSQL `127.0.0.1` — le
  désactiver avec une véritable base de données est bloqué par une vérification au
  moment du plan).
- **Échec de la tâche d'initialisation :** inspectez la tâche et les journaux de son pod
  (elle crée uniquement la base/le rôle vides — elle ne construit pas le schéma) :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente / pas d'adresse IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quota, et
  vérifiez que le Service LoadBalancer s'est vu attribuer une adresse IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.
- **Liens de réservation/OAuth erronés ou cassés :** vérifiez que `webapp_url` (ou la
  valeur par défaut injectée à l'exécution) pointe vers l'adresse externe réelle — la
  valeur par défaut de l'image, `localhost:3000`, produit des liens cassés.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service de la
  charge de travail ; si IAP est activé, n'oubliez pas qu'il bloque *toutes* les
  requêtes non authentifiées — y compris les pages de réservation publiques et les
  intégrations (embeds).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire
tourner `CALENDSO_ENCRYPTION_KEY` ni `NEXTAUTH_SECRET` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, la base de données Cloud SQL (tous les utilisateurs, types d'événements
et réservations), les secrets Secret Manager (y compris `NEXTAUTH_SECRET` et
`CALENDSO_ENCRYPTION_KEY`) et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15) et les secrets, copie l'image et exécute l'initialisation de la base (pas de bucket GCS) |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; terminer l'onboarding, restreindre l'inscription ouverte, définir `webapp_url` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, respecter les secrets immuables, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'OOM, de base de données, de tâche d'initialisation, de planification, d'URL et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
