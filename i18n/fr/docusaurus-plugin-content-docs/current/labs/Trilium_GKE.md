---
title: "Trilium sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Trilium sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Trilium_GKE.md @ 15fd4c7 sha256:390ead8a5c0e -->

# Trilium sur GKE Autopilot — Guide de Lab {#trilium-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 60 minutes

Trilium Notes (le fork TriliumNext activement maintenu) est une application de
prise de notes hiérarchique et auto-hébergée avec une base de données SQLite
intégrée. Ce lab vous guide à travers le cycle de vie opérationnel complet du
module **Trilium sur GKE Autopilot** sur Google Cloud : le déployer, y accéder
et le vérifier, le faire fonctionner au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Trilium. Pour la
liste complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE) — ce lab
ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE, découvrir l'espace de noms et confirmer que le
  pod est en cours d'exécution.
- Accéder à l'application, vérifier son point de terminaison de santé et
  effectuer l'étape "Définir le mot de passe" de la première exécution.
- Effectuer les opérations de jour 2 — inspecter la charge de travail, choisir
  entre le stockage GCS FUSE et le stockage block-PVC, et mettre à jour la
  version.
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
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login`
  terminés.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécuter les
  commandes affichées en tant que Propriétaire de projet, puis **Vérifier**)
  et de donner le rôle de **Propriétaire** au compte de service de déploiement
  RAD. Un projet créé par RAD pour vous n'a besoin d'aucune de ces étapes.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Mettre à jour** sur la page du déploiement après avoir
  coché **Activer le mode avancé**, ce qui nécessite un solde de crédits
  couvrant le coût de build estimé de la mise à jour (les mises à jour n'ont
  jamais de frais de module). Dans un environnement de lab, seul un
  administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise
:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la
   navigation supérieure de la plateforme RAD, ouvrez **Trilium (GKE)** depuis
   la liste **Modules de plateforme**, choisissez **Formulaire de
   configuration** sous *Comment souhaitez-vous configurer ce déploiement ?*
   (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez
   des crédits achetés ou si vous êtes un partenaire ou un administrateur),
   définissez `project_id`, et examinez les entrées. Ne configurez que ce dont
   vous avez besoin — le [Guide de
   configuration](https://docs.radmodules.dev/docs/modules/Trilium_GKE)
   documente chaque entrée par groupe, avec des valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec des journaux en temps réel.

2. La plateforme construit une image wrapper légère au-dessus de `triliumnext/notes`
   (mise en miroir dans Artifact Registry via Cloud Build) et planifie un seul
   pod sur le cluster GKE Autopilot (port 8080, 1 vCPU / 1 GiB par défaut),
   exposé via un service **LoadBalancer** externe par défaut. Le répertoire de
   données est un **PVC de bloc StatefulSet** monté à `/home/node/trilium-data` par
   défaut (`stateful_pvc_enabled =
   true`) ; le définir à `false` revient à un volume
   GCS FUSE. Il n'y a **pas d'instance Cloud SQL et pas de Redis** — le
   stockage de documents de Trilium est entièrement une base de données SQLite
   intégrée sur le volume monté. Les premiers déploiements prennent
   généralement **5 à 10 minutes** (la construction de l'image et la
   planification du pod dominent ; il n'y a pas de base de données à attendre).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep trilium | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est prêt et obtenez l'IP externe (le module utilise
   par défaut `service_type = LoadBalancer`, donc Trilium est accessible depuis un navigateur
   dès le départ) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "http://$EXTERNAL_IP"
   ```

