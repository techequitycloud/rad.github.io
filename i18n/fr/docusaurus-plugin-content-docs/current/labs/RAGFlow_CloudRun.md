---
title: "RAGFlow sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez RAGFlow sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/RAGFlow_CloudRun.md @ 3055034 sha256:08339b49a0bf -->

# RAGFlow sur Cloud Run — Guide de lab {#ragflow-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

RAGFlow est une plateforme open source d'intelligence documentaire et de génération augmentée par récupération (RAG,
Retrieval-Augmented Generation). Elle ingère des PDF, des documents Word, des pages HTML et d'autres formats, les découpe en fragments et
en calcule les embeddings, stocke les vecteurs dans Elasticsearch, et expose une API REST et une interface web pour
la gestion des bases de connaissances et la recherche d'entreprise. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **RAGFlow on Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités de RAGFlow. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- **Elasticsearch_GKE déployé** et sa sortie `elasticsearch_endpoint` disponible —
  il s'agit d'un prérequis de déploiement strict ; le plan est rejeté si `elasticsearch_hosts`
  est vide lorsque `deploy_application = true`.
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **RAGFlow (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   `elasticsearch_hosts` (la sortie `elasticsearch_endpoint` de votre
   déploiement `Elasticsearch_GKE`), puis passez en revue les autres paramètres. Ne configurez que
   ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager, un bucket Cloud Storage pour les artefacts documentaires,
   un raccordement NFS/Redis facultatif, construit l'image de conteneur et exécute un job ponctuel
   d'initialisation de la base de données. Un premier déploiement prend environ **20 à 35 minutes** (la création de Cloud
   SQL domine).

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ragflow" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et connecté à ses dépendances :

   ```bash
   curl -s "$SERVICE_URL/v1/health"   # expect HTTP 200 with {"code":0}
   ```

   RAGFlow charge les modèles d'embedding au premier démarrage ; si vous obtenez une erreur 502 ou un refus de
   connexion, patientez quelques minutes que la sonde de démarrage se termine.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, RAGFlow présente une page
   d'inscription — créez un compte administrateur avec l'adresse e-mail et le mot de passe de votre choix, puis
   connectez-vous. Aucun identifiant administrateur pré-provisionné n'existe dans Secret Manager ; le secret du mot de passe
   de la base de données sert uniquement au backend MySQL.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Notez
   que `min_instance_count` vaut `0` par défaut avec `cpu_always_allocated = false`
   (démarrage à froid privilégiant le coût) : le service descend à zéro lorsqu'il est inactif et l'exécuteur de tâches
   documentaires en arrière-plan ne s'exécute que tant qu'une instance est active, si bien que l'ingestion/l'analyse
   des documents nouvellement téléversés se fait à la demande plutôt qu'en continu ; les requêtes/le chat
   fonctionnent toujours à la demande. Définissez `cpu_always_allocated = true` et `min_instance_count
   >= 1` pour un traitement continu en arrière-plan (cela évite aussi le démarrage à froid de 2 à 3 minutes
   dû au chargement des modèles d'embedding).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ragflow"
   gcloud storage buckets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and any cron jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ragflowdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ragflow" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation CPU
   / mémoire. Le module provisionne également un **contrôle de disponibilité** (uptime check, lorsqu'il est activé) ;
   vérifiez qu'il est au vert dans Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de RAGFlow.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données existe et que le job d'initialisation s'est terminé. RAGFlow requiert
  MySQL 8.0 — vérifiez `database_type = MYSQL_8_0`.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="name~ragflow"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Documents non traités (bloqués dans la file d'attente) :** vérifiez que Redis est joignable et que
  `redis_host` est défini — sans Redis, les workers documentaires de RAGFlow ne démarrent jamais.
- **Erreurs Elasticsearch / échec de l'indexation :** vérifiez que `elasticsearch_hosts` pointe vers
  le bon point de terminaison Elasticsearch et que l'état de santé du cluster est au vert.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL (MySQL), les secrets Secret Manager, le bucket Cloud Storage et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici. Le déploiement Elasticsearch_GKE
doit également être supprimé séparément.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL), le stockage, les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; créer le compte administrateur et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, le stockage et les jobs, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de Redis/Elasticsearch, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
