---
title: "Trilium sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Trilium sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Trilium_GKE.md @ 3055034 sha256:8c7cdff1a4e3 -->

# Trilium sur GKE Autopilot — Guide de lab {#trilium-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Trilium Notes (le fork TriliumNext, activement maintenu) est une application de prise de notes
hiérarchique et auto-hébergée, dotée d'une base de données SQLite intégrée. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Trilium on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Trilium. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, découvrir l'espace de noms et confirmer que le pod est en cours d'exécution.
- Accéder à l'application, vérifier son point de terminaison de santé et effectuer l'étape « Set Password » du premier lancement.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, choisir entre le stockage GCS FUSE et un PVC bloc, et mettre à jour la version.
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
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
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

1. Dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, ouvrez **Trilium (GKE)** depuis
   la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Ne configurez
   que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation légère au-dessus de `triliumnext/notes` (mise en miroir dans
   Artifact Registry via Cloud Build) et planifie un unique pod sur le cluster GKE
   Autopilot (port 8080, 1 vCPU / 1 GiB par défaut), exposé par défaut via un Service
   **LoadBalancer** externe. Le répertoire de données est un volume **GCS FUSE**
   monté sur `/home/node/trilium-data` ; définir `stateful_pvc_enabled = true`
   bascule plutôt vers un **StatefulSet avec un PVC bloc**. Il n'y a **ni instance
   Cloud SQL ni Redis** — le stockage de documents de Trilium est entièrement une base de données
   SQLite intégrée sur le volume monté. Les premiers déploiements prennent généralement **5–10
   minutes** (la construction de l'image et la planification du pod en représentent l'essentiel ; il n'y a aucune base de données à
   attendre).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep trilium | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est Ready et récupérez l'IP externe (le module utilise par défaut
   `service_type = LoadBalancer`, Trilium est donc accessible depuis un navigateur dès
   l'installation) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "http://$EXTERNAL_IP"
   ```

2. Vérifiez le point de terminaison de santé — notez qu'il ne s'agit **pas** du chemin racine :

   ```bash
   curl -s "http://$EXTERNAL_IP/api/health-check"   # expect {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"   # expect 302 (redirect to setup)
   ```

   Si l'IP externe n'est pas encore prête, effectuez plutôt une redirection de port directement vers le pod :

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s http://localhost:8080/api/health-check
   ```

3. Ouvrez l'application dans un navigateur. Lors de la première visite, Trilium affiche un écran **« Set Password »**
   — aucun identifiant administrateur prédéfini n'existe dans Secret Manager, contrairement aux applications
   dotées d'un mot de passe généré automatiquement. Choisissez un mot de passe robuste et terminez la configuration
   immédiatement, car l'IP du LoadBalancer est publique par défaut.

4. Vérifiez la persistance : créez une note, puis rechargez la page et confirmez qu'elle est toujours
   là — tout réside dans le volume monté, quel que soit le mode actif :

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~trilium"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — un Deployment par défaut, ou un StatefulSet lorsque
   `stateful_pvc_enabled = true` :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **Ne procédez pas à une mise à l'échelle horizontale.** Le module fixe délibérément
   `min_instance_count = max_instance_count = 1` : la base de données SQLite intégrée ne prend
   pas en charge plusieurs écrivains — une seconde réplique risque de corrompre `document.db`.
   Les modifications de ressources passent par **Update** sur la page de détails du déploiement, et non par un
   `kubectl edit` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Choisissez délibérément votre mode de stockage.** GCS FUSE (par défaut) est le plus simple et
   ne nécessite aucune planification de quota de PVC ; `stateful_pvc_enabled = true` monte un PVC bloc
   par pod (`standard`/HDD, `20Gi` par défaut) pour disposer d'un véritable verrouillage de fichiers POSIX sur la
   base de données SQLite intégrée, sélectionne automatiquement `StatefulSet` et définit
   `stateful_fs_group = 1000` afin que le volume soit accessible en écriture par Trilium (uid/gid 1000).
   Changer de mode est une modification d'infrastructure à sens unique — prévoyez une copie des données si vous devez
   migrer un répertoire de données existant d'un mode à l'autre.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace
   le pod. Trilium applique lui-même ses migrations de schéma au démarrage.

