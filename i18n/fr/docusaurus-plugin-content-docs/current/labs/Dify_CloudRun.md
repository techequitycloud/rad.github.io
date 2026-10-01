---
title: "Dify sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Dify sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Dify_CloudRun.md @ 3055034 sha256:e3785f5df85c -->

# Dify sur Cloud Run — Guide de lab {#dify-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Dify est une plateforme open source de développement d’applications LLM permettant de construire
des applications d’IA de niveau production, avec un concepteur visuel de workflows, un pipeline RAG,
un framework d’agents et une gestion multi-modèles. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Dify on Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants
et le démanteler.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Dify. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution et le vérifier, y compris le frontend web.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry, le NFS Filestore
  et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu’elle affiche en tant qu’Owner du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n’exige ni l’un ni l’autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Dify (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute alors une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne deux services Cloud Run (le service API+Celery et le
   frontend web Next.js), une base de données Cloud SQL (PostgreSQL 15 avec pgvector) avec ses
   secrets Secret Manager, un bucket de stockage GCS dédié et Redis via le serveur NFS,
   construit l’image de conteneur et exécute un job ponctuel d’initialisation de la base de données. Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL en représente l’essentiel).

3. Une fois l’opération terminée, découvrez les ressources à l’aide de filtres indépendants des noms (pour que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   # API service
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify" \
     --format="value(metadata.name)" --limit=1)
   API_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   # Web frontend service (the URL to open in a browser)
   WEB_SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify.*-web" --format="value(metadata.name)" --limit=1)
   WEB_URL=$(gcloud run services describe "$WEB_SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   echo "API service: $SERVICE   ($API_URL)"
   echo "Web service: $WEB_SERVICE   ($WEB_URL)"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service API est sain et connecté à sa base de données :

   ```bash
   curl -s "$API_URL/health"   # expect {"status":"ok"}
   ```

2. Dify ne stocke pas de mot de passe administrateur pré-généré dans Secret Manager. Lors de la première
   visite, l’application affiche un **assistant de configuration** (setup wizard) dans lequel vous créez le compte administrateur.
   Ouvrez l’URL du frontend web dans un navigateur et terminez la configuration :

   ```bash
   echo "$WEB_URL"
   ```

   Saisissez votre adresse e-mail d’administrateur et un mot de passe lorsque vous y êtes invité. Une fois la configuration terminée, la console
   Dify s’ouvre. La documentation produit de Dify couvre le concepteur de workflows, le pipeline
   RAG et la configuration des fournisseurs de LLM.

3. Vérifiez que les deux services sont listés et que la `SECRET_KEY` (clé de signature des sessions) est présente
   dans Secret Manager :

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify"

   gcloud secrets list --project="$PROJECT" --filter="name~dify AND name~secret-key"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les services et leurs révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l’échelle est donc une modification de configuration, et non une
   modification `gcloud` manuelle (une modification manuelle serait annulée lors de l’application suivante). Maintenez
   `min_instance_count` à 1 ou plus afin que le worker Celery intégré conserve sa
   connexion au broker Redis.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée sur les deux services.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~dify"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dify"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and backup jobs
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --filter="name~dify" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. difydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^dify" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run de chaque service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise à l’échelle) et l’utilisation du processeur
   / de la mémoire. Le module provisionne aussi un **contrôle de disponibilité** (uptime check) ciblant
   `/health` ; vérifiez qu’il est au vert sous Monitoring → Uptime checks, et consultez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Dify à l’autre.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et ses
  journaux à la recherche d’erreurs de démarrage. Le serveur d’API et les migrations de base de données s’exécutent à chaque démarrage ;
  attendez donc le délai configuré de la sonde de démarrage avant d’attendre du trafic.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données existe et est injecté, et que le job db-init s’est terminé. Sans
  le sidecar Cloud SQL Auth Proxy (`enable_cloudsql_volume = true`), le conteneur
  ne peut pas du tout atteindre la base de données.
- **Tâches Celery non exécutées / échecs asynchrones :** Redis est requis pour tout le traitement
  en arrière-plan. Vérifiez que NFS est activé (obligatoire lorsqu’aucun hôte Redis externe n’est défini) et
  que l’espace réservé `NFS_SERVER_IP` a été correctement résolu dans l’environnement du service.
- **Échec du job d’initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~dify AND metadata.name~db-init" \
    --format="value(metadata.name)" --limit=1)
  gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l’image :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution et que
  le bucket de stockage GCS et les secrets Secret Manager sont accessibles.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — les deux services Cloud Run,
la base de données Cloud SQL, le bucket de stockage GCS, les secrets Secret Manager et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le NFS Filestore, le
Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne deux services Cloud Run, Cloud SQL (PostgreSQL + pgvector), les secrets et le bucket GCS, puis exécute l’initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle d’état réussit ; terminer l’assistant de configuration administrateur via le frontend web |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, gérer les secrets/sauvegardes/le stockage, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de Celery/Redis, de job d’initialisation, de build et d’IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
