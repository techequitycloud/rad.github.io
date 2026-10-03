---
title: "Plane sur Cloud Run — Guide de Lab"
description: "Lab pratique : déployez Plane sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Plane_CloudRun.md @ 15fd4c7 sha256:c186f3792940 -->

# Plane sur Cloud Run — Guide de Lab {#plane-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45–90 minutes

Plane est une plateforme open source de gestion de projet — une alternative à Jira / Linear pour les problèmes, les cycles, les modules et les feuilles de route. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Plane sur Cloud Run** sur Google Cloud : déployez-le, accédez-y et vérifiez-le, utilisez-le au quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Plane. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le sidecar RabbitMQ et les migrations au premier démarrage.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **CLI gcloud** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes affichées en tant que Propriétaire du projet, puis **Vérifier**) et de donner au compte de service de déploiement RAD le rôle de **Propriétaire**. Un projet créé par RAD pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de Jour 2 — sont modifiées par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **Plane (Cloud Run)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun) documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run exécutant le **conteneur tout-en-un** de Plane (API + worker/beat Celery + frontends web/espace/admin + live + migrator derrière un proxy Caddy interne sur le port 80) avec un **conteneur sidecar RabbitMQ**, une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (y compris les `SECRET_KEY` et `LIVE_SERVER_SECRET_KEY` auto-générés), Redis sur l'hôte NFS partagé, un bucket GCS `storage` dédié, construit l'image de conteneur personnalisée via Cloud Build, et exécute un job `db-init` unique. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au nom (afin que les commandes continuent de fonctionner quel que soit le suffixe de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~plane" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Le chemin de santé de Plane est `/health`, servi par le proxy Caddy interne une fois que le migrator de premier démarrage est terminé (laissez plusieurs minutes sur un nouveau déploiement — la sonde de démarrage permet jusqu'à ~5 minutes) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
   ```

2. Vérifiez que le point d'entrée a composé les trois URL de connexion requises par Plane :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -E "Composed (DATABASE|REDIS|AMQP)_URL"
   ```

3. Ouvrez `${SERVICE_URL}/god-mode/` dans un navigateur — le panneau d'administration d'instance de Plane — et créez le compte d'administrateur d'instance. Ensuite, ouvrez `${SERVICE_URL}/` pour vous inscrire et créer votre premier espace de travail, projet et problème.

4. **Notes de durcissement immédiates :** les téléchargements de fichiers (pièces jointes, avatars) nécessitent un point de terminaison compatible S3 — fournissez des clés HMAC GCS ou des identifiants S3 externes via l'entrée `environment_variables` avant de vous fier aux téléchargements (voir le Guide de configuration). Les secrets de l'application peuvent être récupérés si nécessaire :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ; notez les deux conteneurs — le tout-en-un Plane et le sidecar RabbitMQ `mq`) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les entrées d'instances min/max et en cliquant sur **Update** sur la page des détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est un changement de configuration, pas une modification manuelle `gcloud` (une modification manuelle serait annulée lors du prochain apply). Les valeurs par défaut sont `min_instance_count = 1` (gardez-le : l'instance exécute le worker et le beat Celery, donc à `0` chaque tâche périodique s'arrête une fois qu'elle passe à zéro) et `cpu_always_allocated = false` ; si votre équipe dépend de notifications/webhooks/exports Celery en temps opportun, définissez également `cpu_always_allocated = true`.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de version via **Update** sur la page des détails du déploiement ; une nouvelle image est construite (le Dockerfile wrapper épingle `makeplane/plane-aio-community:<version>` — notez qu'il n'y a pas de tag `latest` en amont, donc utilisez `stable` ou un vrai tag de version) et une nouvelle révision est déployée. Le migrator applique automatiquement les changements de schéma au démarrage.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~plane"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. planedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^plane" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — supervisord multiplexe chaque sous-service groupé (migrator, API, worker, beat, frontends, Caddy) plus le sidecar `mq` dans les journaux de révision :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** contre `/health` ; confirmez qu'il est vert sous Surveillance → Tests de disponibilité, et examinez Alertes → Politiques.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et ne changent pas avec les versions de Plane.

- **Révision non saine / le service ne répond pas :** le premier démarrage exécute les migrations Django (l'étape AIO `migrator`) avant que Caddy ne réponde sur `/health` ; la sonde de démarrage permet jusqu'à ~5 minutes. Inspectez la dernière révision et ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL (PostgreSQL 15) est `RUNNABLE`, que le secret du mot de passe de la base de données existe, que le job `db-init` est terminé et que le point d'entrée a enregistré `Composed DATABASE_URL ... sslmode=require`.
- **Erreurs Celery / broker (le worker ne peut pas se connecter) :** Plane nécessite RabbitMQ ; sur Cloud Run, c'est le sidecar `mq` dans le pod à `127.0.0.1:5672`. Vérifiez les journaux pour `Composed AMQP_URL host=127.0.0.1:5672` et pour la sortie de démarrage du sidecar. Notez que le broker est éphémère — les tâches en file d'attente sont perdues lors du recyclage de l'instance.
- **Les téléchargements de fichiers échouent (l'application est par ailleurs saine) :** attendu jusqu'à ce que le stockage compatible S3 soit câblé — Plane a besoin de `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (clés HMAC GCS ou S3 externe) via `environment_variables`. Ceci est spécifique à Plane et documenté dans la section Pièges du Guide de configuration.
- **Le job d'initialisation a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **La construction de l'image a échoué :** examinez l'historique de Cloud Build. Une cause courante est un `application_version` invalide — l'image `makeplane/plane-aio-community` en amont n'a pas de tag `latest` (le module mappe `latest`→`stable`, mais un tag explicite mal orthographié renvoie une erreur 404 avec MANIFEST_UNKNOWN).
- **Erreurs 403 / de permission :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — le service Cloud Run (y compris le sidecar RabbitMQ), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris le bucket `storage`) et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, Cloud SQL partagé, le registre, l'hôte NFS/Redis) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (conteneur AIO + sidecar RabbitMQ), Cloud SQL (PostgreSQL 15), Redis, bucket GCS, secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | `/health` passe ; URL de connexion composées ; administrateur d'instance créé via `/god-mode/` |
| 3 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes/stockage, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de révision, de base de données, de broker, de téléchargement, de job d'initialisation, de build et d'IAM |
| 6 — Suppression | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