5. **Il n'y a aucune session de base de données à ouvrir.** `database_type = "NONE"` — pas d'instance Cloud
   SQL, pas de tâche db-init, pas de mot de passe de base de données. Le seul état durable est
   le volume de données.

6. **Sauvegardez les notes :**

   ```bash
   # GCS FUSE mode:
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~trilium" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$DATA_BUCKET" "gs://<your-backup-bucket>/trilium-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/node/trilium-data ./trilium-backup-$(date +%F)
   ```

   Trilium dispose également de sa propre fonctionnalité d'export/sauvegarde intégrée (Menu → Export) pour
   exporter une seule note ou l'arborescence entière au format `.zip`, indépendamment de la copie
   au niveau de l'infrastructure ci-dessus.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Utilisez `statefulset/<name>` au lieu de `deploy/<name>` lorsque `stateful_pvc_enabled =
   true`.) Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods ainsi que le nombre de redémarrages. Le **test de disponibilité** (uptime check) du module est désactivé
   par défaut (`uptime_check_config.enabled = false`) ; activez-le explicitement sur
   `/api/health-check` si vous souhaitez que Monitoring → Uptime checks suive la disponibilité.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Trilium.

- **Pod non Ready / redémarrant en boucle à cause de la sonde :** vérifiez si une sonde
  `startup_probe`/`liveness_probe` personnalisée a été dirigée vers `/` au lieu de la valeur par défaut
  `/api/health-check` — `/` renvoie une redirection 302, que la plupart des sondes considèrent comme un
  échec.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe-failure details
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Application inaccessible depuis votre navigateur :** vérifiez que le type du Service est
  `LoadBalancer` (la valeur par défaut) et qu'une IP externe a bien été attribuée —
  cela peut prendre une minute ou deux après le premier déploiement :
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **PVC bloqué en Pending (mode PVC bloc) :** vérifiez le quota `DISKS_TOTAL_GB` par rapport à
  `SSD_TOTAL_GB` — le module définit par défaut `stateful_pvc_storage_class` sur
  `"standard"` (HDD) précisément pour éviter le quota SSD restreint ; si vous l'avez remplacé
  par `standard-rwo`/`premium-rwo`, vérifiez plutôt le quota SSD.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Erreurs d'autorisation sur le répertoire de données :** vérifiez que `stateful_fs_group` vaut `1000`
  (valeur par défaut) en mode PVC, ou que les `mount_options` GCS incluent `uid=1000,gid=1000`
  en mode GCS FUSE — Trilium s'exécute avec l'uid 1000/gid 1000 (l'utilisateur `node`).
- **L'écran « Set Password » réapparaît à chaque visite :** la base de données SQLite n'est pas
  persistée — vérifiez que le montage du volume a survécu à un déploiement progressif (cherchez un fichier
  `document.db` dans le bucket ou via `kubectl exec ... ls`).
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec ;
  l'image est une encapsulation légère au-dessus de `triliumnext/notes`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de terminer « Set Password » immédiatement pour
tout déploiement accessible publiquement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes et
l'espace de noms, le stockage des données (le bucket GCS, ou le PVC bloc et son
Persistent Disk sous-jacent) et les images Artifact Registry. Copiez d'abord les notes (tâche 3,
étape 6) si vous souhaitez les conserver. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, Artifact Registry) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne le pod GKE et le stockage des données (GCS FUSE ou PVC bloc ; pas de base de données, pas de Redis) |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit sur `/api/health-check` ; effectuer l'étape « Set Password » du premier lancement ; vérifier la persistance des notes |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, conserver une mise à l'échelle à instance unique, choisir entre GCS FUSE et PVC bloc, mettre à jour la version, sauvegarder les notes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chemin de sonde, d'exposition (ingress), de quota de PVC, d'autorisations et de persistance |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le stockage des données |
