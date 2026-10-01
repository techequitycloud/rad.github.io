---
title: "Cloudreve sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Cloudreve sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Cloudreve_CloudRun.md @ 3055034 sha256:a09f405fd82e -->

# Cloudreve sur Cloud Run — Guide de lab {#cloudreve-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Cloudreve est une plateforme open source et auto-hébergée de stockage cloud et
de partage de fichiers, écrite en Go, dotée d'une interface web pour téléverser,
organiser, prévisualiser et partager des fichiers. Ce lab vous guide à travers
le cycle de vie opérationnel complet du module **Cloudreve on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Cloudreve. Pour la
liste complète des services provisionnés et de chaque paramètre de
configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris récupérer le
  mot de passe administrateur du premier démarrage dans Cloud Logging.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle (ou plutôt
  comprendre pourquoi ne pas le faire), mettre à jour et gérer le volume de
  données monté via GCS FUSE.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Cloudreve (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage
   (monté automatiquement comme volume **GCS FUSE** sur `/cloudreve` — c'est le
   *seul* mécanisme de persistance sur Cloud Run, puisque Cloudreve y stocke sa
   base de données SQLite intégrée et les fichiers téléversés), et construit
   l'image de conteneur personnalisée (un Dockerfile multi-étapes qui déplace le
   binaire `cloudreve` vers `/usr/local/bin/cloudreve` afin que le montage FUSE
   ne puisse pas le masquer). **Aucune instance Cloud SQL ni aucun secret Secret
   Manager** n'est créé pour ce module — Cloudreve génère lui-même son mot de
   passe administrateur au premier démarrage. Les premiers déploiements
   prennent généralement **10–20 minutes** (essentiellement pour le build de l'image).

3. Une fois terminé, repérez la ressource avec un filtre indépendant du nom
   (afin que les commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~cloudreve" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. Cloudreve n'a pas de point de
   terminaison de santé dédié — ses propres sondes de démarrage et de vivacité
   ciblent `/`, qui renvoie HTTP 200 dès que le binaire Go sert les requêtes :

   ```bash
   curl -sI "$SERVICE_URL"   # expect HTTP/2 200
   ```

2. **Récupérez le mot de passe administrateur du premier démarrage.** Cloudreve
   génère lui-même son compte administrateur initial et son mot de passe au
   premier démarrage et affiche le mot de passe sur la sortie standard du
   conteneur — il n'existe **aucun secret Secret Manager** où le lire, et il
   n'est journalisé **qu'une seule fois**. Récupérez-le immédiatement :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
     | grep -i "admin\|password"
   ```

   Si le tampon de journaux l'a déjà dépassé, il n'existe aucun autre moyen de
   le récupérer depuis l'extérieur du conteneur — vous devrez réinitialiser le
   compte par le mécanisme que Cloudreve lui-même propose pour cette version.

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le compte
   administrateur et le mot de passe récupéré ci-dessus. Changez immédiatement
   le mot de passe dans les paramètres du compte de l'interface web, car celui
   qui a été généré n'a jamais existé que dans une ligne de journal.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count = max_instance_count
   = 1` par défaut, et c'est intentionnel : Cloudreve n'a pas de mode
   multi-nœud/cluster vérifié, et le fichier SQLite intégré monté via GCS FUSE
   n'est pas protégé contre les écritures concurrentes. Augmenter
   `max_instance_count` risque de corrompre la base de données, au lieu
   d'ajouter simplement de la capacité — conservez la valeur par défaut de la plateforme.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update**. Le
   Dockerfile fixe `application_version = "latest"` sur une version vérifiée
   précise (`3.8.3`) au moyen d'un ARG de build propre à l'application,
   `CLOUDREVE_VERSION`, de sorte qu'un nouveau build reproduit une image
   éprouvée au lieu de suivre un tag amont non testé.

4. **Inspectez le volume de données** (le bucket GCS derrière `/cloudreve`) :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/
   ```

   Il n'existe pas d'équivalent `gcloud run` à un shell exec pour Cloud Run ;
   l'inspection directe du fichier SQLite monté doit donc passer par le bucket
   GCS lui-même (ou par un job ponctuel) plutôt que par une session interactive.

5. **Gérez les jobs** (présents uniquement si vous avez fourni les vôtres —
   Cloudreve n'injecte aucun job d'initialisation de base de données par
   défaut, puisqu'il n'a pas de base de données externe) :

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer. C'est aussi là
   qu'apparaît le mot de passe administrateur du premier démarrage ; il est
   donc utile de connaître le filtre, même après la configuration initiale :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et
   examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le
   nombre d'instances (qui doit rester exactement à 1) et l'utilisation du CPU
   et de la mémoire — la mémoire mérite d'être surveillée lors de transferts de
   fichiers importants. Un test de disponibilité peut être activé via
   `uptime_check_config` (désactivé par défaut) ; s'il est activé, vérifiez
   qu'il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Cloudreve.

- **Révision en mauvaise santé / boucle de plantage avec `exec ./cloudreve: no such file or
  directory` :** c'est le mode de défaillance par masquage de volume que le
  Dockerfile du module est conçu pour éviter (binaire déplacé vers
  `/usr/local/bin/cloudreve`, hors du montage FUSE sur `/cloudreve`). Si vous
  le rencontrez, quelque chose a annulé cette modification du Dockerfile —
  vérifiez `modules/Cloudreve_Common/scripts/Dockerfile` et relancez le build :
  ```bash
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  tofu taint 'module.app_cloudrun.module.app_build.null_resource.build_and_push_application_image[0]'
  ```
- **Connexion impossible / mot de passe administrateur perdu :** le mot de passe
  n'est affiché dans les journaux du conteneur **qu'une seule fois**, au premier
  démarrage, et n'est jamais stocké dans Secret Manager. Recherchez dans
  l'historique récent (pas seulement les 200 dernières lignes) si la capture
  initiale a été manquée :
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"' --project="$PROJECT" --freshness=7d --limit=1000 \
    | grep -i "admin\|password"
  ```
- **La révision ne devient pas Ready :** la sonde de démarrage est un HTTP `GET /` avec
  `failure_threshold = 10` (jusqu'à ~100 secondes) — un échec au-delà de ce
  délai signifie généralement que le montage GCS FUSE ne s'est pas attaché ou
  que le binaire lui-même n'a pas démarré ; vérifiez que
  `execution_environment = gen2` est défini (requis pour GCS Fuse) et examinez
  les journaux de la révision.
- **Les données semblent réinitialisées après un redéploiement :** vérifiez que
  le bucket `storage` existe toujours et qu'il est toujours monté sur
  `/cloudreve` — `create_cloud_storage` doit rester à `true`, et le nom du
  bucket doit correspondre à celui que la fondation a réellement créé.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution sur le bucket `storage`.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de
configuration pour les pièges propres à chaque paramètre (notamment pourquoi
`max_instance_count` doit rester à `1` et pourquoi `container_port` ne doit
jamais être modifié).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le service Cloud Run,
le bucket de données GCS FUSE (et tout ce qui y est stocké, y compris la base de
données SQLite intégrée et tous les fichiers téléversés) et les images Artifact Registry.
Les ressources détenues par **Services_GCP** (le VPC, le registre partagé) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, un bucket de données monté via GCS FUSE, et construit l'image personnalisée (ni base de données, ni secrets) |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; récupérez le mot de passe administrateur du premier démarrage dans Cloud Logging et connectez-vous |
| 3 — Exploiter | Manuel | Inspecter les révisions, rester sur une seule instance, mettre à jour la version, inspecter le bucket de données |
| 4 — Observer | Manuel | Interroger Cloud Logging (y compris pour le mot de passe administrateur) ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de masquage de volume, de mot de passe perdu, de sonde et d'autorisation |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime le service, le bucket de données et les images |
