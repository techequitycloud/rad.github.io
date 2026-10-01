---
title: "Coder sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Coder sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Coder_CloudRun.md @ 3055034 sha256:a46c14078da4 -->

# Coder sur Cloud Run — Guide de lab {#coder-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Coder est une plateforme open source et auto-hébergée de provisionnement d'environnements de développement distants (espaces de travail) définis en tant que code avec Terraform. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Coder on Cloud Run** sur Google Cloud : déployer le plan de contrôle, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Coder telles que les templates et les espaces de travail. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au plan de contrôle Coder, créer le premier compte administrateur et vérifier la santé du service.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Coder (Cloud Run)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec son secret de mot de passe dans Secret Manager, un bucket GCS dédié, réplique
   l'image de base `ghcr.io/coder/coder` dans Artifact Registry, construit l'image
   au point d'entrée personnalisé avec Cloud Build et exécute un job ponctuel d'initialisation de la base de données.
   Coder applique ses propres migrations de schéma au premier démarrage du serveur. Les premiers déploiements prennent
   environ **20–35 minutes** (la création de Cloud SQL domine).

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~coder" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Coder expose un point de terminaison de santé non authentifié sur
   `/healthz` (HTTP 200 dès que le serveur est opérationnel — prévoyez une ou deux minutes sur un
   nouveau déploiement, le temps que les migrations de schéma du premier démarrage s'exécutent) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"
   curl -s "$SERVICE_URL/api/v2/buildinfo"     # returns the deployed Coder version
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier démarrage, Coder affiche la **page de configuration**
   — créez le compte administrateur (propriétaire) initial avec votre nom, votre e-mail et votre mot de passe.
   **Faites-le rapidement** : la page de configuration est joignable publiquement tant que le premier compte
   n'existe pas. Le mot de passe de la base de données (la seule information d'identification stockée dans Secret Manager) peut
   être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~coder" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. **Durcissement après déploiement et étapes suivantes :** envisagez de placer IAP ou
   Cloud Armor devant le service pour une équipe privée, et notez que l'exécution de véritables espaces de travail nécessite une
   étape du jour 2 — créer un template Coder (Terraform) pointant vers une cible de calcul telle
   qu'un cluster GKE ou des VM GCE, et fournir au provisionneur les identifiants correspondants. Le
   plan de contrôle seul n'exécute aucun espace de travail.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service ; la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle avec `gcloud` (une modification manuelle serait annulée lors du prochain apply).
   Conservez `min_instance_count >= 1` et `cpu_always_allocated = true` : les démons
   provisionneurs intégrés au processus de Coder interrogent PostgreSQL pour détecter les builds d'espaces de travail en attente, et
   la réduction à zéro ou la limitation du CPU les bloquent silencieusement.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur
   la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.
   Les tags de Coder sont préfixés selon semver (par ex. `v2.24.1`) ; le module associe `latest` à un
   tag fixé. Les migrations de schéma s'exécutent automatiquement au premier démarrage de la nouvelle révision.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~coder"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~coder"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (PostgreSQL) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. coderdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^coder" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^coder" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Le point d'entrée personnalisé journalise
   l'hôte PostgreSQL résolu et l'URL d'accès à chaque démarrage :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (qui doit rester stable au
   minimum maintenu à chaud) et l'utilisation du CPU et de la mémoire. Si vous avez activé `uptime_check_config`,
   vérifiez que le test est au vert dans Monitoring → Uptime checks, et consultez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Coder.

- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage cible `/healthz`
  avec un délai initial de 60 secondes et un seuil d'échec généreux pour couvrir la migration de
  schéma du premier démarrage. Inspectez la dernière révision et ses journaux avant de conclure que le
  service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le job `db-init` s'est terminé. La
  ligne de journal du point d'entrée `PG host: <ip> (sslmode=require)` indique ce qu'il a résolu — une
  erreur d'analyse d'URL dans les journaux signifie qu'un remplacement explicite de `CODER_PG_CONNECTION_URL` est
  mal formé (l'URL assemblée par le module encode automatiquement le mot de passe en pourcentage).
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
  `container_image_source` doit valoir `custom` — l'image Coder amont ne contient pas
  le point d'entrée qui assemble l'URL de connexion à la base de données et l'URL d'accès. Un
  `MANIFEST_UNKNOWN` sur l'image de base signifie un tag de version inexistant — les tags de Coder
  sont préfixés selon semver (`vX.Y.Z`).
- **Builds d'espaces de travail en file d'attente mais jamais lancés :** c'est le piège propre à Coder. Les
  démons provisionneurs s'exécutent *à l'intérieur* de `coder server` et interrogent la base de données — si le
  service a été réduit à zéro (`min_instance_count = 0`) ou basculé vers une facturation
  à la requête (`cpu_always_allocated = false`), ils se bloquent entre les requêtes. Rétablissez les
  valeurs par défaut (`min = 1`, CPU toujours alloué) via le parcours Update de RAD. Vérifiez aussi que
  `CODER_ACCESS_URL` correspond à l'URL réellement utilisée par les développeurs — une incohérence rompt
  les connexions des agents d'espaces de travail.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry.
Les ressources détenues par **Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), un bucket GCS, les secrets, construit l'image et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | `/healthz` renvoie 200 ; créer le premier compte administrateur (propriétaire) |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (conserver min=1/toujours actif), mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build, de provisionneur bloqué et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
