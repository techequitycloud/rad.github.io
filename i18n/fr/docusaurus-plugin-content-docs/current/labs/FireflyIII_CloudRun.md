---
title: "Firefly III sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Firefly III sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/FireflyIII_CloudRun.md @ 3055034 sha256:88112c2b0788 -->

# Firefly III sur Cloud Run — Guide de lab {#firefly-iii-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Firefly III est un gestionnaire de finances personnelles gratuit, open source et auto-hébergé, qui permet de suivre
des comptes, des transactions, des budgets, des factures et des transactions récurrentes. Ce lab vous fait parcourir
l’intégralité du cycle de vie opérationnel du module **Firefly III on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer
les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Firefly III. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun) :
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu’il provisionne.
- Accéder au service en cours d’exécution, le vérifier et créer le premier compte administrateur.
- Effectuer les opérations du jour 2 : inspecter, mettre à l’échelle, mettre à jour, gérer les secrets et les sauvegardes, et raccorder le point de terminaison cron.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration, y compris les paramètres de mise à l’échelle et de version des tâches du jour 2, se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Firefly III (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (l’`APP_KEY` de Laravel, le `STATIC_CRON_TOKEN` et
   le mot de passe de la base de données), un bucket Cloud Storage pour les téléversements, un volume NFS/Filestore pour
   les pièces jointes, et exécute un job ponctuel `db-init` (création du rôle et de la base de données). Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL représente l’essentiel du temps). Le schéma
   lui-même est créé au premier démarrage du conteneur, et non par un job de migration distinct.

3. Une fois le déploiement terminé, découvrez les ressources à l’aide de filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~fireflyiii" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Firefly III expose un point de terminaison `/status` non authentifié
   qui renvoie 200 dès que l’application est démarrée et connectée à PostgreSQL :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/status"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. À la première visite, Firefly III affiche la page **`/register`**.
   Saisissez votre adresse e-mail et un mot de passe, puis validez : le **premier compte créé
   devient le propriétaire/administrateur du site** ; aucun identifiant administrateur préinitialisé n’existe dans
   Secret Manager. Après l’avoir créé, ouvrez **Administration → Settings** et désactivez
   les inscriptions ultérieures pour empêcher toute création de compte non autorisée.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la
   page de détails du déploiement : le module est propriétaire de la spécification du service, la mise à l’échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de
   l’application suivante). Définissez `min_instance_count = 1` si vous voulez éviter les démarrages à froid.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version dans la plateforme RAD
   et en l’appliquant via **Update** ; une nouvelle révision est déployée et l’image migre elle-même
   le schéma au démarrage.

4. **Raccordez le point de terminaison cron** afin que les transactions récurrentes, les rappels de factures et
   les budgets automatiques se déclenchent. Lisez le jeton et déclenchez-le manuellement pour vérifier, puis créez un
   job Cloud Scheduler quotidien (ou utilisez le paramètre `cron_jobs`) :

   ```bash
   CRON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~cron-token" --format="value(name)" --limit=1)
   TOKEN=$(gcloud secrets versions access latest --secret="$CRON_SECRET" --project="$PROJECT")
   curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
   ```

5. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~fireflyiii"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

6. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. fireflyiiidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^fireflyiii" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** : depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** : ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise à l’échelle) et l’utilisation du processeur /
   de la mémoire. Si vous avez activé `uptime_check_config`, vérifiez qu’il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Firefly III à l’autre.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses
  journaux pour repérer des erreurs de démarrage, et vérifiez que les variables d’environnement et les secrets ont été résolus. La sonde de démarrage
  est en TCP sur le port 8080 et accorde une fenêtre généreuse au premier démarrage pendant l’exécution des migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe
  de la base existe et que le job `db-init` s’est terminé. Sur Cloud Run, la connexion
  se fait en TCP sur adresse IP privée avec `PGSQL_SSL_MODE = require` : un mode en clair/`disable` échoue.
- **Échec du job d’initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les transactions récurrentes ne se déclenchent pas :** vérifiez qu’un job Cloud Scheduler quotidien appelle
  `/api/v1/cron/<STATIC_CRON_TOKEN>` : Firefly n’effectue aucune planification de lui-même.
- **Les pièces jointes téléversées disparaissent :** vérifiez que `enable_nfs = true` et que le volume NFS
  est monté sur `/var/lib/fireflyiii` ; sinon, les fichiers atterrissent sur un disque éphémère.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle de ne jamais faire tourner `APP_KEY` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, le volume NFS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket de téléversements, NFS, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | `/status` renvoie 200 ; création du compte propriétaire sur `/register` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, raccorder le cron, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d’initialisation, de cron, de NFS et d’IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
