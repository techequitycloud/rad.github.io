---
title: "AFFiNE sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer AFFiNE sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Affine_CloudRun.md @ 3055034 sha256:71dc5fce664c -->

# AFFiNE sur Cloud Run — Guide de lab {#affine-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

AFFiNE est une base de connaissances open source qui réunit documents, tableaux blancs et bases de données dans un même espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **AFFiNE on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit AFFiNE. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et effectuer la configuration initiale d'AFFiNE.
- Effectuer les opérations du jour 2 — inspecter les révisions, redimensionner, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry, l'hôte NFS/Redis
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de
  le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **AFFiNE (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec son secret de mot de passe dans Secret Manager, un partage NFS pour le stockage des blobs (dont l'hôte
   sert également de point de terminaison Redis par défaut), un bucket GCS dédié `storage`, construit
   l'image de conteneur personnalisée (une fine surcouche de `ghcr.io/toeverything/affine`) et
   exécute deux tâches ponctuelles : `db-init` (base de données + utilisateur) et `affine-migrate` (la migration de schéma
   `self-host-predeploy` d'AFFiNE et la génération de la clé de signature). Les premiers déploiements
   prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~affine" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le chemin de santé d'AFFiNE est `/`, qui renvoie HTTP 200
   dès que le serveur est prêt (la sonde de démarrage accorde une fenêtre généreuse, mais une instance
   en bonne santé répond généralement en une minute ou deux après un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur et **créez le premier compte** — sur une nouvelle
   instance AFFiNE auto-hébergée, le premier utilisateur inscrit devient l'administrateur
   du serveur (le panneau d'administration se trouve à `${SERVICE_URL}/admin`). Faites-le immédiatement
   après le déploiement : tant qu'aucun compte administrateur n'existe, quiconque atteint l'URL peut
   l'enregistrer. Le mot de passe de la base de données (le seul identifiant présent dans Secret Manager) peut être
   récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~affine" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle est verticale, et non horizontale.** AFFiNE est fixé à une seule instance
   toujours active (`min = max = 1`, `cpu_always_allocated = true`), car les blobs de collaboration
   résident sur le système de fichiers NFS et l'état d'édition en temps réel est propre à chaque processus. Pour
   lui donner plus de marge, augmentez `cpu_limit` / `memory_limit` et cliquez sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service, il s'agit donc d'une
   modification de configuration, et non d'une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors de la prochaine application). N'augmentez **pas** `max_instance_count`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (par ex. `stable` → un tag de version figé) via **Update** sur la page de détails du
   déploiement ; une nouvelle image est construite et une nouvelle révision est déployée. La tâche `affine-migrate`
   est réexécutée de manière idempotente.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~affine"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, affine-migrate, backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~affine"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (PostgreSQL 15) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. affinedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^affine" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Les lignes `[cloud-entrypoint]` indiquent
   quel hôte de base de données et quel point de terminaison Redis le conteneur a résolus au démarrage :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (attendez-vous à une valeur constante de `1` — l'instance
   est toujours active) et l'utilisation du CPU / de la mémoire. Si vous avez activé
   `uptime_check_config`, vérifiez que le test est au vert sous Monitoring → Uptime checks,
   et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'AFFiNE.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux. Les lignes de démarrage `[cloud-entrypoint]` confirment si l'hôte de la base et le point de terminaison
  Redis ont été résolus :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que la tâche `db-init` s'est terminée. Notez
  qu'AFFiNE se connecte via l'**IP privée de l'instance avec `sslmode=require`** (et non via le socket
  Auth Proxy) — la sortie VPC doit être intacte.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué.
  `affine-migrate` effectue jusqu'à 3 tentatives et doit réussir pour que le serveur dispose d'un
  schéma :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-affine-migrate" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **La collaboration en temps réel ne se synchronise pas :** Redis est obligatoire. Vérifiez que la VM hôte NFS/Redis
  est `RUNNING` (l'IP du serveur NFS est le point de terminaison Redis par défaut) et que
  les journaux affichent une valeur non vide pour `REDIS_SERVER_HOST`.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
  `container_image_source` doit valoir `custom` — l'image amont ne dispose pas du point d'entrée
  qui assemble `DATABASE_URL` / `REDIS_SERVER_*`. Un tag d'image inexistant (par ex. un
  `latest` littéral) fait échouer la récupération de l'image de base ; le module convertit `latest` → `stable`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris le bucket
`storage`), le partage NFS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre, l'hôte NFS/Redis) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), NFS/Redis, un bucket GCS, les secrets, et exécute db-init + affine-migrate |
| 2 — Accès et vérification | Manuel | La vérification d'état réussit ; le premier compte inscrit devient l'administrateur du serveur |
| 3 — Exploiter | Manuel | Inspecter les révisions, redimensionner verticalement, mettre à jour la version, gérer les secrets/sauvegardes/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation, de Redis, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
