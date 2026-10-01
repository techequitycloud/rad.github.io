---
title: "PocketBase sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer PocketBase sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PocketBase_CloudRun.md @ 3055034 sha256:0577f5f7901f -->

# PocketBase sur Cloud Run — Guide de lab {#pocketbase-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

PocketBase est un backend open source tenant dans un seul fichier — une base de données SQLite intégrée avec une
API REST en temps réel, une authentification intégrée, un stockage de fichiers et un tableau de bord d'administration. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **PocketBase on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit PocketBase. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier, et revendiquer le compte administrateur du premier lancement.
- Effectuer les opérations du jour 2 — inspecter, sauvegarder et mettre à jour le déploiement.
- Comprendre pourquoi ce module est à instance unique et pourquoi cela ne doit pas changer.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **PocketBase (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Laissez `max_instance_count` à `1` — la
   base de données SQLite intégrée et son montage GCS FUSE n'admettent qu'un seul rédacteur, et l'augmenter
   corrompt la base de données. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (gen2, port 8090), un bucket de données Cloud Storage
   monté sur `/pb_data` via GCS FUSE, et construit l'image de conteneur. Il n'y a **ni
   instance Cloud SQL ni job d'initialisation de base de données** — PocketBase crée son propre
   schéma SQLite au premier démarrage. Les premiers déploiements se terminent généralement en **5–15 minutes**, bien
   plus rapidement qu'un module adossé à Cloud SQL.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les commandes
   continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~pocketbase" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. PocketBase expose un point de terminaison de santé public et non authentifié
   qui répond dès que le binaire est démarré — il n'y a aucune base de données externe à
   attendre :

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect {"code":200,"message":"API is healthy."}
   ```

2. Ouvrez `$SERVICE_URL/_/` dans un navigateur **immédiatement**. Lors de la première visite, la première personne qui atteint `/_/`
   est invitée à créer le compte administrateur (superuser) — aucun identifiant administrateur n'est
   prédéfini dans Secret Manager, et tant que le compte n'est pas revendiqué, quiconque dispose de l'URL peut le
   revendiquer. Saisissez une adresse e-mail et un mot de passe et terminez l'assistant de configuration. Ensuite, connectez-vous au
   tableau de bord d'administration et parcourez les collections par défaut pour confirmer que la base de données s'est
   correctement initialisée.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count` et `max_instance_count` valent tous deux
   `1` par défaut, et la plateforme RAD l'impose délibérément — SQLite n'admet qu'un seul rédacteur
   et le montage GCS FUSE `/pb_data` n'est pas sûr pour des rédacteurs concurrents. Si vous avez besoin de plus de
   capacité, augmentez `cpu_limit` / `memory_limit` sur l'instance unique plutôt que d'augmenter
   le nombre d'instances.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD et
   en l'appliquant via **Update**. PocketBase applique automatiquement les migrations de schéma en attente
   au démarrage suivant ; sauvegardez donc `/pb_data` (étape 4) avant de changer de version — une
   mise à niveau interrompue peut laisser la base de données au milieu d'une migration.

4. **Sauvegardez `/pb_data`** — le bucket Cloud Storage constitue l'intégralité de la base de données et du stockage de fichiers :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~pocketbase AND name~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage cp "gs://$BUCKET/data.db" ./pb_data-backup.db
   gcloud storage rsync "gs://$BUCKET/" ./pb_data-backup/ --recursive   # full backup incl. uploads
   ```

5. **Gérez vos propres secrets** (pertinent uniquement si vous avez ajouté des identifiants SMTP ou de sauvegarde
   externe — PocketBase n'en génère aucun automatiquement) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~pocketbase"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99) et l'utilisation du CPU / de la mémoire. Le nombre d'instances doit rester
   stable à 1. Le test de disponibilité (uptime check) est désactivé par défaut ; activez `uptime_check_config` si vous
   souhaitez des alertes sur la disponibilité, puis vérifiez-le sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de PocketBase.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses journaux à la recherche
  d'erreurs de démarrage. Les sondes de démarrage et de vivacité ciblent `/api/health`, qui ne dépend d'aucune
  ressource externe ; un échec à ce niveau désigne donc presque toujours un problème au niveau du conteneur
  (image défectueuse, variable d'environnement manquante, port incorrect) plutôt qu'un problème de base de données.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les données semblent manquantes ou réinitialisées :** vérifiez que le service monte bien le bucket GCS attendu
  (et non un bucket neuf/vide) et que `execution_environment = gen2` — gen1 ne peut pas monter le volume GCS
  FUSE ; le service démarre alors silencieusement sans `/pb_data` persistant.
- **Impossible d'atteindre `/_/`, ou quelqu'un d'autre a revendiqué le compte administrateur :** il n'existe aucun mécanisme de réinitialisation
  côté plateforme ; utilisez la CLI/l'API PocketBase sur l'instance en cours d'exécution, ou restaurez
  une sauvegarde du bucket de données antérieure à la revendication si cela s'est produit sur un nouveau déploiement.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution, et vérifiez
  si `enable_iap` a été activé par erreur — IAP bloque l'interface d'administration publique et l'API REST.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(notamment pourquoi `max_instance_count` ne doit jamais être augmenté et pourquoi `execution_environment` doit
rester `gen2`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple
après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela
supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
le bucket de données GCS (qui **constitue** l'intégralité de la base de données SQLite et des fichiers envoyés — sauvegardez-le
d'abord si vous devez le conserver) et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, l'Artifact Registry partagé) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le service Cloud Run (gen2) et son bucket de données GCS ; ni Cloud SQL, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; revendiquer immédiatement le compte administrateur du premier lancement sur `/_/` |
| 3 — Exploiter | Manuel | Inspecter les révisions, maintenir le nombre d'instances à 1, sauvegarder `/pb_data`, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de montage du stockage, de revendication du compte administrateur, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime le service et le bucket GCS qui contient toutes les données |
