---
title: "Filebrowser sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Filebrowser sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Filebrowser_GKE.md @ 3055034 sha256:1cbffb1df702 -->

# Filebrowser sur GKE Autopilot — Guide de lab {#filebrowser-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

File Browser est un gestionnaire de fichiers web léger et open source écrit en Go : il
sert une arborescence de répertoires via HTTP pour parcourir, téléverser, modifier et partager
des fichiers, sans base de données externe. Ce lab vous fait parcourir l’intégralité du cycle
de vie opérationnel du module **Filebrowser on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants,
puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Filebrowser. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE) :
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d’exécution, y compris
  avec l’identifiant administrateur par défaut.
- Effectuer les opérations du jour 2 : inspecter la charge de travail, choisir entre GCS FUSE et un PVC
  de stockage en mode bloc, et gérer l’entrée (ingress).
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Filebrowser (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Décidez dès le départ si vous voulez
   le montage GCS FUSE par défaut pour `/database` ou un PVC en mode bloc
   (`stateful_pvc_enabled = true`) pour un verrouillage correct des fichiers SQLite. Cliquez sur **Deploy
   Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot et
   provisionne soit un bucket Cloud Storage (GCS FUSE, par défaut), soit un PVC en mode bloc
   (mode StatefulSet) monté sur `/database`, puis construit l’image de conteneur.
   Il n’y a ni instance Cloud SQL, ni secret applicatif dans Secret Manager, ni
   job d’initialisation de base de données : Filebrowser est autonome. Les premiers déploiements
   se terminent généralement en **10–15 minutes**.

3. Connectez-vous au cluster et découvrez l’espace de noms à l’aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep filebrowser | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d’exécution (un Deployment à réplique unique, ou un
   StatefulSet lorsque `stateful_pvc_enabled = true`) et trouvez son adresse :

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get statefulset,pvc -n "$NS"     # only present when stateful_pvc_enabled = true
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le Service est de type `ClusterIP` par défaut ; sans domaine personnalisé ni adresse IP
   statique réservée, accédez à la charge de travail depuis le cluster ou via `kubectl port-forward`.

2. Confirmez que le service est sain. Filebrowser expose un point de terminaison de santé
   non authentifié qui renvoie `200` dès que le serveur écoute :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- http://localhost:80/health
   ```

3. Ouvrez la charge de travail dans un navigateur, via l’adresse IP statique réservée ou le domaine personnalisé
   (`enable_custom_domain = true` est la valeur par défaut) ou via un port-forward :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8080:80
   # then browse to http://localhost:8080
   ```

   Connectez-vous avec l’identifiant par défaut initialisé **`admin` / `admin`**. Changez
   immédiatement le mot de passe (et idéalement le nom d’utilisateur) sous **Settings → Profile** :
   cet identifiant est bien connu et donne le contrôle total de l’arborescence de fichiers.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** : Deployment/StatefulSet, pods et PVC :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"           # or: kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas une réplique.** `min_instance_count = max_instance_count = 1`
   est intentionnel : la base de données SQLite embarquée ne tolère pas plusieurs rédacteurs
   simultanés, même avec le verrouillage de fichiers correct d’un PVC en mode bloc. Laissez les deux à `1` dans la
   plateforme RAD ; un `kubectl scale` manuel serait de toute façon annulé lors de l’application
   suivante.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version dans la plateforme
   RAD et en l’appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. En production, fixez explicitement `application_version`
   plutôt que de suivre `latest`.

4. **Changez de backend de stockage ou d’entrée** : basculez `stateful_pvc_enabled` (GCS
   FUSE ou PVC en mode bloc ; Common désactive automatiquement GCS FUSE lorsque le PVC est activé, n’imposez donc
   pas les deux), ou ajustez `enable_custom_domain` / `application_domains`, puis
   appliquez via **Update**.

5. **Inspectez l’état persistant :**

   ```bash
   # GCS FUSE mode (default)
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/filebrowser.db

   # StatefulSet / block PVC mode
   kubectl get pvc -n "$NS"
   ```

   Ne supprimez jamais le bucket ou le PVC de `/database` : cela détruit tous les utilisateurs,
   les paramètres et les liens de partage.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** : depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** : ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur et de
   la mémoire des pods ainsi que le nombre de redémarrages (il doit rester un seul pod stable).
   Si `uptime_check_config` est activé, consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Filebrowser à l’autre.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Les sondes de démarrage et
  de vivacité (liveness) ciblent `/health` ; un échec de montage ou une image défectueuse empêchera le
  pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Double montage sur `/database` :** si vous avez modifié `stateful_pvc_enabled`, vérifiez que
  `enable_gcs_storage_volume` a bien été désactivé automatiquement par `Filebrowser_Common`
  (avoir les deux montés en même temps est une erreur de configuration, pas un état pris en charge).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # check Volumes / Mounts section
  ```
- **État non conservé entre les redémarrages :** vérifiez que `stateful_pvc_mount_path`
  correspond au répertoire de `FB_DATABASE` (`/database` par défaut) ; en cas de divergence, la base
  est stockée sur un disque éphémère et l’état est perdu au redémarrage.
- **Pod en attente (Pending) / pas d’adresse IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quota, et vérifiez que le Service/l’Ingress dispose d’une adresse IP attribuée si
  `enable_custom_domain = true`.
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer ; les images personnalisées/en miroir utilisent
  `imagePullPolicy = Always`, un cache local obsolète n’est donc pas en cause : vérifiez plutôt le
  registre et IAM.
- **La connexion `admin`/`admin` est toujours active après un redéploiement :** c’est attendu si aucune
  base SQLite n’existait auparavant sur `/database`. Si une invite admin/admin vierge apparaît
  de manière inattendue sur un déploiement déjà configuré, vérifiez si le bucket GCS
  ou le PVC a été remplacé ou vidé.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle de conserver `max_instance_count = 1`, de ne jamais
supprimer le volume `/database` et de laisser Common gérer l’exclusivité GCS-FUSE/PVC).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : la charge de travail Kubernetes et son espace de noms, le bucket GCS ou le PVC de `/database` (y compris la base de données SQLite embarquée ; cette opération est destructrice et irrécupérable) et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, l’Artifact Registry partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE et le stockage `/database` (GCS FUSE ou PVC en mode bloc) ; ni Cloud SQL, ni job d’initialisation |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; connexion avec l’identifiant initialisé `admin`/`admin` et changement immédiat du mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, garder 1 réplique, mettre à jour la version, changer de backend de stockage ou d’entrée, inspecter l’état persistant |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage, de planification et de récupération d’image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime la charge de travail et le bucket ou le PVC de `/database` (destructif) |
