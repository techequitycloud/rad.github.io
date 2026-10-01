---
title: "Hasura sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Hasura sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Hasura_CloudRun.md @ 3055034 sha256:3e321c044e26 -->

# Hasura sur Cloud Run — Guide de lab {#hasura-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Hasura est un moteur open source qui vous fournit instantanément une API GraphQL et REST
en temps réel sur une base de données PostgreSQL, avec une autorisation basée sur les rôles et une console
d'administration intégrée. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Hasura on
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, ouvrir la console
et exécuter une requête GraphQL, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur le fonctionnement interne du produit Hasura. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Récupérer le secret d'administration et ouvrir la console Hasura.
- Suivre (track) une table et exécuter une requête GraphQL de bout en bout.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Hasura (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`HASURA_GRAPHQL_ADMIN_SECRET` et le mot de passe
   de la base de données), construit l'image du conteneur (une fine surcouche de `hasura/graphql-engine`)
   et exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~hasura" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. Hasura expose un
   point de terminaison de santé public qui ne renvoie 200 que lorsque le moteur est démarré et connecté à
   PostgreSQL :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/healthz"   # expect 200
   ```

2. Récupérez le secret d'administration dans Secret Manager — vous en avez besoin pour la console et pour
   chaque appel aux API GraphQL/de métadonnées :

   ```bash
   ADMIN_SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-secret" --format="value(name)" --limit=1)
   ADMIN=$(gcloud secrets versions access latest --secret="$ADMIN_SECRET_NAME" --project="$PROJECT")
   echo "Admin secret: $ADMIN"
   ```

3. Ouvrez `$SERVICE_URL/console` dans un navigateur. Hasura vous demande le secret d'administration —
   collez la valeur obtenue à l'étape 2. La console s'ouvre sur l'onglet **Data**, connectée à
   votre base de données Cloud SQL (la source `default`).

---

## Tâche 3 — Exemple guidé : suivre une table et exécuter une requête GraphQL [Manuel] {#task-3--worked-example-track-a-table-and-run-a-graphql-query-manual}

1. **Créez une table.** Dans la console, allez dans **Data → default → public → Create Table**.
   Nommez-la `todos` avec les colonnes `id` (Integer, auto-incrément, clé primaire) et
   `title` (Text). Cliquez sur **Add Table**. (Vous préférez le SQL ? Ouvrez **Data → SQL**, exécutez
   `CREATE TABLE todos (id serial primary key, title text);` et cochez
   *Track this table*.)

2. **Suivez la table.** Si vous l'avez créée via SQL, Hasura la liste sous
   *Untracked tables* — cliquez sur **Track**. C'est le suivi qui expose la table via
   l'API GraphQL ; il écrit une entrée dans le catalogue de métadonnées de Hasura (stocké dans Postgres,
   il survit donc aux révisions et aux redémarrages).

3. **Insérez une ligne** via l'API (en utilisant le secret d'administration comme en-tête
   `x-hasura-admin-secret`) :

   ```bash
   curl -s "$SERVICE_URL/v1/graphql" \
     -H "x-hasura-admin-secret: $ADMIN" \
     -H 'Content-Type: application/json' \
     -d '{"query":"mutation { insert_todos_one(object: {title: \"Ship the docs\"}) { id title } }"}'
   ```

4. **Exécutez une requête GraphQL** pour la relire :

   ```bash
   curl -s "$SERVICE_URL/v1/graphql" \
     -H "x-hasura-admin-secret: $ADMIN" \
     -H 'Content-Type: application/json' \
     -d '{"query":"query { todos { id title } }"}'
   # => {"data":{"todos":[{"id":1,"title":"Ship the docs"}]}}
   ```

   Vous pouvez aussi exécuter la même requête de manière interactive dans l'onglet **API** (GraphiQL)
   de la console — il envoie l'en-tête du secret d'administration pour vous.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de
   la prochaine application). Hasura se met à l'échelle horizontalement sans risque car tout l'état réside dans Postgres ;
   définissez `min_instance_count = 1` pour supprimer la latence de démarrage à froid d'une
   API sensible à la latence.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   Les métadonnées de vos tables suivies sont conservées dans la base de données lors de la mise à niveau.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~hasura"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. hasurademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^hasura" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^hasura" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
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
   l'utilisation du CPU / de la mémoire. Le module peut provisionner un **test de disponibilité** (uptime check) (lorsqu'il
   est activé) ciblant `/healthz` ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Hasura.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que le DSN a été assemblé. La sonde de démarrage cible
  `/healthz` ; un échec de connexion à la base de données empêche la révision de devenir Ready.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`/console` ou `/v1/graphql` renvoie 401 :** le secret d'administration est manquant ou mal
  transmis. Récupérez-le à nouveau (tâche 2, étape 2) et envoyez-le en tant que `x-hasura-admin-secret`. Ne
  pointez jamais les sondes de santé vers ces chemins — utilisez `/healthz`.
- **Erreurs de connexion à la base de données** (`connection refused`, `no pg_hba entry`) : vérifiez que
  l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base existe et que le
  job d'initialisation s'est terminé. Sur Cloud Run, le DSN utilise la forme socket ; une image `prebuilt`
  contourne le point d'entrée et n'a aucun DSN.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment garder les sondes sur `/healthz` et ne jamais exposer le secret d'administration).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; récupérer le secret d'administration ; ouvrir la console |
| 3 — Exemple guidé | Manuel | Suivre une table et exécuter une insertion + une requête GraphQL de bout en bout |
| 4 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 5 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'authentification (401), de base de données, de job d'initialisation, de build et d'IAM |
| 7 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
