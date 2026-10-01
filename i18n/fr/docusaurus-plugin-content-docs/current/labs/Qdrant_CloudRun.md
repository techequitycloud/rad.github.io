---
title: "Qdrant sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Qdrant sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Qdrant_CloudRun.md @ 3055034 sha256:47e791288b05 -->

# Qdrant sur Cloud Run — Guide de lab {#qdrant-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Qdrant est une base de données vectorielle et un moteur de recherche par similarité hautes performances conçus
pour les charges de travail d'IA — pipelines RAG, systèmes de recommandation, recherche sémantique et
stockage d'embeddings. Ce lab vous fait parcourir tout le cycle de vie opérationnel du
module **Qdrant on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Qdrant. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)
— ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Qdrant (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run v2 (Gen2), un bucket Cloud Storage
   monté sur `/qdrant/storage` via GCS FUSE, construit l'image de conteneur
   et stocke une clé d'API dans Secret Manager lorsque `enable_api_key = true`. Qdrant
   n'a ni base de données SQL ni job d'initialisation — le module ne déclare des paramètres de base de données
   et Redis que pour suivre les conventions de la plateforme ; ils n'ont aucun effet,
   laissez-les donc à leurs valeurs par défaut. Un premier déploiement prend généralement
   **8 à 15 minutes** (le build de l'image domine).

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~qdrant" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Qdrant expose deux points de terminaison de santé distincts —
   utilisez `/readyz` pour vérifier qu'il a fini de charger les collections, et `/livez`
   pour vérifier que le processus est actif :

   ```bash
   curl -s "$SERVICE_URL/readyz"    # expect {"result":true,"status":"ok",...}
   curl -s "$SERVICE_URL/livez"     # expect {"result":true,"status":"ok",...}
   ```

   > La valeur par défaut `ingress_settings = "internal"` limite l'accès au VPC.
   > Exécutez ces commandes depuis une VM ou une instance Cloud Shell dans le même VPC, ou
   > modifiez temporairement l'ingress pour autoriser votre IP source.

2. Si `enable_api_key = true`, récupérez la clé d'API dans Secret Manager avant
   d'effectuer des requêtes authentifiées :

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~qdrant AND name~api-key" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT"
   ```

   Transmettez la valeur récupérée dans l'en-tête `api-key` de tous les appels REST à Qdrant.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances dans la plateforme RAD et
   en l'appliquant via **Update** — le module possède la spécification du service, la mise à l'échelle est donc une
   modification de configuration et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la
   prochaine application). Conservez `max_instance_count = 1` ; Qdrant est un magasin à écrivain unique
   et plusieurs instances partageant le même montage GCS FUSE corrompent les collections.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans l'interface
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~qdrant"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspectez le bucket de stockage GCS** dans lequel Qdrant persiste son WAL, les données
   des collections et les fichiers d'index HNSW :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~qdrant" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de
   mise à l'échelle) et l'utilisation CPU / mémoire. Le module provisionne également un
   **contrôle de disponibilité** (uptime check, sur `/readyz`) ; vérifiez qu'il est au vert dans
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Qdrant.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Démarrage lent / `/readyz` renvoie 503 :** au démarrage, Qdrant charge en mémoire toutes les collections depuis
  GCS FUSE. Les collections volumineuses peuvent mettre des dizaines de secondes à
  se charger. La sonde de démarrage attend `/readyz` ; prévoyez un délai supplémentaire avant
  de déclarer la révision non saine.
- **Erreurs de montage GCS FUSE :** vérifiez que le bucket Cloud Storage existe, que le compte de service
  d'exécution dispose de `storage.objectAdmin` sur le bucket et que le service
  utilise l'environnement d'exécution Gen2 (requis pour GCS FUSE).
- **Erreurs de clé d'API (401/403) :** vérifiez que `enable_api_key = true` a été défini au
  moment du déploiement, que le secret existe et que l'en-tête `api-key` figure dans les requêtes.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket Cloud Storage (et toutes les collections persistées), les secrets Secret Manager
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, le bucket de stockage GCS et un secret de clé d'API facultatif |
| 2 — Accéder et vérifier | Manuel | Les contrôles de santé réussissent sur `/readyz` et `/livez` ; clé d'API récupérée si elle est activée |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de GCS FUSE, de clé d'API, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
