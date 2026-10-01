---
title: "Focalboard sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Focalboard sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Focalboard_GKE.md @ 3055034 sha256:316c0245a470 -->

# Focalboard sur GKE Autopilot — Guide de lab {#focalboard-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Focalboard_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Focalboard est un outil open source et auto-hébergé de gestion de projet et de tableaux Kanban
issu de Mattermost : une alternative à Trello, Asana ou aux tableaux Notion, avec plusieurs vues de tableau
(kanban, tableau, galerie, calendrier) pour organiser des tâches sous forme de tableaux et de cartes. Ce lab
vous fait parcourir l’intégralité du cycle de vie opérationnel du module **Focalboard on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer,
diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Focalboard. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Focalboard_GKE) : ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d’exécution.
- Effectuer les opérations du jour 2 : inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable : la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration, y compris les paramètres de mise à l’échelle et de version des tâches du jour 2, se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Focalboard (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Focalboard_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d’un
   **StatefulSet** (la valeur par défaut du module : `stateful_pvc_enabled = true` résout automatiquement
   `workload_type`), ce qui donne à l’unique pod un PVC en mode bloc de `10Gi` propre au pod pour les
   pièces jointes des tableaux. Elle provisionne également une base de données Cloud SQL (PostgreSQL 15) avec ses
   secrets Secret Manager (`FOCALBOARD_ADMIN_PASSWORD` et le mot de passe de la base de données), une
   instance Cloud Filestore (NFS) (activée par défaut, bien que ce ne soit pas le chemin utilisé par Focalboard pour ses propres
   pièces jointes ; voir la tâche 5), un bucket Cloud Storage, construit l’image de conteneur
   (une fine surcouche `FROM mattermost/focalboard`) et exécute un job ponctuel
   d’initialisation de la base de données qui crée le rôle applicatif et la base. Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Connectez-vous au cluster et découvrez l’espace de noms à l’aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep focalboard | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d’exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Focalboard ne dispose pas d’API de santé dédiée : les
   sondes de démarrage, de vivacité (liveness) et de disponibilité (readiness) ciblent toutes la racine de l’interface web, qui ne renvoie
   200 qu’une fois que le serveur Go a ouvert son port et terminé ses propres migrations de schéma
   sur Cloud SQL (joint via le sidecar Auth Proxy sur
   `127.0.0.1:5432`) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Focalboard fonctionne en `authMode = native`.
   Un secret `FOCALBOARD_ADMIN_PASSWORD` est généré automatiquement, mais il **n’est pas confirmé**
   que le binaire d’origine l’utilise pour initialiser une connexion : essayez d’abord de le
   récupérer :

   ```bash
   gcloud secrets versions access latest --secret=<admin-password-secret-name> --project="$PROJECT"
   ```

   Si cet identifiant ne fonctionne avec aucun compte préexistant, inscrivez plutôt le
   premier compte via l’interface (nom, adresse e-mail, mot de passe) : il devient automatiquement
   le propriétaire de l’espace de travail. Les tableaux partagés publics sont activés par défaut.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** : StatefulSet, pods et PVC propre à chaque pod :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l’échelle avec prudence.** C’est en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur
   **Update** sur la page de détails du déploiement que le module reste propriétaire de la spécification de la charge de travail
   (un `kubectl scale` manuel serait annulé lors de l’application suivante), mais contrairement aux applications
   dont l’état réside entièrement dans une base de données partagée, les **pièces jointes** des tableaux de Focalboard
   résident sur un PVC en mode bloc propre à chaque pod, et non sur un système de fichiers partagé. Porter
   `max_instance_count` au-delà de `1` répartit silencieusement les pièces jointes téléversées entre des
   volumes isolés, sans aucune erreur ; conservez la valeur `1` sauf si vous revoyez l’architecture du stockage
   (par exemple en déplaçant les pièces jointes vers un bucket partagé). L’affinité de session (`ClientIP`) est définie
   par défaut pour que les requêtes d’un client restent sur le même pod.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version dans la plateforme
   RAD et en l’appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. Focalboard applique ses propres migrations de schéma à chaque démarrage en tant
   qu’utilisateur de base de données de l’application ; la mise à niveau de la version applique donc automatiquement les
   modifications de schéma : il n’y a pas de job de migration distinct.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets,jobs -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~focalboard"
   kubectl get pvc -n "$NS"                # per-pod attachment PVC(s)
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. focalboarddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^focalboard" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** : depuis `kubectl` ou l’explorateur de journaux (Logs Explorer). Le point d’entrée affiche au démarrage
   l’hôte, le nom, l’utilisateur et le `sslmode` de la base tels qu’ils ont été résolus (sur GKE, il s’agit toujours du cas
   de la boucle locale, en clair jusqu’au sidecar) :

   ```bash
   kubectl logs -n "$NS" -l app=focalboard --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** : ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur et de
   la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le test de disponibilité du module
   (`uptime_check_config`) est **désactivé par défaut** ; activez-le et vérifiez qu’il passe
   au vert sous Monitoring → Uptime checks si vous avez besoin d’une surveillance synthétique de la
   disponibilité.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Focalboard à l’autre.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de démarrage
  cible `/` et accorde jusqu’à **~8.5 minutes** au premier démarrage (délai initial de 60s, période de 15s,
  30 tentatives) ; un échec de connexion à PostgreSQL via le sidecar Auth Proxy
  empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l’espace de noms via le pilote Secret Store CSI,
  et que le job `db-init` s’est terminé (il signale également au sidecar Auth Proxy de s’arrêter
  via `quitquitquit` afin que le pod du job se termine).
- **Échec du job `db-init` :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Les téléversements de pièces jointes échouent ou « disparaissent » d’une requête à l’autre :** vérifiez que vous examinez
  le bon volume. Focalboard écrit les pièces jointes sur le PVC en mode bloc monté sur
  `stateful_pvc_mount_path` (par défaut `/data`), et **non** sur le montage Filestore (NFS) de
  `nfs_mount_path` (`/opt/focalboard/storage`), qui est provisionné par défaut mais
  inutilisé par le chemin de stockage propre à Focalboard. Si vous avez dépassé une réplique, chaque pod
  dispose de son propre PVC isolé : une pièce jointe téléversée via un pod est invisible depuis
  un autre (voir la tâche 3).
- **Pod en attente (Pending) / pas d’adresse IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de provisionnement de PVC (y compris de quota SSD : la valeur par défaut
  `stateful_pvc_storage_class = standard-rwo` consomme le quota plus restreint `SSD_TOTAL_GB`),
  et vérifiez que le Service LoadBalancer dispose d’une adresse IP attribuée.
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la raison pour laquelle `database_type` est verrouillé sur PostgreSQL par une précondition
au moment du plan, et pourquoi `application_database_name`/`application_database_user` sont
de fait immuables après le premier déploiement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : le StatefulSet Kubernetes
et son espace de noms (y compris son PVC propre à chaque pod), la base de données Cloud SQL, l’instance Filestore (NFS),
les secrets Secret Manager, les buckets GCS et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet GKE (PVC propre à chaque pod), Cloud SQL (PostgreSQL 15), Filestore, les secrets, le bucket de stockage, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé (`/`) réussit ; essai du secret du mot de passe administrateur, sinon inscription du premier compte dans l’interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail/le PVC, mettre à l’échelle avec prudence (stockage propre à chaque pod), mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d’initialisation, de chemin de stockage, de planification et de récupération d’image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
