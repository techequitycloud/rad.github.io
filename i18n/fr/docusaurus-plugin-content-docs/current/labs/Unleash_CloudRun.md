---
title: "Unleash sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Unleash sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Unleash_CloudRun.md @ 3055034 sha256:4079e5b626cf -->

# Unleash sur Cloud Run — Guide de lab {#unleash-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Unleash_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Unleash est une plateforme open source de gestion de feature flags et de bascules (toggles) pour la livraison
progressive, les tests A/B et les déploiements graduels, pilotée par une API REST et une interface d'administration. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Unleash on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, créer et évaluer un feature
flag, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Unleash. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Unleash_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter à l'interface d'administration.
- Créer un feature flag et l'évaluer via l'API Unleash à l'aide d'un jeton.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Unleash (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Unleash_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (le jeton d'API administrateur d'amorçage et le
   mot de passe de la base de données), construit l'image du conteneur et exécute un job ponctuel
   d'initialisation de la base de données qui crée la base de données et l'utilisateur `unleash`. Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~unleash" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. Unleash expose un
   point de terminaison de santé public qui ne renvoie 200 que lorsque le serveur est entièrement initialisé
   et que PostgreSQL est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Connectez-vous à l'interface d'administration avec les identifiants
   de premier lancement bien connus **`admin` / `unleash4all`** et **changez immédiatement le
   mot de passe** sous **Admin → Users**.

---

## Tâche 3 — Exemple guidé : créer et évaluer un feature flag [Manuel] {#task-3--worked-example-create-and-evaluate-a-feature-flag-manual}

Unleash stocke chaque flag dans PostgreSQL et l'évalue via son API. Cette tâche
crée un flag et l'évalue avec un jeton d'API — le même flux que celui qu'utilise un SDK
applicatif.

1. **Récupérez le jeton d'API administrateur d'amorçage** que le module a placé dans Secret Manager.
   Il dispose de droits administrateur complets (`*:*`) :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-token" --format="value(name)" --limit=1)
   ADMIN_TOKEN=$(gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT")
   echo "Admin token: $ADMIN_TOKEN"
   ```

2. **Créez un feature flag** dans le projet `default` via l'API Admin (ou faites-le dans
   l'interface sous **Projects → default → New feature flag**) :

   ```bash
   curl -s -X POST "$SERVICE_URL/api/admin/projects/default/features" \
     -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"welcome-banner","type":"release"}'
   ```

3. **Activez le flag** dans l'environnement `development` :

   ```bash
   curl -s -X POST \
     "$SERVICE_URL/api/admin/projects/default/features/welcome-banner/environments/development/on" \
     -H "Authorization: $ADMIN_TOKEN"
   ```

4. **Créez un jeton d'API client** limité à l'environnement `development` — c'est
   l'identifiant qu'utiliserait un SDK (ne distribuez jamais le jeton administrateur aux clients) :

   ```bash
   curl -s -X POST "$SERVICE_URL/api/admin/api-tokens" \
     -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"tokenName":"lab-client","type":"client","environment":"development","projects":["default"]}'
   # copy the "secret" field from the response into CLIENT_TOKEN:
   export CLIENT_TOKEN="<secret-from-response>"
   ```

5. **Évaluez le flag via l'API** à l'aide du jeton client — la Client API renvoie
   les définitions de flags qu'un SDK évalue par rapport à son contexte :

   ```bash
   curl -s "$SERVICE_URL/api/client/features" -H "Authorization: $CLIENT_TOKEN" \
     | python3 -c "import sys,json; [print(f['name'], f['enabled']) for f in json.load(sys.stdin)['features']]"
   # expect: welcome-banner True
   ```

   Vous avez maintenant créé un flag et l'avez évalué par le même chemin d'API que celui qu'utiliseront
   vos applications.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Unleash est
   sans état : n'importe quelle instance peut traiter n'importe quelle requête — la mise à l'échelle horizontale ne nécessite ni Redis ni
   affinité de session.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   Unleash applique les éventuelles migrations de schéma au démarrage.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~unleash"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. unleashdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^unleash" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ciblant
   `/health` ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez
   Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Unleash.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/health` et laisse une marge confortable pour les migrations du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job d'initialisation s'est terminé avec succès. Vérifiez
  les valeurs `DATABASE_URL`/`DB_*` injectées dans la révision en cours d'exécution :
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment conserver les chemins des sondes sur `/health` et ne jamais activer IAP lorsque des clients SDK
doivent atteindre l'API directement).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; se connecter à l'interface d'administration en tant que `admin` / `unleash4all` |
| 3 — Exemple guidé | Manuel | Créer un feature flag et l'évaluer via l'API Unleash à l'aide d'un jeton |
| 4 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 5 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 7 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
