---
title: "Planka sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Planka sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Planka_CloudRun.md @ 3055034 sha256:ec4d160a2dbe -->

# Planka sur Cloud Run — Guide de lab {#planka-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Planka_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Planka est une application open source et auto-hébergée de tableaux kanban, à la manière de Trello,
pour la gestion de projets d'équipe et personnels. Ce lab vous fait parcourir l'intégralité du cycle de vie
opérationnel du module **Planka on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Planka. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Planka_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier, et vous connecter avec l'identifiant administrateur généré.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les sauvegardes.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Planka (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Planka_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image Planka personnalisée (une fine surcouche `FROM
   ghcr.io/plankanban/planka`), provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL 15) avec son secret de mot de passe dans Secret Manager, les secrets
   `SECRET_KEY` et `DEFAULT_ADMIN_PASSWORD`, un bucket GCS `storage`,
   et exécute une tâche ponctuelle d'initialisation de la base de données. Les premiers déploiements prennent
   environ **15–25 minutes** (le build de l'image par Cloud Build et la création de Cloud SQL
   en représentent l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~planka" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et répond :

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Récupérez le mot de passe administrateur généré — contrairement à un identifiant par défaut fixe
   et publiquement connu, le `DEFAULT_ADMIN_PASSWORD` de Planka est un véritable secret
   généré pour chaque déploiement :

   ```bash
   PASSWORD_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~planka AND name~default-admin-password" \
     --format="value(name)" | head -1)
   gcloud secrets versions access latest --secret="$PASSWORD_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec `admin@example.com` et
   le mot de passe récupéré ci-dessus. **Planka n'impose pas de réinitialisation du mot de passe lors de
   la première connexion** — changez le mot de passe immédiatement dans les paramètres de compte
   de Planka, car cet identifiant est un véritable secret qu'il vaut la peine de renouveler par rapport à la
   valeur initiale du déploiement. Créez ensuite un tableau, une liste et une carte pour confirmer
   le chemin d'écriture vers la base de données.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — Planka ne pose aucun problème de coordination entre instances
   (ni cache, ni file d'attente ; les mises à jour en temps réel passent par Socket.io, propre à chaque instance) ;
   augmenter `max_instance_count` est donc sans risque.

3. **Mettez à jour le tag de version de l'application** via le flux **Update** de la plateforme RAD
   — cela relance le build de l'image personnalisée avec le nouvel ARG de build
   `PLANKA_VERSION`.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~planka"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. plankademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^planka" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Repérez la ligne `[cloud-entrypoint]` — elle indique quel mode de connexion `DATABASE_URL`
   le point d'entrée a résolu (socket non pris en charge/IP privée,
   loopback ou IP privée directe) ainsi que le `BASE_URL` dérivé.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence, le nombre d'instances et l'utilisation du CPU/de la mémoire. Le
   module peut provisionner un **test de disponibilité** (uptime check) (désactivé par défaut) ; s'il est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision
  et ses journaux.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
  Si la révision ne devient jamais Ready, vérifiez le chemin configuré de la sonde de démarrage
  — la cible de vérification d'état propre à Planka est le chemin racine `/`, mais les variables
  `startup_probe`/`liveness_probe` de ce module ont actuellement pour valeur par défaut
  `/api/status`. Si les sondes échouent, remplacez le chemin par `/` et
  redéployez.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que la tâche d'initialisation
  s'est terminée. Recherchez dans les journaux du conteneur la ligne `[cloud-entrypoint]`
  indiquant quel mode `DATABASE_URL` a été résolu.
- **Échec de la tâche d'initialisation :**
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" --project="$PROJECT" --region="$REGION"
  ```
- **Impossible de se connecter avec l'identifiant administrateur :** `DEFAULT_ADMIN_PASSWORD` ne
  crée le compte que lors du *premier* démarrage (base de données vide) — si la base de données
  était déjà initialisée, ou si le mot de passe a déjà été changé, la valeur initiale
  ne fonctionne plus ; utilisez plutôt le flux de récupération de mot de passe propre à Planka (ou
  reconnectez-vous directement à la base de données).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. Delete supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, le bucket
GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, un bucket GCS, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit ; se connecter avec l'identifiant administrateur généré et créer un tableau |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
