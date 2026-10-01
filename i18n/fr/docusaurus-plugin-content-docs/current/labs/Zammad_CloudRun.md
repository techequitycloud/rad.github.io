---
title: "Zammad sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Zammad sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Zammad_CloudRun.md @ 3055034 sha256:ed25717999ea -->

# Zammad sur Cloud Run — Guide de lab {#zammad-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Zammad_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Zammad est une plateforme open source de helpdesk et de gestion des tickets de support client. Ce lab
vous fait parcourir le cycle de vie opérationnel complet du module **Zammad on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Zammad. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Zammad_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Filestore NFS, Redis, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Zammad (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Zammad_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager, un partage Filestore NFS pour les pièces jointes des tickets, un
   bucket GCS et Redis, construit l'image de conteneur via Cloud Build et exécute un job
   ponctuel d'initialisation de la base de données. Le premier déploiement prend environ **20 à 40 minutes** (la création de Cloud
   SQL en représente l'essentiel ; les migrations de schéma de Zammad s'exécutent au premier démarrage du conteneur).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~zammad" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain et que Zammad a terminé sa migration de schéma :

   ```bash
   curl -s "$SERVICE_URL/api/v1/ping"   # expect {"pong":"PONG"}
   ```

   Si vous recevez une réponse autre que 200, attendez 60 à 90 secondes et réessayez — Zammad exécute ses
   migrations de base de données de manière synchrone au premier démarrage du conteneur, avant que le point de terminaison
   de santé ne devienne disponible.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Zammad affiche un assistant de configuration initiale lors de la
   première visite ; suivez-le pour créer le compte administrateur et définir le
   nom de l'organisation. Il n'existe aucun identifiant administrateur prégénéré — le compte administrateur
   est créé via l'assistant.

3. Récupérez le mot de passe de la base de données dans Secret Manager (utile pour un accès direct à la base) :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~zammad" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service, si bien que la mise à l'échelle est une modification de configuration, et non une
   modification manuelle avec `gcloud` (une modification manuelle serait annulée au prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée. Zammad applique automatiquement
   les migrations de schéma en attente au démarrage du conteneur.

4. **Gérez les secrets, les sauvegardes et les jobs d'initialisation :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~zammad"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~zammad"
   gcloud run jobs executions list --job="$(gcloud run jobs list \
     --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~db-init" --format="value(metadata.name)" --limit=1)" \
     --project="$PROJECT" --region="$REGION"
   ```

5. **Ouvrez une session sur la base de données** pour l'inspecter ou en assurer la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. zammaddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^zammad" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   Recherchez la ligne de journal `Zammad is running`, qui confirme que le railsserver a démarré
   correctement après la migration de schéma.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU
   et de la mémoire. Le module provisionne un **test de disponibilité** (uptime check) ciblant
   `/api/v1/ping` ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Zammad.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage de Zammad accorde jusqu'à environ 510 secondes à la migration
  de schéma ; si une révision est rejetée plus tôt, vérifiez les variables d'environnement et la résolution des secrets.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job d'initialisation `db-init` s'est terminé
  avec succès. Le point d'entrée personnalisé utilise `DB_IP` (l'IP privée de Cloud SQL) pour la vérification
  de disponibilité TCP — vérifiez qu'elle est correctement définie.
- **Redis indisponible :** Zammad a besoin de Redis pour ActionCable et Sidekiq ; si Redis
  est injoignable, le service ne démarre pas. Vérifiez `redis_host` et confirmez
  `vpc_egress_setting = "ALL_TRAFFIC"` si vous utilisez Memorystore.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  DBJOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~db-init" --format="value(metadata.name)" --limit=1)
  gcloud run jobs executions list --job="$DBJOB" --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, le partage Filestore NFS, le bucket GCS, les secrets Secret Manager et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, l'infrastructure
partagée) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), NFS, Redis, les secrets et un bucket GCS, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit sur `/api/v1/ping` ; terminer l'assistant de premier lancement pour créer le compte administrateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de Redis, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
