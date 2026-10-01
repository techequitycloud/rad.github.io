---
title: "Formbricks sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Formbricks sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/Formbricks_CloudRun.md @ 3055034 sha256:e6e19e8ee6d3 -->

# Formbricks sur Cloud Run — Guide de lab {#formbricks-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Formbricks_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Formbricks est une plateforme open source de gestion des enquêtes et de
l'expérience, qui permet de créer des enquêtes NPS, des formulaires de retour
produit, des parcours d'intégration et des widgets intégrés de retour
utilisateur. Ce lab vous fait parcourir l'ensemble du cycle de vie opérationnel
du module **Formbricks on Cloud Run** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants, puis le démonter.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Formbricks. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Formbricks_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démonter proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Formbricks (Cloud Run)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Formbricks_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager, un volume NFS, un bucket GCS
   pour les fichiers téléversés et un cache Redis, construit l'image de conteneur
   et exécute une tâche ponctuelle d'initialisation de la base de données. Les
   premiers déploiements prennent environ **20–35 minutes** (la création de Cloud
   SQL représente l'essentiel de ce temps).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres
   indépendants des noms (afin que les commandes continuent de fonctionner quel
   que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~formbricks" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est en bonne santé et connecté à sa base de données
   (Formbricks expose un point de terminaison de santé dédié qui reflète à la
   fois l'état de préparation de l'application et celui de la base de données) :

   ```bash
   curl -s "$SERVICE_URL/api/v2/health"   # expect {"status":"ok"} or HTTP 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite,
   Formbricks affiche un écran d'inscription — créez le compte administrateur
   initial et l'espace de travail directement dans l'interface. L'identifiant
   administrateur que vous définissez ici est géré par Formbricks lui-même ; les
   secrets applicatifs (clé NextAuth, clé de chiffrement, identifiants HMAC GCS,
   etc.) sont générés automatiquement et stockés dans Secret Manager :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~formbricks"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification du service : la mise à
   l'échelle est donc une modification de configuration, et non une modification
   manuelle via `gcloud` (une modification manuelle serait annulée lors de l'application suivante).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets, les sauvegardes et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~formbricks"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~formbricks"   # db-init and any scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. formbricksdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^formbricks" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre pour Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du processeur
   et de la mémoire. Le module provisionne également un **test de disponibilité**
   (uptime check) ; vérifiez qu'il est au vert sous Monitoring → Uptime checks,
   et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de Formbricks à l'autre.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage. Formbricks
  exécute les migrations Prisma au démarrage du conteneur ; les échecs précoces
  au démarrage apparaissent donc souvent sous forme d'erreurs de connexion à la
  base de données ou de migration.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échec de la sonde de santé :** les sondes de Formbricks ciblent
  `/api/v2/health`, qui ne renvoie 200 qu'une fois la connexion à la base de
  données établie. Un échec de sonde indique généralement un problème de
  connectivité à la base de données ou de migration Prisma plutôt qu'un plantage
  de l'application.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`, que le secret du mot de passe de la base de données existe
  et que la tâche d'initialisation s'est terminée avec succès.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démonter [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, les
ressources NFS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), NFS, un bucket GCS pour les fichiers téléversés, Redis et les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit sur `/api/v2/health` ; créer le compte administrateur via l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de sonde de santé, de base de données, de tâche d'initialisation, de build et d'IAM |
| 6 — Démonter | Automatisé | La suppression (Trash) retire toutes les ressources du module |
