---
title: "N8N_AI sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer N8N_AI sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/N8N_AI_CloudRun.md @ 3055034 sha256:cdf0f5eb18f5 -->

# N8N_AI sur Cloud Run — Guide de lab {#n8n_ai-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

n8n AI est une plateforme open source d'automatisation de workflows enrichie de capacités d'IA intégrées.
En plus du service n8n principal, elle déploie deux services Cloud Run compagnons — **Qdrant** (une
base de données vectorielle pour les embeddings et la recherche sémantique) et **Ollama** (un serveur d'inférence
LLM local) — ce qui permet d'exécuter des workflows d'agents IA, des pipelines RAG et des chatbots intelligents sur votre propre
infrastructure, sans dépendance à une API d'IA externe. Ce lab vous fait parcourir l'intégralité
du cycle de vie opérationnel du module **N8N_AI on Cloud Run** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit n8n. Pour la liste complète des services provisionnés et de chaque paramètre
de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder aux services n8n, Qdrant et Ollama en cours d'exécution et les vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer les services avec Cloud Logging et Cloud Monitoring.
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

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **N8N AI (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne trois services Cloud Run (n8n, Qdrant interne, Ollama interne),
   une base de données Cloud SQL (PostgreSQL) avec ses secrets Secret Manager, un NFS Filestore, un bucket
   GCS pour la persistance des données d'IA, et exécute une tâche ponctuelle d'initialisation de la base de données. Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les commandes continuent
   de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~n8nai" --format="value(metadata.name)" \
     --sort-by="metadata.creationTimestamp" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"

   # List all three services (n8n, Qdrant, Ollama)
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~n8nai"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que n8n est en bonne santé et s'est connecté à sa base de données :

   ```bash
   curl -s "${SERVICE_URL}/"
   ```

   Une redirection ou la page de connexion de n8n indique un service en bonne santé. Cloud Run n'achemine pas
   de trafic tant que la sonde de démarrage (qui cible `GET /` sur le port 5678) n'a pas réussi ; une réponse
   ici confirme donc une révision en bonne santé.

2. Vérifiez que les services compagnons Qdrant et Ollama sont prêts :

   ```bash
   QDRANT_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~qdrant" --format="value(metadata.name)" --limit=1)
   OLLAMA_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ollama" --format="value(metadata.name)" --limit=1)
   gcloud run services describe "$QDRANT_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.conditions)"
   gcloud run services describe "$OLLAMA_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.conditions)"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier lancement, n8n vous invite à créer un compte
   propriétaire. La clé de chiffrement de n8n est générée automatiquement et stockée dans Secret Manager — sauvegardez-la
   avant de détruire le module, car tous les identifiants enregistrés sont chiffrés avec elle.

   ```bash
   ENC_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~n8nai AND name~encryption" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ENC_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez les services et leurs révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement — le
   module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une modification manuelle via `gcloud`
   (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~n8nai"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. n8naidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^n8nai" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^n8nai" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) (pour les trois services) :

   ```bash
   # n8n service logs
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50

   # Qdrant service logs
   gcloud run services logs read "$QDRANT_SVC" --project="$PROJECT" --region="$REGION" --limit=30

   # Ollama service logs
   gcloud run services logs read "$OLLAMA_SVC" --project="$PROJECT" --region="$REGION" --limit=30
   ```

   Filtre de l'explorateur de journaux pour tous les services n8nai :
   `resource.type="cloud_run_revision" AND resource.labels.service_name=~"n8nai"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run et examinez le nombre de requêtes, la latence des requêtes
   (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de la mémoire de chaque
   service. Le module provisionne un **test de disponibilité** (uptime check) pour le service n8n ; vérifiez qu'il est
   au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de n8n.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses journaux à la recherche
  d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde de démarrage attend jusqu'à
  120 secondes que n8n se connecte à PostgreSQL avant de déclarer un échec.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret
  du mot de passe de la base existe et que la tâche d'initialisation `db-init` s'est terminée avec succès.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="name~n8nai"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Qdrant ou Ollama injoignable depuis n8n :** vérifiez que les services compagnons ont une révision
  en bonne santé et que `QDRANT_URL` / `OLLAMA_HOST` sont correctement injectées dans les variables d'environnement
  du service n8n.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre,
notamment les remarques essentielles sur `N8N_ENCRYPTION_KEY` et `enable_redis`.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — les trois services Cloud Run
(n8n, Qdrant, Ollama), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, le NFS Filestore
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne les services Cloud Run n8n, Qdrant et Ollama, Cloud SQL, les secrets, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit ; services compagnons prêts ; compte n8n créé ; clé de chiffrement sauvegardée |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging pour les trois services ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation, de compagnons IA, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
