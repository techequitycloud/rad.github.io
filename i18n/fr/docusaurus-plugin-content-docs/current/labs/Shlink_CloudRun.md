---
title: "Shlink sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Shlink sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Shlink_CloudRun.md @ 3055034 sha256:d97d1e683ec3 -->

# Shlink sur Cloud Run — Guide de lab {#shlink-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Shlink est un raccourcisseur d'URL open source et auto-hébergé, doté d'analyses détaillées des visites et d'une API REST complète. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Shlink on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités de Shlink. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier via son point de terminaison de santé et son API REST.
- Récupérer la clé d'API générée automatiquement et créer votre première URL courte.
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
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Shlink (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (le mot de passe de la base de données ainsi que la clé
   `INITIAL_API_KEY` générée automatiquement), construit et met en miroir l'image de conteneur dans Artifact
   Registry, puis exécute un job ponctuel d'initialisation de la base de données. Shlink n'a besoin
   ni de partage NFS ni de bucket GCS — tout l'état réside dans PostgreSQL. Un premier déploiement prend
   environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~shlink" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. Le chemin de santé de Shlink est `/rest/health` — un
   point de terminaison sans authentification qui renvoie HTTP 200 avec `{"status":"pass",...}`.
   **Ne testez pas `/`** — Shlink est conçu d'abord comme une API et n'a pas de page d'accueil, si bien que le chemin racine
   renvoie 404 par conception. Avec la mise à l'échelle à zéro, prévoyez ~5–15 secondes pour que la première
   requête démarre une instance à froid :

   ```bash
   curl -s "$SERVICE_URL/rest/health"
   # {"status":"pass","version":"...","links":{...}}
   ```

2. Récupérez la clé d'API générée automatiquement dans Secret Manager et créez votre première
   URL courte via l'API REST :

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -X POST "$SERVICE_URL/rest/v3/short-urls" \
     -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"longUrl": "https://cloud.google.com/run"}'
   ```

   Ouvrez la `shortUrl` renvoyée dans un navigateur (ou avec `curl -I`) et vérifiez la
   redirection ; listez ensuite les visites enregistrées :

   ```bash
   curl -s "$SERVICE_URL/rest/v3/short-urls" -H "X-Api-Key: $API_KEY"
   ```

3. **Durcissement et configuration après déploiement :** définissez `DEFAULT_DOMAIN` (via le
   paramètre `environment_variables` et le flux **Update**) sur le nom d'hôte public du service
   afin que les URL courtes générées portent le bon hôte, et ajoutez éventuellement une
   `GEOLITE_LICENSE_KEY` pour activer la géolocalisation des visites. Pour disposer d'une interface navigateur, pointez le
   [shlink-web-client](https://app.shlink.io/) hébergé vers `$SERVICE_URL` avec votre
   clé d'API.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est opérationnelle) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). La
   valeur par défaut est la mise à l'échelle à zéro (`min = 0`) ; définissez `min = 1` pour éliminer le démarrage à froid
   lors de la première redirection après une période d'inactivité. Avant de porter `max_instance_count` nettement
   au-delà de 3, activez Redis pour le cache et le verrouillage partagés.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée. Shlink exécute automatiquement ses migrations de schéma au premier démarrage de la nouvelle révision.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~shlink"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (l'utilisateur de base de données
   propre au tenant figure dans les sorties du déploiement) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
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
   de requêtes, la latence des requêtes (P50/P95/P99 — la métrique la plus importante pour un
   service de redirection), le nombre d'instances (observez la mise à l'échelle à zéro en action entre
   les requêtes) et l'utilisation CPU / mémoire. Le module provisionne également un
   **test de disponibilité** (uptime check) ciblant `/rest/health` ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Shlink.

- **`/` renvoie 404 :** ce n'est pas une défaillance — Shlink n'a pas de page d'accueil web. Vérifiez la santé sur
  `/rest/health` et interagissez via `/rest/v3/...` avec l'en-tête `X-Api-Key`.
- **Révision non opérationnelle / le service ne répond pas :** la sonde de démarrage accorde jusqu'à
  ~300 secondes aux migrations de base de données du premier démarrage. Inspectez la dernière révision et
  ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le job `db-init` s'est terminé. Ne
  définissez jamais `DB_USER`/`DB_NAME` manuellement dans `environment_variables` — la fondation
  injecte des valeurs propres au tenant, et les remplacer provoque
  `password authentication failed`.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **401 sur les appels d'API :** l'en-tête `X-Api-Key` doit contenir la valeur du
  secret `initial-api-key` (ou d'une clé que vous avez créée avec celle-ci). Récupérez-la à nouveau dans Secret
  Manager comme dans la tâche 2.
- **Mauvais hôte dans les URL courtes générées :** définissez `DEFAULT_DOMAIN` sur le nom d'hôte
  public (voir la tâche 2, étape 3) — d'ici là, Shlink peut construire les URL courtes avec
  le mauvais domaine.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec ;
  l'image est une fine surcouche construite à partir de `shlinkio/shlink:stable` et mise en miroir
  dans Artifact Registry.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager (y compris la clé d'API initiale) et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL
partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15) et les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | `/rest/health` réussit ; première URL courte créée via l'API REST avec la clé d'amorçage |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de clé d'API, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
