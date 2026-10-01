---
title: "Saleor sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Saleor sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Saleor_CloudRun.md @ 3055034 sha256:474d4e80e5dd -->

# Saleor sur Cloud Run — Guide de lab {#saleor-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

Saleor est une plateforme d'e-commerce headless open source, pensée d'abord pour GraphQL (catalogue
de produits, paiement de commande, commandes, plugins de paiement), construite sur Python/Django. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Saleor on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Saleor. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à l'API Saleor et au service Dashboard distinct, et les vérifier.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Saleor (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne deux services Cloud Run (l'API Saleor principale et un
   Dashboard distinct), une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret
   Manager (`SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`
   et le mot de passe de la base), un bucket Cloud Storage `media`, construit l'image
   de conteneur personnalisée et exécute deux jobs successifs d'initialisation de la base
   (`db-init` puis `db-migrate`). Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~saleor AND NOT metadata.name~dashboard" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   DASHBOARD=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~saleor AND metadata.name~dashboard" --format="value(metadata.name)" --limit=1)
   DASHBOARD_URL=$(gcloud run services describe "$DASHBOARD" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "API:       $SERVICE ($SERVICE_URL)"
   echo "Dashboard: $DASHBOARD ($DASHBOARD_URL)"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que l'API est saine :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health/"   # expect 200
   ```

2. Exécutez une véritable requête GraphQL pour confirmer que le schéma et le raccordement à la base de données fonctionnent
   de bout en bout :

   ```bash
   curl -s -X POST "$SERVICE_URL/graphql/" \
     -H 'Content-Type: application/json' \
     -d '{"query":"{ shop { name } }"}'
   ```

3. Récupérez l'identifiant du superutilisateur initial et connectez-vous via le Dashboard :

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~saleor-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   Ouvrez `$DASHBOARD_URL` dans un navigateur et connectez-vous avec `admin@example.com` et le
   mot de passe récupéré (la valeur par défaut de `SALEOR_SUPERUSER_EMAIL` — remplacez-la via
   `environment_variables` dans le fichier de raccordement avant le déploiement si une autre
   adresse est nécessaire).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service d'API et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application). `cpu_always_allocated = true` reste activé
   quel que soit le nombre d'instances — le worker Celery colocalisé a besoin d'un CPU
   continu sur chaque instance en cours d'exécution.

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (associée à
   l'ARG de build `SALEOR_VERSION`) et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~saleor"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, db-migrate, scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. saleordemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^saleor" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer), pour les deux services :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$DASHBOARD" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run de chaque service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de
   mise à l'échelle) et l'utilisation CPU / mémoire — le plancher CPU du service d'API reste
   non nul même entre les requêtes, car `cpu_always_allocated = true`. Le
   module peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Saleor.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/health/` avec un délai initial de 20 secondes et un seuil de
  20 échecs.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que `db-init` et `db-migrate` se sont tous deux terminés
  avec succès (dans l'ordre — `db-migrate` dépend de `db-init`).
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Une requête GraphQL échoue avec une erreur de base de données alors que l'API est Ready :**
  cela signifie généralement que `db-migrate` ne s'est pas terminé — consultez les journaux de son exécution avant
  de conclure à un bogue applicatif.
- **Le Dashboard se charge mais ne parvient pas à joindre l'API :** l'`API_URL` du Dashboard est intégrée
  à son bundle statique au démarrage du conteneur, à partir de l'URL *prévue* de l'API principale —
  si l'URL `run.app` réelle de l'API diffère (par exemple après un renommage du service), le
  Dashboard doit être reconstruit/redéployé pour prendre en compte l'URL corrigée.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle : ne jamais renouveler `RSA_PRIVATE_KEY` en dehors d'une
fenêtre de maintenance).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). La suppression retire tout ce que le module a créé — les deux services Cloud Run
(API et Dashboard), la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS
`media` et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, l'instance Cloud SQL partagée, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne deux services Cloud Run (API + Dashboard), Cloud SQL (PostgreSQL 15), les secrets et le bucket `media`, puis exécute `db-init` → `db-migrate` |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état et la requête GraphQL réussissent ; connexion au Dashboard avec l'identifiant administrateur initial |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring des deux services et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de liaison du Dashboard, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
