---
title: "OpenProject sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer OpenProject sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OpenProject_CloudRun.md @ 3055034 sha256:b8f68a34d2e1 -->

# OpenProject sur Cloud Run — Guide de lab {#openproject-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

OpenProject est une suite open source de gestion de projet et de collaboration — lots de
travail, diagrammes de Gantt, tableaux agiles, wikis, suivi du temps et budgets. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **OpenProject on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit OpenProject. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris le changement de mot de passe lors de la première connexion.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **OpenProject (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY_BASE` et le mot de passe de la base
   de données), une instance NFS Cloud Filestore pour le stockage des pièces jointes, construit
   l'image du conteneur et exécute les deux jobs d'initialisation — `db-init` (rôle +
   base de données) puis `db-migrate` (`rake db:migrate db:seed`, qui construit le schéma
   et crée l'administrateur par défaut). Les premiers déploiements prennent environ **25–40 minutes**
   (la création de Cloud SQL et l'amorçage des migrations en représentent l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~openproject" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. OpenProject expose
   un point de terminaison de santé qui ne répond que lorsque Rails est entièrement initialisé et que
   PostgreSQL est joignable (interrogez-le sur l'URL du service afin que l'en-tête `Host` soit
   accepté par la Host Authorization de Rails) :

   ```bash
   curl -s "$SERVICE_URL/health_checks/default"   # expect "PASSED" / HTTP 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Connectez-vous avec les identifiants créés à l'amorçage
   **`admin` / `admin`** — OpenProject vous oblige immédiatement à définir un nouveau mot de passe
   administrateur. Choisissez-en un robuste et conservez-le dans votre gestionnaire de mots de passe. Ensuite,
   créez votre premier projet et vérifiez que les lots de travail, le wiki et les pièces jointes
   fonctionnent (les pièces jointes sont écrites sur le montage NFS).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Notez
   qu'OpenProject conserve par défaut `cpu_always_allocated = true` et `min_instance_count = 1`
   afin que le worker `good_job` intégré au processus et les jobs cron continuent de s'exécuter entre
   les requêtes.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite, le job `db-migrate` exécute les éventuelles
   nouvelles migrations, et une nouvelle révision est déployée. OpenProject ne publie que des tags
   de version majeure numériques — fixez une version majeure précise (par exemple `16`) plutôt que `latest`.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~openproject"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, db-migrate, backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. openprojectdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^openproject" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez
   qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OpenProject.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage est de type **TCP** (écoute du port par Puma) — une sonde HTTP échouerait à la Host
  Authorization de Rails ; ne la passez donc pas en HTTP.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **« You have N pending migrations » dans les journaux :** le job `db-migrate` ne s'est pas terminé.
  Listez ses exécutions et lisez les journaux de celle qui a échoué — le job de migration
  s'auto-vérifie : un véritable échec fait donc échouer l'application bruyamment au lieu de livrer une
  base de données vide.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs de connexion à la base de données (`connection refused` / `SSL required`) :** vérifiez que
  l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base existe et — comme
  Cloud Run se connecte en **TCP sur IP privée avec `sslmode=require`** — que
  `enable_cloudsql_volume` reste à sa valeur par défaut `false` (activer le socket casse
  le DSN d'URL de Rails).
- **Les pièces jointes disparaissent après un redéploiement :** vérifiez que `enable_nfs = true` et que
  l'instance Filestore est en bonne santé — sans NFS, les pièces jointes sont écrites sur un disque éphémère.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais renouveler `SECRET_KEY_BASE` après le premier
démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, l'instance Filestore et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, Filestore, et exécute `db-init` + `db-migrate` |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; se connecter en tant que `admin`/`admin` et définir un nouveau mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de migration, de base de données, de NFS, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
