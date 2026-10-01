---
title: "Stirling-PDF sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Stirling-PDF sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/StirlingPDF_CloudRun.md @ 3055034 sha256:ee9ebcfc6401 -->

# Stirling-PDF sur Cloud Run — Guide de lab {#stirling-pdf-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 60 minutes

Stirling-PDF est une boîte à outils PDF web auto-hébergée — fusion, découpage, conversion, OCR,
compression, filigrane, signature, caviardage et plus de 50 autres opérations PDF, toutes traitées sur
votre propre infrastructure, de sorte que les documents ne transitent jamais par un service tiers. Ce lab
vous fait parcourir le cycle de vie opérationnel complet du module **Stirling-PDF on Cloud
Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Stirling-PDF. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour la version et restreindre l'accès.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la plateforme RAD, puis ouvrez **Stirling-PDF (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme met en miroir l'image officielle `stirlingtools/stirling-pdf` dans Artifact
   Registry et déploie le service Cloud Run. Il n'y a **aucune base de données, aucun bucket
   de stockage et aucun secret** à provisionner — Stirling-PDF est sans état — les premiers
   déploiements sont donc rapides, généralement **5 à 10 minutes** (la mise en miroir de l'image représente l'essentiel de ce temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~stirlingpdf" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Stirling-PDF expose un point de terminaison d'état public qui
   ne renvoie 200 qu'une fois la JVM et LibreOffice entièrement initialisés :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/v1/info/status"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. La connexion étant désactivée par défaut, la boîte à outils est
   immédiatement utilisable — choisissez n'importe quel outil (par ex. **Merge**), téléversez quelques PDF et
   téléchargez le résultat pour confirmer le fonctionnement de bout en bout. Comme l'instance est ouverte,
   envisagez de restreindre l'accès avant un usage réel (tâche 3, étape 4).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module est maître de la spécification du service ; la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply).
   Stirling-PDF étant sans état, augmenter `max_instance_count` est sans risque, sans cache
   ni coordination. Définissez `min_instance_count = 1` pour éliminer le démarrage à froid de la JVM
   à la première requête lorsque la latence est importante.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; la nouvelle étiquette d'image est mise en miroir et une nouvelle révision
   est déployée — sans étape de migration, puisqu'il n'y a pas de schéma.

4. **Restreignez l'accès.** L'instance par défaut est ouverte. Pour la rendre privée, définissez
   `enable_login = true` (l'authentification intégrée de Stirling-PDF) et/ou activez IAP, puis
   cliquez sur **Update**. Pour une instance publique, activez Cloud Armor (`enable_cloud_armor =
   true`) pour limiter les abus. Ne touchez pas à `enable_redis` — il se contente de faire
   injecter par la fondation des variables d'environnement `REDIS_*` inutilisées dans le conteneur ; Stirling-PDF
   ne les lit jamais, si bien qu'il n'assure ni limitation de débit ni détection des bots.

5. **Optimisez pour les documents volumineux** en augmentant `memory_limit` et `timeout_seconds`, et
   plafonnez la taille des téléversements avec `SYSTEM_MAXFILESIZE` via `environment_variables`.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Surveillez la mémoire pendant l'OCR et les conversions — une pression soutenue
   proche de la limite de 2Gi est le signal qu'il faut augmenter `memory_limit`. Si vous avez activé le
   **test de disponibilité**, confirmez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Stirling-PDF.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `/api/v1/info/status` et
  accorde jusqu'à environ 70 secondes au premier démarrage pour que la JVM et LibreOffice soient prêts —
  ne la raccourcissez pas.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Conteneur arrêté pour dépassement de mémoire (OOM) pendant une conversion :** augmentez `memory_limit` (2Gi au minimum ;
  l'OCR ou une conversion lourde peut nécessiter 4Gi ou plus).
- **Erreur 504 sur un fichier volumineux :** augmentez `timeout_seconds` ; la requête a dépassé le délai d'expiration
  des requêtes Cloud Run en cours d'opération.
- **Échec de la récupération / de la mise en miroir de l'image :** consultez l'historique Cloud Build / Artifact Registry pour
  l'étape de mise en miroir, et vérifiez que l'image existe dans le dépôt.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (y compris la nécessité de garder l'instance protégée lorsqu'elle traite des documents sensibles).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run et
ses images Artifact Registry. Stirling-PDF étant sans état, il n'y a ni base de données,
ni bucket, ni secret à nettoyer. Les ressources appartenant à **Services_GCP** (le VPC, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module met l'image en miroir et provisionne le service Cloud Run sans état (sans base de données, stockage ni secrets) |
| 2 — Accéder et vérifier | Manuel | Le point de terminaison d'état renvoie 200 ; exécuter une opération PDF de bout en bout dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, restreindre l'accès, optimiser pour les fichiers volumineux |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'OOM, de délai d'expiration, de mise en miroir d'image et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
