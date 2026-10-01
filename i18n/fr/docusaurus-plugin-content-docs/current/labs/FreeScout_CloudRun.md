---
title: "FreeScout sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez FreeScout sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/FreeScout_CloudRun.md @ 3055034 sha256:52a723ff50e7 -->

# FreeScout sur Cloud Run — Guide de lab {#freescout-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

FreeScout est une plateforme gratuite et auto-hébergée de help desk et de boîte
mail partagée, construite sur Laravel (PHP) — elle transforme des boîtes de
réception partagées en une file de tickets collaborative avec conversations,
étiquettes, réponses enregistrées et une API REST. Ce lab vous fait parcourir
l'ensemble du cycle de vie opérationnel du module **FreeScout on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants, puis le démonter.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit FreeScout. Pour la liste
complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez
le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le compte administrateur créé automatiquement au premier lancement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **FreeScout (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FreeScout_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   for **MySQL 8.0** avec ses secrets Secret Manager (la clé Laravel `APP_KEY`,
   le mot de passe `ADMIN_PASS` initial et le mot de passe de la base de
   données), un montage NFS Filestore pour les pièces jointes (activé par
   défaut), un bucket Cloud Storage pour les fichiers téléversés, construit
   l'image de conteneur personnalisée minimale (`FROM tiredofit/freescout`) et
   exécute un job ponctuel d'initialisation de la base de données. Les
   premiers déploiements prennent environ **20–35 minutes** (la création de
   Cloud SQL représente l'essentiel de ce temps).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres
   indépendants des noms (afin que les commandes continuent de fonctionner quel
   que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~freescout" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service répond. FreeScout ne dispose pas de point de
   terminaison de santé JSON dédié — un service en bonne santé renvoie la page
   de connexion (HTTP 200) ou une redirection vers celle-ci sur `GET /` :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200 (or 302 to login)
   ```

2. FreeScout crée automatiquement un administrateur au premier lancement — il
   n'y a aucune étape d'inscription manuelle. Récupérez le mot de passe
   administrateur généré dans Secret Manager et connectez-vous avec l'adresse
   `ADMIN_EMAIL` par défaut (`admin@techequity.cloud` sauf si elle a été
   remplacée) :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freescout AND name~admin" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec cette adresse
   e-mail et ce mot de passe. **Changez immédiatement le mot de passe dans
   l'interface** — la valeur générée n'existe que dans Secret Manager, et cette
   modification côté application vous donne un identifiant détenu par une
   personne.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances et en cliquant sur **Update** sur la page de détails du
   déploiement — le module est propriétaire de la spécification du service : la
   mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors du prochain apply). FreeScout utilise par défaut
   `min_instance_count = 0` (mise à l'échelle jusqu'à zéro ; les démarrages à
   froid ajoutent plusieurs secondes) et `max_instance_count = 1` — conservez
   le maximum à 1 tant que la gestion du stockage partagé et des sessions entre
   instances n'a pas été confirmée comme sûre.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et le point d'entrée `tiredofit/freescout`
   exécute `php artisan migrate --force` au démarrage suivant du conteneur : les
   modifications de schéma s'appliquent donc automatiquement au démarrage.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~freescout"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + any scheduled backup jobs
   ```

   **Ne faites jamais tourner le secret `APP_KEY` après le premier démarrage** —
   il chiffre les données de session et des colonnes chiffrées de la base de
   données (identifiants de boîtes mail stockés, jetons OAuth) ; le faire
   tourner invalide définitivement toutes les données chiffrées auparavant.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~freescout" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. freescoutdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freescout" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du
   processeur et de la mémoire. Le module peut provisionner un **test de
   disponibilité** (uptime check) (lorsqu'il est activé) ; vérifiez qu'il est
   au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de FreeScout à l'autre.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage. La sonde de
  démarrage est une sonde TCP sur le port du conteneur (délai de 30 s,
  20 échecs) et la sonde de vivacité est une requête HTTP `GET /` (délai
  initial de 300 s) — prévoyez plusieurs minutes lors du premier démarrage,
  pendant l'exécution des migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échecs de migration au démarrage :** `php artisan migrate --force`
  s'exécute à chaque démarrage du conteneur (il n'existe pas de job de
  migration distincte) ; une migration en échec se manifeste par une boucle de
  plantage sur la révision la plus récente — lisez les journaux du conteneur
  ci-dessus pour trouver l'erreur Laravel/PDO.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE` et joignable — Cloud Run s'y connecte via l'**adresse IP
  privée de l'instance sur le port TCP 3306** (`enable_cloudsql_volume = false`
  par défaut), et non via un socket Unix.
- **Échec du job db-init :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Pièces jointes / fichiers téléversés qui disparaissent :** vérifiez que
  `enable_nfs = true` (la valeur par défaut) — sans NFS, les fichiers
  téléversés ne survivent pas au recyclage des conteneurs ni à la mise à
  l'échelle jusqu'à zéro.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment la règle essentielle de ne
jamais faire tourner `APP_KEY`
après le premier démarrage, et la raison pour laquelle `database_type` doit rester `MYSQL_8_0`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), le NFS Filestore, les secrets et un bucket de stockage, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; se connecter avec le compte administrateur créé automatiquement et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes (ne jamais faire tourner `APP_KEY`), accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de migration, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
