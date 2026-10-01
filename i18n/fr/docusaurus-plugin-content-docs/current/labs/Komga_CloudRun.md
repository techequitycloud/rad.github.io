---
title: "Komga sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Komga sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Komga_CloudRun.md @ 3055034 sha256:470947ccd9df -->

# Komga sur Cloud Run — Guide de lab {#komga-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Komga est un serveur de lecture de bandes dessinées et de mangas open source et auto-hébergé, doté d'une interface
web épurée, de flux OPDS, de collections, de listes de lecture et d'une recherche plein texte. Ce lab vous fait
parcourir l'intégralité du cycle de vie opérationnel du module **Komga on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Komga. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour et gérer le stockage persistant.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Komga (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Komga_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage monté
   sur `/config` via GCS FUSE, et déploie directement l'image officielle `gotson/komga`
   (aucune étape de build, simplement un miroir Artifact Registry facultatif). Il n'y a
   ni base de données à provisionner ni job d'initialisation à exécuter, les premiers déploiements sont donc rapides —
   environ **3–6 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~komga" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Komga expose un point de terminaison de santé Spring Boot
   Actuator non authentifié :

   ```bash
   curl -s "$SERVICE_URL/actuator/health"   # expect {"status":"UP"}
   ```

   Remarque : `$SERVICE_URL/api/v1/actuator/health` est un point de terminaison **différent, soumis à
   authentification**, qui renvoie `401 Unauthorized` — c'est attendu et ce n'est pas une anomalie.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, l'assistant de configuration de Komga vous invite
   à créer le compte administrateur initial — aucun identifiant administrateur prédéfini
   n'existe dans Secret Manager. Après avoir créé le compte administrateur, ajoutez une
   **bibliothèque** (library) pointant vers un chemin multimédia monté (consultez `gcs_volumes` dans le
   Guide de configuration pour ajouter un bucket de stockage distinct pour les bandes dessinées ou les livres) et
   lancez une analyse.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle est volontairement fixée à 1.** Komga sert une bibliothèque SQLite partagée unique
   depuis un seul volume monté — ne portez pas `max_instance_count` au-delà de `1` ; plusieurs
   écrivains simultanés risqueraient de corrompre la base de données.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** — cela déploie directement le
   tag `gotson/komga` correspondant (ou sa copie en miroir dans Artifact
   Registry).

4. **Inspectez le stockage :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~komga"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation du CPU et de la
   mémoire (pour les applications JVM, il est utile de surveiller de près la mémoire pendant l'analyse de grandes
   bibliothèques). Le module peut provisionner un **test de disponibilité** (uptime check) (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé,
   vérifiez qu'il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Komga.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage. La sonde de démarrage cible `/actuator/health` ; vérifiez
  que le chemin de la sonde n'a pas été remplacé par erreur par le point de terminaison soumis à authentification
  `/api/v1/actuator/health` (qui renvoie toujours 401, quel que soit l'état de l'application).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **État de la bibliothèque perdu après un redéploiement :** vérifiez que `enable_gcs_storage_volume`
  vaut toujours `true` et que le bucket `storage` est correctement monté sur `/config` — si
  ce montage est désactivé sans remplacement, tout l'état de la bibliothèque (y compris la
  base de données SQLite) est perdu au prochain démarrage à froid.
- **Analyses de bibliothèque lentes ou en échec :** recherchez des erreurs OOM dans les journaux — l'index Lucene
  et le cache de vignettes de Komga sont conservés dans le tas de la JVM ; augmentez `memory_limit` (et
  éventuellement `jvm_heap_max`) pour les très grandes bibliothèques.
- **Échec du build de l'image :** consultez l'historique de Cloud Build — Komga utilise une image préconstruite,
  donc un échec de build ici signifie presque toujours que `container_image_source` a été
  remplacé par erreur par `"custom"` sans Dockerfile présent.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
les entrées Secret Manager (si certaines ont été ajoutées manuellement), le bucket de stockage GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le dépôt Artifact
Registry lui-même) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, un bucket de stockage GCS monté sur `/config`, et déploie l'image préconstruite — sans base de données ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; créer le compte administrateur initial et ajouter une bibliothèque dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, inspecter le stockage — la mise à l'échelle reste fixée à 1 |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de montage du stockage, de mémoire, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
