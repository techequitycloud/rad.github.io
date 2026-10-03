---
title: "Filebrowser sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Filebrowser sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Filebrowser_GKE.md @ 15fd4c7 sha256:cd2a630bab3f -->

# Filebrowser sur GKE Autopilot — Guide de Lab {#filebrowser-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

File Browser est un gestionnaire de fichiers web léger et open source écrit en Go — il
sert une arborescence de répertoires via HTTP pour la navigation, le téléchargement, l'édition et le partage
de fichiers, sans base de données externe. Ce lab vous guide à travers le cycle de vie opérationnel complet
du module **Filebrowser sur GKE Autopilot** sur Google Cloud : déployez-le,
accédez-y et vérifiez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes courants,
et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Filebrowser. Pour la liste complète des services provisionnés et
chaque entrée de configuration (organisée par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE) —
ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris la
  connexion administrateur par défaut.
- Effectuer des opérations de jour 2 — inspecter la charge de travail, choisir le stockage GCS FUSE ou PVC
  par blocs, et gérer l'entrée.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry,
  et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir
  Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` complétés.
- Rôle **Propriétaire du projet** (ou équivalent) IAM sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes affichées en tant que Propriétaire du projet, puis **Vérifier**) et de donner au compte de service de déploiement RAD le rôle **Propriétaire**. Un projet créé par RAD pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées ultérieurement avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Filebrowser (GKE)**
   depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur l'**Assistant Conversationnel** si vous détenez des crédits achetés ou êtes un partenaire ou un administrateur), définissez `project_id`,
   et examinez les entrées. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Gardez le PVC par blocs par défaut pour
   `/database` (`stateful_pvc_enabled = true`) : la base de données bbolt de Filebrowser a besoin
   d'un véritable stockage par blocs, pas de GCS FUSE. Cliquez sur **Deploy
   Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec des journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot et
   provisionne soit un bucket Cloud Storage (GCS FUSE, par défaut) soit un PVC par blocs
   (mode StatefulSet) monté à `/database`, puis construit l'image conteneur.
   Il n'y a pas d'instance Cloud SQL, pas de secret d'application Secret Manager, et pas de
   job d'initialisation de base de données — Filebrowser est autonome. Les premiers déploiements
   se terminent généralement en **10 à 15 minutes**.

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep filebrowser | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution (un déploiement à réplica unique, ou un
   StatefulSet lorsque `stateful_pvc_enabled = true`) et trouvez son adresse :

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get statefulset,pvc -n "$NS"     # only present when stateful_pvc_enabled = true
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le Service utilise par défaut `ClusterIP` ; sans domaine personnalisé ou IP statique
   réservée, accédez à la charge de travail dans le cluster ou via `kubectl port-forward`.

2. Confirmez que le service est sain. Filebrowser expose un point de terminaison de santé non authentifié
   qui renvoie `200` dès que le serveur écoute :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- http://localhost:80/health
   ```

3. Ouvrez la charge de travail dans un navigateur — via l'IP statique réservée/domaine personnalisé
   (`enable_custom_domain = true` est la valeur par défaut) ou un port-forward :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8080:80
   # then browse to http://localhost:8080
   ```

   Connectez-vous avec les identifiants par défaut **`admin` / `admin`**. Changez
   immédiatement le mot de passe (et idéalement le nom d'utilisateur) sous **Settings → Profile** —
   ces identifiants sont bien connus et donnent un contrôle total de l'arborescence des fichiers.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement/statefulset, pods et PVC :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"           # or: kubectl describe statefulset -n "$NS"
   ```

2. **Ne pas mettre à l'échelle au-delà d'un réplica.** `min_instance_count = max_instance_count = 1`
   est intentionnel — la base de données SQLite embarquée ne tolère pas les écritures concurrentes,
   même avec un verrouillage de fichier approprié d'un PVC par blocs. Laissez les deux à `1` dans la
   plateforme RAD ; un `kubectl scale` manuel serait de toute façon annulé lors du prochain apply.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. Épinglez `application_version` explicitement en production
   plutôt que de suivre `latest`.

4. **Changez le backend de stockage ou l'entrée** — basculez `stateful_pvc_enabled` (GCS
   FUSE vs. PVC par blocs ; Common désactive automatiquement GCS FUSE lorsque le PVC est activé, donc ne
   forcez pas les deux), ou ajustez `enable_custom_domain` / `application_domains`, puis
   appliquez via **Update**.

5. **Inspectez l'état persistant :**

   ```bash
   # GCS FUSE mode (default)
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/filebrowser.db

   # StatefulSet / block PVC mode
   kubectl get pvc -n "$NS"
   ```

   Ne supprimez jamais le bucket `/database` ou le PVC — cela détruirait tous les utilisateurs,
   les paramètres et les liens de partage.

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que les nombres de redémarrages (devraient rester à un seul pod stable).
   Si `uptime_check_config` est activé, examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions de Filebrowser.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent `/health` ; une erreur de montage ou une mauvaise image empêchera le
  pod de devenir prêt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Double montage à `/database` :** si vous avez modifié `stateful_pvc_enabled`, confirmez
  que `enable_gcs_storage_volume` a été correctement désactivé automatiquement par `Filebrowser_Common`
  (les deux montés en même temps sont une mauvaise configuration, pas un état pris en charge).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # check Volumes / Mounts section
  ```
- **État non persistant après les redémarrages :** confirmez que `stateful_pvc_mount_path`
  correspond au répertoire de `FB_DATABASE` (`/database` par défaut) ; une non-concordance stocke
  la base de données sur un disque éphémère et perd l'état au redémarrage.
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod` pour
  les problèmes de ressources ou de quota, et confirmez que le Service/Ingress a une IP attribuée si
  `enable_custom_domain = true`.
- **Erreurs de tirage d'image :** confirmez que l'image existe dans Artifact Registry et que le
  compte de service du nœud peut la tirer ; les images personnalisées/miroirs utilisent
  `imagePullPolicy = Always`, donc un cache local obsolète n'est pas la cause — vérifiez le
  registre et IAM à la place.
- **La connexion affiche `admin`/`admin` toujours actifs après le redéploiement :** attendu si aucune
  base de données SQLite antérieure n'existait à `/database`. Si une nouvelle invite admin/admin apparaît
  de manière inattendue sur un déploiement précédemment configuré, vérifiez si le bucket GCS
  ou le PVC a été remplacé/vidé.

Consultez la section *Pièges de configuration* du Guide de configuration pour les pièges spécifiques aux paramètres
(y compris la règle critique de conserver `max_instance_count = 1`, de ne jamais
supprimer le volume `/database`, et de laisser Common gérer l'exclusivité GCS-FUSE/PVC).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez **Purge** à la place (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et l'espace de noms, le bucket GCS `/database` ou le PVC (y compris la base de données SQLite embarquée — ceci est destructeur et irrécupérable), et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Artifact Registry partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE et le stockage `/database` (GCS FUSE ou PVC par blocs) ; pas de Cloud SQL, pas de job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; se connecter avec les identifiants `admin`/`admin` et changer le mot de passe immédiatement |
| 3 — Opérer | Manuel | Inspecter la charge de travail, maintenir les réplicas à 1, mettre à jour la version, changer le backend de stockage/l'entrée, inspecter l'état persistant |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage, de planification et de tirage d'image |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime la charge de travail et le bucket `/database` ou le PVC (destructeur) |
