---
title: "Docmost sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Docmost sur Cloud Run dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Docmost_CloudRun.md @ 3055034 sha256:3464fb594b9a -->

# Docmost sur Cloud Run — Guide de lab {#docmost-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Docmost est une plateforme open source de wiki et de documentation collaborative en temps réel — une alternative auto-hébergée à Confluence/Notion construite sur NestJS. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Docmost on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Docmost. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier, et créer le premier espace de travail et le compte administrateur.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Comprendre le rôle de PostgreSQL, Redis et NFS dans une charge de travail d'édition collaborative.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Docmost (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (port 3000, 1 vCPU / 1 GiB,
   mise à l'échelle jusqu'à zéro), une base de données Cloud SQL (PostgreSQL 15) avec ses
   secrets Secret Manager, Redis pour la collaboration en temps réel et les files de jobs (co-hébergé sur la VM
   du serveur NFS par défaut), un volume NFS monté sur `/app/data/storage` pour les
   pièces jointes téléversées, un bucket de données GCS et un `APP_SECRET` généré automatiquement. Elle construit
   l'image de conteneur et exécute un job unique d'initialisation de la base de données. Les premiers déploiements
   prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois l'opération terminée, découvrez les ressources avec des filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~docmost" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est en bonne santé. Le chemin de santé de Docmost est `/api/health`, qui
   renvoie HTTP 200 une fois que l'application a démarré et exécuté ses migrations de schéma (comptez jusqu'à
   ~2 minutes sur un nouveau déploiement — la sonde de démarrage utilise un délai initial de 60 secondes
   plus une fenêtre de nouvelles tentatives ; avec `min_instance_count = 0`, ce curl déclenche aussi
   le démarrage à froid) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Docmost est livré **sans identifiants par défaut** —
   le premier visiteur remplit le formulaire de configuration et crée l'espace de travail initial et le
   compte administrateur. Faites-le rapidement après le déploiement afin que personne d'autre ne puisse s'approprier
   l'espace de travail. Les secrets générés automatiquement peuvent être consultés si nécessaire :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   # e.g. the DB password or APP_SECRET:
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

3. Vérifiez le câblage de la collaboration : créez une page et ouvrez-la dans deux onglets du navigateur —
   les modifications doivent apparaître en direct dans les deux (la synchronisation en temps réel passe par le point de terminaison
   WebSocket `APP_URL`, coordonné via Redis).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l'échelle est donc un
   changement de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors du prochain apply). La valeur par défaut est `min = 0` (mise à l'échelle jusqu'à zéro) / `max = 1` ; définissez
   `min_instance_count = 1` pour garder le point de terminaison de collaboration actif, et n'augmentez
   `max_instance_count` qu'avec Redis activé (il l'est par défaut) afin que les instances restent
   coordonnées.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.
   Docmost exécute automatiquement ses migrations de schéma au démarrage — il n'y a pas d'étape de
   migration distincte.

4. **Gérez les secrets, le stockage et les jobs.** Considérez `APP_SECRET` comme immuable — le faire tourner
   après le premier démarrage déconnecte tout le monde et rend irrécupérables les données chiffrées avec l'ancienne
   valeur :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~docmost"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. docmostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^docmost" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
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
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (surveillez les démarrages à froid avec la
   mise à l'échelle jusqu'à zéro) et l'utilisation du CPU / de la mémoire ; les métriques Cloud SQL se trouvent sur la
   page SQL. Le module provisionne également un **test de disponibilité** (uptime check) (le point de terminaison est public
   par défaut) ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Docmost.

- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage cible
  `/api/health` avec un délai initial de 60 secondes pour laisser le temps aux migrations au démarrage.
  Inspectez la dernière révision et ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le job `db-init` s'est terminé. Notez
  que le service en cours d'exécution se connecte à l'**IP privée de Cloud SQL en TCP avec SSL**
  (le pilote `postgres.js` de Docmost ne sait pas analyser le chemin du socket Unix), tandis que le
  job `db-init` utilise le socket monté — deux chemins différents qui peuvent échouer
  indépendamment.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Édition en temps réel cassée / les modifications ne se synchronisent pas :** vérifiez que Redis est joignable
  (`enable_redis = true` ; avec `redis_host` vide, la VM du serveur NFS co-héberge Redis —
  elle doit être `RUNNING`), et vérifiez que `APP_URL` dans la révision en cours d'exécution correspond à
  l'URL que les utilisateurs consultent réellement (une différence casse le WebSocket de collaboration
  et les liens absolus — définissez-la explicitement lorsque vous utilisez un domaine personnalisé).
- **Les pièces jointes disparaissent après un redémarrage :** vérifiez `enable_nfs = true` et l'environnement
  d'exécution `gen2` — sans NFS, les téléversements atterrissent sur un disque éphémère.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec. L'
  image est construite sur mesure avec l'ARG de build `DOCMOST_VERSION` (ainsi,
  `application_version = "latest"` correspond à une version épinglée).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager (y compris `APP_SECRET`), les buckets GCS, le volume de pièces jointes sur NFS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), Redis, NFS, un bucket GCS, des secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | `/api/health` répond ; création du premier espace de travail et du compte administrateur ; vérification de l'édition en temps réel |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (coordination par Redis), mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de Redis/collaboration, de NFS, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
