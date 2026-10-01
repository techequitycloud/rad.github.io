---
title: "PhotoPrism sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez PhotoPrism sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PhotoPrism_CloudRun.md @ 3055034 sha256:62997e4c73cb -->

# PhotoPrism sur Cloud Run — Guide de lab {#photoprism-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos, dotée d'IA —
elle permet de parcourir, d'organiser et de partager une médiathèque personnelle avec un étiquetage automatique,
la reconnaissance faciale et la recherche plein texte/visuelle, le tout servi par un unique binaire Go
avec une base de données SQLite intégrée. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **PhotoPrism on Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de PhotoPrism. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le volume de données adossé à GCS FUSE.
- Effectuer les opérations du jour 2 — inspecter, gérer les secrets et sauvegarder la médiathèque.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1). PhotoPrism lui-même
  ne provisionne aucune instance Cloud SQL — il utilise une base de données SQLite intégrée.
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **PhotoPrism (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `memory_limit` vaut par défaut
   `2Gi` ; envisagez de l'augmenter avant le déploiement si vous prévoyez une véritable bibliothèque de photos/vidéos
   (voir la tâche 3). Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**),
   ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (fixé à exactement une instance,
   `min=1`, `max=1`), un bucket Cloud Storage monté dans le conteneur en tant que
   volume GCS FUSE sur `/photoprism` (la seule couche de persistance — il n'y a pas d'instance Cloud
   SQL) et le secret Secret Manager `PHOTOPRISM_ADMIN_PASSWORD` généré automatiquement,
   puis construit et met en miroir l'image de conteneur. Il n'y a aucun job d'initialisation de base de données
   à attendre — PhotoPrism crée son propre schéma SQLite au premier démarrage. Les premiers déploiements
   se terminent généralement en **10 à 20 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~photoprism" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. PhotoPrism expose un point de terminaison d'état non authentifié
   qui répond dès que le serveur HTTP est démarré et que l'index SQLite est prêt :

   ```bash
   curl -s "$SERVICE_URL/api/v1/status"   # expect a 200 JSON response
   ```

2. Récupérez le mot de passe administrateur généré automatiquement avant de vous connecter — aucun identifiant
   prédéfini n'est affiché ailleurs :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom d'utilisateur `admin` (ou la valeur
   configurée de `admin_username`) et le mot de passe récupéré ci-dessus. Une fois l'URL
   déployée connue, envisagez d'y définir `site_url` dans la plateforme RAD et de l'appliquer via
   **Update** — cela corrige les liens absolus et les URL des miniatures qui, sinon, se rabattent
   sur l'hôte de la requête.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; PhotoPrism ne doit jamais servir deux révisions recevant du trafic
   simultanément, car toutes deux écriraient dans le même fichier SQLite monté via gcsfuse) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count` et `max_instance_count`
   sont tous deux fixés à `1` par conception — PhotoPrism sert une bibliothèque SQLite partagée depuis
   un unique volume gcsfuse accessible en écriture, et un second processus d'écriture concurrent risque de corrompre
   la base de données et l'index. Ce n'est pas un réglage de mise à l'échelle à ajuster.

3. **Ajustez la mémoire à la taille de votre bibliothèque.** La variable `memory_limit` du module
   vaut par défaut `2Gi` — le minimum qui permet de conserver la reconnaissance faciale et la prise en charge RAW —
   mais PhotoPrism charge des index vectoriels en mémoire pour la reconnaissance faciale et la génération
   de miniatures, et la recommandation de base de la couche applicative est `4Gi`
   pour de véritables charges d'indexation. Si vous voyez des arrêts pour OOM dans les journaux (tâche 4) à mesure que
   votre bibliothèque grandit, augmentez `memory_limit` dans la plateforme RAD et appliquez via **Update**.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (épinglée à un
   tag de build `PHOTOPRISM_VERSION`, et non au paramètre de version générique, lorsqu'il est laissé à
   `latest`) et une nouvelle révision est déployée.

5. **Gérez les secrets et le bucket de la médiathèque :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~photoprism"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~storage" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/photoprism/originals/"
   ```

6. **Sauvegardez la médiathèque.** Comme PhotoPrism n'a pas de base de données SQL, une sauvegarde est
   une archive du système de fichiers contenant le contenu du bucket GCS (`backup_format = tar` par défaut),
   et non un dump de base de données. Passez en revue `backup_schedule` et `backup_retention_days` dans la
   plateforme RAD, et augmentez la rétention pour les bibliothèques de production.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99) et l'utilisation CPU / mémoire — surveillez de près la mémoire
   à mesure que votre bibliothèque grandit, car l'indexation et la génération de miniatures sont gourmandes en mémoire.
   Le module peut provisionner un **test de disponibilité** (uptime check, désactivé par défaut) ; activez-le via
   `uptime_check_config` et vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de PhotoPrism.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `/api/v1/status` et accorde
  environ 15 s + 10×10 s (~1 minute 55 secondes) pour la création du schéma SQLite au premier démarrage
  et le préchauffage de l'index.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Conteneur arrêté pour OOM :** vérifiez l'utilisation mémoire de la révision dans Monitoring ; si
  elle plafonne près de la limite `memory_limit`, augmentez-la (voir la tâche 3) — 2Gi est la
  valeur par défaut du module, mais elle est sous-dimensionnée pour de vraies bibliothèques.
- **Échecs du montage GCS FUSE :** vérifiez que `execution_environment = "gen2"` — les volumes GCS FUSE
  ne fonctionnent qu'en gen2, ce qui est obligatoire, et non facultatif, pour ce module.
- **Compte administrateur inaccessible :** relisez le mot de passe dans Secret Manager
  (tâche 2) ; c'est la source de vérité et PhotoPrism le réapplique à chaque démarrage.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment pourquoi `max_instance_count` ne doit jamais dépasser 1, et pourquoi
donner à `database_type` une valeur autre que `NONE` provisionne une instance Cloud SQL réelle, facturée, mais
inutilisée sur le plan fonctionnel).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket GCS de la médiathèque (y compris la base de données SQLite intégrée et tous les
originaux qu'il contient — il n'y a pas de base de données distincte à supprimer) et les secrets
Secret Manager. Les ressources appartenant à **Services_GCP** (le VPC, Artifact Registry) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un service Cloud Run à instance unique, un bucket de données monté via GCS FUSE et le secret du mot de passe administrateur — aucune initialisation de base de données à attendre |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; récupérer le mot de passe administrateur généré automatiquement et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions (ne jamais dépasser 1 instance), ajuster la mémoire à la taille de la bibliothèque, mettre à jour la version, gérer les secrets et les sauvegardes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring, en particulier la mémoire, et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'OOM, de montage GCS FUSE, d'identifiants administrateur, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le bucket de la médiathèque |
