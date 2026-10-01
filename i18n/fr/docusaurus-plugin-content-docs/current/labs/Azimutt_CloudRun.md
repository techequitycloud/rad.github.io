---
title: "Azimutt sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Azimutt sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Azimutt_CloudRun.md @ 3055034 sha256:f4b97258aef4 -->

# Azimutt sur Cloud Run — Guide de lab {#azimutt-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Azimutt est un outil open source de nouvelle génération pour explorer les schémas de bases de données et
produire des ERD (diagrammes entité-association) sur des bases de données réelles, construit avec
Elixir/Phoenix. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Azimutt on Cloud Run** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Azimutt. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et créer le premier compte Azimutt.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Azimutt (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY_BASE` et le mot de passe de la base
   de données), un bucket Cloud Storage, construit l'image de conteneur (une fine surcouche
   FROM `ghcr.io/azimuttapp/azimutt`) et exécute un job ponctuel d'initialisation de la base de données
   qui crée le rôle et la base de données de l'application. Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~azimutt" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain et connecté à sa base de données. Azimutt n'a pas de
   point de terminaison JSON de santé dédié — les sondes de démarrage et de disponibilité ciblent la
   racine Phoenix `/`, qui ne renvoie `200` qu'une fois le serveur démarré,
   ses migrations appliquées et la connexion à Postgres établie :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, Azimutt affiche sa page
   d'inscription — aucun identifiant administrateur pré-créé n'existe dans Secret Manager. Créez votre
   premier compte avec une adresse e-mail et un mot de passe. L'inscription est **ouverte par défaut** ; après
   avoir créé votre compte, restreignez donc les accès ultérieurs (domaine personnalisé + IAP, ou
   les paramètres d'authentification propres à Azimutt via `environment_variables`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service ; la mise à l'échelle est donc
   une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). Contrairement aux applications dotées d'une file de tâches en mémoire, Azimutt
   utilise PostgreSQL (Oban) pour le travail en arrière-plan ; passer à plus d'une instance
   ne nécessite donc pas de Redis. Notez que `min_instance_count = 0` (la valeur par défaut) active
   la réduction à zéro ; définissez `1` pour éviter les quelques secondes de latence de démarrage à froid après
   une période d'inactivité.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. Les migrations s'exécutent automatiquement à chaque démarrage
   (`/app/bin/migrate && /app/bin/server`) ; une mise à niveau applique donc ses modifications de schéma
   au démarrage — prévoyez du temps supplémentaire lors du premier démarrage après un changement de version.
   Azimutt ne publie pas d'étiquette `:latest` (`application_version = "latest"` correspond à
   son étiquette `main`) ; figez une version précise en production.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~azimutt"
   ```

   Ne faites jamais de rotation de `SECRET_KEY_BASE` en dehors d'une fenêtre de maintenance — sa rotation
   invalide tous les cookies de session actifs et déconnecte tous les utilisateurs.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. azimuttdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^azimutt" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^azimutt" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

6. **Les fichiers téléversés sont éphémères par défaut.** Avec la valeur par défaut
   `FILE_STORAGE_ADAPTER = local`, les fichiers téléversés sont écrits sur le disque local du conteneur,
   et non dans le bucket Cloud Storage provisionné — ils ne survivent ni à un
   redéploiement ni à un démarrage à froid après réduction à zéro. Les données des projets elles-mêmes (schémas,
   diagrammes, mises en page, utilisateurs) sont conservées en toute sécurité dans Postgres.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer. Les lignes `cloud-entrypoint`
   indiquent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT` :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Le module peut provisionner un **test de disponibilité** (lorsqu'il est
   activé) ; confirmez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Azimutt.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et confirmez que les variables d'environnement et les secrets ont été résolus. La
  sonde de démarrage cible `/` avec un délai initial de 60 secondes — prévoyez environ 1 à 2 minutes
  au premier démarrage pour que les migrations se terminent avant que le point de terminaison ne soit disponible.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`.
  Azimutt se connecte via l'**adresse IP privée de l'instance avec SSL**
  (`DATABASE_ENABLE_SSL=true`) — Ecto/postgrex ne sait pas analyser le DSN de socket Cloud SQL ;
  le montage du socket (`enable_cloudsql_volume = true`) n'existe donc que pour
  le job `db-init`, et non pour l'application en cours d'exécution.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec
  — l'étiquette de base provient de l'argument de build `AZIMUTT_VERSION` (`latest` correspond à
  `main`).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire de rotation de
`SECRET_KEY_BASE` après le premier démarrage, et la raison pour laquelle `db_name`/`db_user` sont immuables
après le premier déploiement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé (`/`) réussit ; création du premier compte Azimutt dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
