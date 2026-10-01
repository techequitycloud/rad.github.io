---
title: "LangFlow sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer LangFlow sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/LangFlow_CloudRun.md @ 3055034 sha256:9c393e1c2e9a -->

# LangFlow sur Cloud Run — Guide de lab {#langflow-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

LangFlow est un outil visuel open source et low-code de création d'agents et de workflows d'IA,
construit sur LangChain — vous assemblez des chaînes de modèles de langage, des pipelines RAG et des agents en
faisant glisser et en reliant des composants sur un canevas, puis vous les exposez sous forme d'API. Ce lab vous fait
parcourir l'intégralité du cycle de vie opérationnel du module **LangFlow on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit LangFlow. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **LangFlow (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`LANGFLOW_SECRET_KEY`,
   `LANGFLOW_SUPERUSER_PASSWORD` et le mot de passe de la base de données), un bucket Cloud Storage `data`,
   construit l'image du conteneur et exécute un job ponctuel d'initialisation de la base de données
   qui crée le rôle applicatif, la base de données et les droits. Les premiers déploiements prennent
   environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel), et le premier démarrage
   du conteneur exécute également les migrations Alembic propres à LangFlow ainsi que le chargement des composants (2–4
   minutes) avant que le service soit en bonne santé.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~langflow" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. LangFlow expose un point de terminaison de liveness public qui
   renvoie `200` dès que le serveur est entièrement démarré (après le chargement des composants et les migrations
   Alembic) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Récupérez le mot de passe administrateur généré automatiquement depuis Secret Manager, puis ouvrez
   `$SERVICE_URL` dans un navigateur et connectez-vous en tant que `admin` (ou avec la valeur que vous avez définie pour
   `langflow_username`) avec ce mot de passe — l'authentification de LangFlow est activée
   par défaut (`LANGFLOW_AUTO_LOGIN = "false"`), il n'y a donc pas d'étape d'inscription ouverte :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~langflow AND name~superuser" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors de la prochaine application). Conservez `max_instance_count = 1` : LangFlow conserve en mémoire de processus
   l'état des sessions et de l'éditeur de flux, si bien qu'exécuter plusieurs instances fragmente cet état
   et produit un comportement incohérent. Définissez `min_instance_count = 1` si vous souhaitez
   garder le canevas actif pour l'édition interactive plutôt que de le laisser descendre à zéro.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. Épinglez `application_version` explicitement plutôt que de le laisser à
   `latest` pour tout usage dépassant le cadre d'un lab.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~langflow"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   Ne renouvelez jamais `LANGFLOW_SECRET_KEY` après le premier démarrage — elle chiffre chaque
   identifiant stocké intégré à un flux, et la renouveler les rend définitivement
   indéchiffrables.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~langflow" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. langflowdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^langflow" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Activez le **test de disponibilité** (uptime check) du module pour un usage en production
   (désactivé par défaut) ; vérifiez qu'il est au vert dans Monitoring → Uptime checks, et
   consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LangFlow.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/health` et prévoit un délai initial de 60 secondes plus une fenêtre d'échec
  de 600 secondes pour couvrir le chargement des composants et les migrations Alembic du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job `db-init` s'est terminé avec succès. LangFlow
  compose `LANGFLOW_DATABASE_URL` à l'exécution à partir des variables `DB_*` injectées, via
  TCP avec `sslmode=require` — ne définissez pas le DSN manuellement.
- **Échec du job `db-init` :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Connexion impossible / mot de passe administrateur perdu :** récupérez à nouveau `LANGFLOW_SUPERUSER_PASSWORD`
  depuis Secret Manager (tâche 2, étape 2) ; il n'est affiché nulle part ailleurs.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais renouveler `LANGFLOW_SECRET_KEY` après
le premier démarrage, et pourquoi `max_instance_count` doit rester à `1`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, un bucket de stockage `data`, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; se connecter avec le mot de passe administrateur généré automatiquement depuis Secret Manager |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (conserver max=1), mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
