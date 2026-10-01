---
title: "Plane sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Plane sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Plane_CloudRun.md @ 3055034 sha256:473f135baadd -->

# Plane sur Cloud Run — Guide de lab {#plane-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Plane est une plateforme open source de gestion de projet — une alternative à Jira / Linear pour les tickets, les cycles, les modules et les feuilles de route. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Plane on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Plane. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le sidecar RabbitMQ et les migrations du premier démarrage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Plane (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run exécutant le **conteneur tout-en-un**
   de Plane (api + worker/beat Celery + frontends web/space/admin + live +
   migrator derrière un proxy Caddy interne sur le port 80) avec un conteneur **sidecar RabbitMQ**,
   une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (dont les `SECRET_KEY` et `LIVE_SERVER_SECRET_KEY` générés automatiquement), Redis sur
   l'hôte NFS partagé, un bucket GCS dédié `storage`, construit l'image de conteneur
   personnalisée via Cloud Build et exécute une tâche ponctuelle `db-init`. Les premiers déploiements prennent
   environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~plane" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le chemin de santé de Plane est `/health`, servi par le
   proxy Caddy interne une fois que le migrator du premier démarrage a terminé (prévoyez plusieurs
   minutes sur un nouveau déploiement — la sonde de démarrage accorde jusqu'à ~5 minutes) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
   ```

2. Vérifiez que le point d'entrée a composé les trois URL de connexion dont Plane a besoin :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -E "Composed (DATABASE|REDIS|AMQP)_URL"
   ```

3. Ouvrez `${SERVICE_URL}/god-mode/` dans un navigateur — le panneau d'administration de l'instance Plane —
   et créez le compte administrateur de l'instance. Ouvrez ensuite `${SERVICE_URL}/` pour vous inscrire
   et créer votre premier espace de travail, projet et ticket.

4. **Notes de durcissement immédiat :** les envois de fichiers (pièces jointes, avatars) nécessitent un
   point de terminaison compatible S3 — fournissez des clés HMAC GCS ou des identifiants S3 externes via le
   paramètre `environment_variables` avant de vous appuyer sur les envois (voir le Guide de
   configuration). Les secrets de l'application peuvent être récupérés si nécessaire :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; notez les deux conteneurs — le tout-en-un Plane et le sidecar RabbitMQ `mq`) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). La
   valeur par défaut est la mise à l'échelle à zéro (`min = 0`, `cpu_always_allocated = false`) ; si votre équipe
   compte sur des notifications/webhooks/exports Celery ponctuels, définissez
   `cpu_always_allocated = true` et `min_instance_count = 1`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite (le Dockerfile d'encapsulation fige
   `makeplane/plane-aio-community:<version>` — notez qu'il n'existe aucun tag `latest`
   en amont ; utilisez donc `stable` ou un vrai tag de version) et une nouvelle révision est déployée.
   Le migrator applique automatiquement les modifications de schéma au démarrage.

4. **Gérez les secrets, le stockage et les tâches :**

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

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — supervisord multiplexe chaque sous-service intégré (migrator, api,
   worker, beat, frontends, Caddy) ainsi que le sidecar `mq` dans les journaux de la révision :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux (Logs Explorer) :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation
   du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) sur
   `/health` ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Plane.

- **Révision en mauvaise santé / le service ne répond pas :** le premier démarrage exécute les migrations
  Django (l'étape `migrator` de l'AIO) avant que Caddy ne réponde sur `/health` ; la
  sonde de démarrage accorde jusqu'à ~5 minutes. Inspectez la dernière révision et ses journaux
  avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base existe, que la tâche `db-init` s'est terminée et que le
  point d'entrée a journalisé `Composed DATABASE_URL ... sslmode=require`.
- **Erreurs Celery / du broker (le worker ne peut pas se connecter) :** Plane exige RabbitMQ ; sur
  Cloud Run, il s'agit du sidecar `mq` dans le pod, sur `127.0.0.1:5672`. Recherchez dans les journaux
  `Composed AMQP_URL host=127.0.0.1:5672` ainsi que la sortie de démarrage propre au sidecar.
  Notez que le broker est éphémère — les tâches en file d'attente sont perdues lors du recyclage d'une instance.
- **Les envois de fichiers échouent (application par ailleurs en bonne santé) :** comportement attendu tant que le stockage
  compatible S3 n'est pas raccordé — Plane a besoin de `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (clés HMAC
  GCS ou S3 externe) via `environment_variables`. C'est propre à Plane et
  documenté dans la section Pitfalls du Guide de configuration.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build. Une cause fréquente est un
  `application_version` invalide — l'image amont `makeplane/plane-aio-community` n'a pas de
  tag `latest` (le module convertit `latest`→`stable`, mais un tag explicite mal saisi renvoie une 404
  avec MANIFEST_UNKNOWN).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run
(y compris le sidecar RabbitMQ), la base de données Cloud SQL, les secrets Secret Manager, les buckets
GCS (y compris le bucket `storage`) et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre, l'hôte NFS/Redis) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (conteneur AIO + sidecar RabbitMQ), Cloud SQL (PostgreSQL 15), Redis, un bucket GCS, les secrets, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | `/health` répond ; URL de connexion composées ; administrateur de l'instance créé via `/god-mode/` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de broker, d'envoi de fichiers, de tâche d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
