---
title: "Cloudreve sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Cloudreve sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Cloudreve_GKE.md @ 3055034 sha256:4b5a18f20769 -->

# Cloudreve sur GKE Autopilot — Guide de lab {#cloudreve-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Cloudreve est une plateforme open source et auto-hébergée de stockage cloud et
de partage de fichiers, écrite en Go, dotée d'une interface web pour téléverser,
organiser, prévisualiser et partager des fichiers. Ce lab vous guide à travers
le cycle de vie opérationnel complet du module **Cloudreve on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Cloudreve. Pour la
liste complète des services provisionnés et de chaque paramètre de
configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution, y compris récupérer le mot de passe administrateur du premier
  démarrage dans les journaux du pod.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et son
  Persistent Volume en mode bloc, mettre à jour et comprendre le compromis lié
  à la classe de stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Cloudreve
   (GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous
   forme de **StatefulSet** (`stateful_pvc_enabled = true` par défaut détermine
   automatiquement `workload_type` — inutile de définir les deux), provisionne
   un **Persistent Volume** en mode bloc de 20Gi monté sur `/cloudreve` (la base
   de données SQLite intégrée de Cloudreve et les fichiers téléversés s'y
   trouvent — un montage GCS FUSE casserait le verrouillage de fichiers de
   SQLite, le périphérique en mode bloc est donc obligatoire et non
   facultatif), et construit l'image de conteneur personnalisée (un Dockerfile
   multi-étapes qui déplace le binaire `cloudreve` vers `/usr/local/bin/cloudreve`
   afin que le montage du PVC ne puisse pas le masquer). **Aucune instance Cloud
   SQL ni aucun secret Secret Manager** n'est créé — Cloudreve génère lui-même
   son mot de passe administrateur au premier démarrage. Les premiers
   déploiements prennent généralement **10–20 minutes** (essentiellement pour
   le build de l'image et le provisionnement du PVC).

3. Connectez-vous au cluster et repérez le namespace avec des filtres
   indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep cloudreve | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulsets,pods,svc,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe.
   Par défaut, `enable_custom_domain = true` et `reserve_static_ip = true` ;
   l'accès externe passe donc normalement par une Gateway Kubernetes plutôt
   que directement par le Service :

   ```bash
   kubectl get statefulsets,pods -n "$NS"
   kubectl get svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(gcloud compute addresses list --project="$PROJECT" --filter="name~cloudreve" --format="value(address)" --limit=1)
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le pod sert les requêtes. Cloudreve n'a pas de point de
   terminaison de santé dédié — ses propres sondes de démarrage et de vivacité
   ciblent `/`, qui renvoie HTTP 200 dès que le binaire Go sert les requêtes :

   ```bash
   curl -sI "http://${EXTERNAL_IP}"   # expect HTTP/1.1 200 (or via the Gateway hostname if custom domain is configured)
   ```

3. **Récupérez le mot de passe administrateur du premier démarrage.** Cloudreve
   génère lui-même son compte administrateur initial et son mot de passe au
   premier démarrage et affiche le mot de passe sur la sortie standard du
   conteneur — il n'existe **aucun secret Secret Manager** où le lire, et il
   n'est journalisé **qu'une seule fois**. Récupérez-le immédiatement :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
   ```

   Si le tampon de journaux l'a déjà dépassé, il n'existe aucun autre moyen de
   le récupérer depuis l'extérieur du conteneur — vous devrez réinitialiser le
   compte par le mécanisme que Cloudreve lui-même propose pour cette version,
   ou ouvrir un shell directement dans le pod (voir la tâche 3).

4. Ouvrez l'URL de la charge de travail (ou `http://${EXTERNAL_IP}`) dans un
   navigateur et connectez-vous avec le compte administrateur et le mot de
   passe récupéré ci-dessus. Changez immédiatement le mot de passe dans les
   paramètres du compte de l'interface web, car celui qui a été généré n'a
   jamais existé que dans une ligne de journal.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods et PVC :

   ```bash
   kubectl get statefulsets,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl rollout status statefulset/<service-name> -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count =
   max_instance_count = 1` par défaut, et c'est intentionnel : Cloudreve n'a
   pas de mode multi-nœud/cluster vérifié, et le PVC en mode bloc unique n'est
   pas protégé contre les écritures concurrentes si vous tentiez un
   StatefulSet à plusieurs réplicas. Conservez la valeur par défaut de la
   plateforme. Notez que `enable_pod_disruption_budget = true` avec
   `pdb_min_available = "1"` protège également le pod avec état unique contre
   les interruptions volontaires.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update**. Le
   Dockerfile fixe `application_version = "latest"` sur une version vérifiée
   précise (`3.8.3`) au moyen d'un ARG de build propre à l'application,
   `CLOUDREVE_VERSION`, de sorte qu'un nouveau build reproduit une image
   éprouvée au lieu de suivre un tag amont non testé.

4. **Inspectez le Persistent Volume en mode bloc** directement en ouvrant un
   shell dans le pod — contrairement à Cloud Run, GKE vous donne un vrai shell :

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /cloudreve
   kubectl exec -n "$NS" statefulset/<service-name> -- sqlite3 /cloudreve/cloudreve.db ".tables"
   gcloud compute disks list --project="$PROJECT" --filter="name~cloudreve"
   ```

5. **Comprenez le compromis lié à la classe de stockage.** Le PVC utilise par
   défaut `stateful_pvc_storage_class = standard-rwo` (Balanced PD sur SSD),
   qui consomme le quota restreint `SSD_TOTAL_GB` dans les projets limités.
   Réduire la charge de travail à zéro (`kubectl scale --replicas=0`) libère le
   CPU et la mémoire mais **conserve le PVC** — seule la suppression du PVC (ou
   du namespace) libère le quota qu'il occupe. Passez à
   `stateful_pvc_storage_class = standard` (HDD) si la pression sur le quota
   pose problème ; Cloudreve n'a pas besoin des IOPS d'un SSD.

6. **Gérez les jobs** (présents uniquement si vous avez fourni les vôtres —
   Cloudreve n'injecte aucun job d'initialisation de base de données par
   défaut, puisqu'il n'a pas de base de données externe) :

   ```bash
   kubectl get jobs -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer. C'est aussi là
   qu'apparaît le mot de passe administrateur du premier démarrage ; il est
   donc utile de connaître le filtre, même après la configuration initiale :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods (la mémoire mérite d'être
   surveillée lors de transferts de fichiers importants), le nombre de
   redémarrages et l'utilisation du disque du PVC. Le module peut provisionner
   un **test de disponibilité** (désactivé par défaut) ; s'il est activé,
   consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Cloudreve.

- **Pod en CrashLoopBackOff avec `exec ./cloudreve: no such file or
  directory` :** c'est le mode de défaillance par masquage de volume que le
  Dockerfile du module est conçu pour éviter (binaire déplacé vers
  `/usr/local/bin/cloudreve`, hors du montage du PVC sur `/cloudreve`). Si vous
  le rencontrez, quelque chose a annulé cette modification du Dockerfile —
  vérifiez `modules/Cloudreve_Common/scripts/Dockerfile` et relancez le build :
  ```bash
  kubectl describe pod -n "$NS" <pod>
  kubectl logs -n "$NS" <pod> --previous
  tofu taint 'module.app_gke.module.app_build.null_resource.build_and_push_application_image[0]'
  ```
- **Connexion impossible / mot de passe administrateur perdu :** le mot de passe
  n'est affiché dans les journaux du pod **qu'une seule fois**, au premier
  démarrage, et n'est jamais stocké dans Secret Manager. Recherchez dans
  l'historique récent (pas seulement la fin des journaux) si la capture
  initiale a été manquée :
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
    --project="$PROJECT" --freshness=7d --limit=1000 | grep -i "admin\|password"
  ```
- **Pod bloqué en `Pending` avec `Quota 'SSD_TOTAL_GB' exceeded` :** la classe
  de stockage par défaut `standard-rwo` repose sur des SSD et consomme le quota
  régional `SSD_TOTAL_GB` ; passez à `stateful_pvc_storage_class = standard`
  (HDD) — voir la tâche 3, étape 5.
- **Pod non Ready / sonde de vivacité en échec :** la sonde de démarrage est un HTTP
  `GET /` avec `failure_threshold = 10` (jusqu'à ~100 secondes) — un échec
  au-delà de ce délai signifie généralement que le PVC ne s'est pas monté ou
  que le binaire lui-même n'a pas démarré :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl get pvc -n "$NS"
  ```
- **Les données semblent réinitialisées après un redéploiement :** vérifiez que
  le PVC existe toujours et qu'il est toujours lié (`kubectl get pvc -n "$NS"`)
  — seule la suppression d'un namespace ou d'un PVC (et non un simple
  redémarrage de pod) fait réellement perdre la base de données SQLite
  intégrée et les fichiers téléversés.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de
configuration pour les pièges propres à chaque paramètre (notamment pourquoi
`max_instance_count` doit rester à `1` et pourquoi une entrée `gcs_volumes` ne
doit jamais cibler `/cloudreve` tant que le PVC en mode bloc est activé).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, le Persistent Volume en mode bloc (et tout ce qui y est stocké,
y compris la base de données SQLite intégrée et tous les fichiers téléversés) et
les images Artifact Registry. Les ressources détenues par **Services_GCP** (le
VPC, le cluster GKE, le registre partagé) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet GKE avec un PVC en mode bloc de 20Gi sur `/cloudreve` et construit l'image personnalisée (ni base de données, ni secrets) |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; récupérer le mot de passe administrateur du premier démarrage dans les journaux du pod et se connecter |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, rester sur un seul réplica, mettre à jour la version, gérer le compromis lié à la classe de stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging (y compris pour le mot de passe administrateur) ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de masquage de volume, de mot de passe perdu, de quota SSD, de sonde et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime la charge de travail, le namespace, le PVC et les images |
