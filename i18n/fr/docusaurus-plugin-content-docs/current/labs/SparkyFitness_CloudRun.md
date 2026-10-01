---
title: "SparkyFitness sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez SparkyFitness sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/SparkyFitness_CloudRun.md @ 3055034 sha256:417f9a69c5ff -->

# SparkyFitness sur Cloud Run — Guide de lab {#sparkyfitness-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 75 minutes

SparkyFitness est un outil auto-hébergé de suivi familial de l'alimentation, de la forme physique, de l'hydratation et de la santé,
assisté par l'IA. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **SparkyFitness on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit SparkyFitness. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder à l'application en cours d'exécution et la vérifier, y compris son architecture à deux conteneurs.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la plateforme RAD, puis ouvrez **SparkyFitness (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne un **unique service Cloud Run multi-conteneur** (le frontend
   comme conteneur d'entrée, le backend comme sidecar dans le même pod), une base de données Cloud SQL (PostgreSQL
   15) avec ses secrets Secret Manager
   (`SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
   `SPARKY_FITNESS_APP_DB_PASSWORD` et le mot de passe de la base de données), et exécute un job ponctuel
   `db-init`. Les premiers déploiements prennent environ **15 à 25 minutes** (la création de Cloud SQL
   représente l'essentiel de ce temps). L'image du frontend (entrée) est préconstruite ; l'image du sidecar backend est
   construite par Cloud Build à partir de `SparkyFitness_Common/scripts/Dockerfile` (une fine
   surcouche corrigée pour SSL) et envoyée dans Artifact Registry.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~sparkyfitness" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le frontend (conteneur d'entrée) répond :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, inscrivez-vous pour créer le premier
   compte utilisateur — SparkyFitness ne dispose d'aucun identifiant administrateur prédéfini dans Secret
   Manager. `SPARKY_FITNESS_ADMIN_EMAIL` ne fait qu'ÉLEVER les privilèges d'un compte existant, il n'en
   crée pas ; l'inscription doit donc avoir lieu en premier.

3. Après avoir créé le compte, définissez `admin_email` sur l'adresse e-mail de cet utilisateur dans la plateforme
   RAD et cliquez sur **Update** pour lui accorder les privilèges d'administrateur. Envisagez ensuite de définir
   `disable_signup = true` afin d'empêcher toute nouvelle inscription ouverte.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service, ses révisions et ses deux conteneurs** (chaque déploiement crée
   une révision immuable contenant à la fois le conteneur frontend et le conteneur backend) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format='value(name)' --limit=1)" \
     --project="$PROJECT" --region="$REGION" --format='value(spec.containers[].name)'
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est maître de la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors du prochain apply).

3. **Mettez à jour l'étiquette de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update**. Elle étiquette À LA FOIS l'image du frontend et
   celle du backend de façon identique — utilisez exactement le format d'étiquette en amont (par ex. `v0.17.3`,
   et non `0.17.3` seul).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~sparkyfitness"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (connectez-vous avec le rôle
   administrateur — le rôle de niveau application est géré en interne par le backend) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. sparkyfitnessdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^sparkyfitness" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer. Les journaux des deux conteneurs arrivent dans le
   même flux, étiquetés par nom de conteneur :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer pour le seul sidecar backend :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>" AND labels."k8s-pod/app"="backend"`
   (vérifiez la clé de libellé exacte sur un exemple d'entrée de journal — l'étiquetage des journaux
   multi-conteneurs de Cloud Run peut varier selon la révision).

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Le module peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé,
   confirmez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de SparkyFitness.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage sur LES DEUX conteneurs.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs 502/504 sur les appels `/api/*` alors que le frontend se charge correctement :** le sidecar backend
  n'a probablement pas encore réussi sa vérification `startup_tcp_port` (ses migrations au premier démarrage
  peuvent prendre plus de temps que prévu), ou le sidecar a planté — consultez spécifiquement les journaux
  du conteneur backend.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job `db-init` s'est terminé avec succès. Vérifiez aussi
  que le backend peut effectivement joindre l'IP privée de Cloud SQL en TCP — le mécanisme
  `additional_containers`/`inherit_app_env` de Cloud Run injecte toujours l'IP brute
  (et non un socket Unix) pour un sidecar ; une instance Cloud SQL qui impose SSL
  peut donc nécessiter une investigation complémentaire.
- **Échec du job `db-init` :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner `BETTER_AUTH_SECRET` une fois que
des utilisateurs ont activé la 2FA).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec
l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL et les secrets Secret Manager. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un service Cloud Run multi-conteneur, Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le frontend renvoie 200 ; s'inscrire pour créer le premier compte, puis définir `admin_email` |
| 3 — Exploiter | Manuel | Inspecter les révisions et les conteneurs, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging pour les deux conteneurs ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de sidecar, de base de données, de job d'initialisation et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