2. Vérifiez le point de terminaison de santé — notez que ce n'est **pas** le
   chemin racine :

   ```bash
   curl -s "http://$EXTERNAL_IP/api/health-check"   # expect {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"   # expect 302 (redirect to setup)
   ```

   Si l'IP externe n'est pas encore prête, transférez le port directement vers
   le pod à la place :

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s http://localhost:8080/api/health-check
   ```

3. Ouvrez l'application dans un navigateur. Lors de la première visite, Trilium
   présente un écran **"Définir le mot de passe"** — il n'y a pas de
   crédentiel administrateur pré-rempli dans Secret Manager, contrairement aux
   applications avec un mot de passe auto-généré. Choisissez un mot de passe
   fort et terminez la configuration immédiatement, car l'IP du LoadBalancer
   est publique par défaut.

4. Vérifiez la persistance : créez une note, puis rechargez la page et
   confirmez qu'elle est toujours là — tout vit dans le volume monté, quel que
   soit le mode actif :

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~trilium"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — un déploiement par défaut, ou un
   StatefulSet lorsque `stateful_pvc_enabled = true` :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **Ne pas mettre à l'échelle.** Le module épingle délibérément `min_instance_count = max_instance_count = 1`
   : la base de données SQLite intégrée ne prend pas en charge l'écriture
   multi-utilisateurs — une deuxième réplique risque de corrompre `document.db`.
   Les modifications de ressources passent par **Mettre à jour** sur la page
   des détails du déploiement, et non par `kubectl edit` manuel (une édition
   manuelle serait annulée lors du prochain apply).

3. **Conservez le mode de stockage par défaut.** `stateful_pvc_enabled = true` (par défaut)
   monte un PVC de bloc par pod (`standard`/HDD, `20Gi` par défaut)
   pour un véritable verrouillage de fichiers POSIX sur la base de données
   SQLite intégrée, sélectionne automatiquement `StatefulSet` et définit
   `stateful_fs_group = 1000` afin que le volume soit accessible en écriture par Trilium
   (uid/gid 1000). Le changement de mode est un changement d'infrastructure à
   sens unique — planifiez une copie de données si vous devez migrer un
   répertoire de données existant entre les deux.

4. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version via **Mettre à jour** sur la page des détails du déploiement ; une
   nouvelle image est construite et une mise à jour progressive remplace le
   pod. Trilium applique ses propres migrations de schéma au démarrage.

5. **Il n'y a pas de session de base de données à ouvrir.** `database_type = "NONE"` —
   pas d'instance Cloud SQL, pas de job db-init, pas de mot de passe de base de
   données. Le seul état durable est le volume de données.

6. **Sauvegardez les notes :**

   ```bash
   # GCS FUSE mode:
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~trilium" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$DATA_BUCKET" "gs://<your-backup-bucket>/trilium-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/node/trilium-data ./trilium-backup-$(date +%F)
   ```

   Trilium dispose également de sa propre fonction d'exportation/sauvegarde
   intégrée à l'application (Menu → Exporter) pour une exportation `.zip`
   d'une seule note ou d'un arbre entier, indépendamment de la copie au niveau
   de l'infrastructure ci-dessus.

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Utilisez `statefulset/<name>` au lieu de `deploy/<name>` lorsque `stateful_pvc_enabled =
   true`.)
   Filtre de l'Explorateur de journaux : `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods ainsi que le nombre de
   redémarrages. Le **test de disponibilité** du module est désactivé par
   défaut (`uptime_check_config.enabled = false`) ; activez-le explicitement contre `/api/health-check` si vous
   souhaitez que Monitoring → Tests de disponibilité suive la disponibilité.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de Trilium.

- **Pod non prêt / en boucle de redémarrage sur la sonde :** vérifiez si un
  `startup_probe`/`liveness_probe` personnalisé a été pointé vers `/`
  au lieu du `/api/health-check` par défaut — `/` renvoie une redirection
  302, que la plupart des sondes traitent comme un échec.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe-failure details
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Application inaccessible depuis votre navigateur :** confirmez que le type
  de service est `LoadBalancer` (par défaut) et qu'une IP externe a bien été
  attribuée — cela peut prendre une minute ou deux après le premier
  déploiement :
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **PVC bloqué en attente (mode PVC de bloc) :** vérifiez le quota
  `DISKS_TOTAL_GB` vs `SSD_TOTAL_GB` — le module définit par défaut `stateful_pvc_storage_class`
  sur `"standard"` (HDD) spécifiquement pour éviter le quota SSD serré ; si
  vous l'avez remplacé par `standard-rwo`/`premium-rwo`, vérifiez plutôt le
  quota SSD.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Erreurs de permission du répertoire de données :** confirmez que `stateful_fs_group`
  est `1000` (par défaut) pour le mode PVC, ou que le `mount_options`
  GCS inclut `uid=1000,gid=1000` pour le mode GCS FUSE — Trilium s'exécute en tant
  qu'uid 1000/gid 1000 (l'utilisateur `node`).
- **L'écran "Définir le mot de passe" réapparaît à chaque visite :** la base
  de données SQLite ne persiste pas — confirmez que le montage de volume a
  survécu à un déploiement (vérifiez la présence d'un fichier `document.db`
  dans le bucket ou via `kubectl exec ... ls`).
- **Échec de la construction de l'image :** examinez l'historique de Cloud
  Build pour le journal de la construction échouée ; l'image est un wrapper
  léger au-dessus de `triliumnext/notes`.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les astuces spécifiques aux paramètres (y compris la règle critique de
terminer "Définir le mot de passe" immédiatement pour tout déploiement
accessible publiquement).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles qui entrent en conflit avec
l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de
dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de
RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — la charge de travail et
l'espace de noms Kubernetes, le stockage de données (le bucket GCS, ou le PVC
de bloc et son Persistent Disk sous-jacent) et les images Artifact Registry.
Copiez d'abord les notes (Tâche 3, étape 6) si vous souhaitez les conserver.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
Artifact Registry) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne le pod GKE et le stockage de données (GCS FUSE ou PVC de bloc ; pas de DB, pas de Redis) |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé passe sur `/api/health-check` ; terminez l'étape "Définir le mot de passe" de la première exécution ; vérifiez la persistance des notes |
| 3 — Opérer | Manuel | Inspectez la charge de travail, maintenez la mise à l'échelle à instance unique, choisissez GCS FUSE ou PVC de bloc, mettez à jour la version, sauvegardez les notes |
| 4 — Observer | Manuel | Interrogez Cloud Logging ; examinez les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquez les problèmes de chemin de sonde, d'entrée, de quota PVC, de permission et de persistance |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module, y compris le stockage de données |
