---
title: "Karakeep sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Karakeep sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Karakeep_CloudRun.md @ 3055034 sha256:4a16e6f50904 -->

# Karakeep sur Cloud Run — Guide de lab {#karakeep-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Karakeep est une application open source et auto-hébergeable qui permet de tout mettre en favori, avec
un étiquetage automatique par IA et une recherche plein texte. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Karakeep on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Karakeep. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne,
  y compris le sidecar de recherche Meilisearch requis.
- Accéder au service en cours d'exécution, le vérifier et créer le premier compte (administrateur).
- Effectuer les opérations du jour 2 — inspecter, comprendre les limites de mise à l'échelle, mettre à jour et gérer les sauvegardes.
- Observer le service et son sidecar de recherche avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris
  un sidecar de recherche dégradé mais toujours en cours d'exécution.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, NFS/Filestore, Artifact Registry et les
  comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Karakeep (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, le sidecar de recherche **Meilisearch**
   requis, accessible uniquement en interne, sous la forme d'un second service Cloud Run, les deux
   secrets applicatifs (`NEXTAUTH_SECRET`, `MEILI_MASTER_KEY`), et monte le
   volume NFS partagé pour les deux. Il n'y a pas d'étape Cloud SQL — les premiers déploiements sont
   nettement plus rapides que pour les modules adossés à une base de données, généralement **5 à 10 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~karakeep AND NOT metadata.name~meilisearch" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   MEILI_SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~meilisearch" --format="value(metadata.name)" --limit=1)
   echo "Meilisearch sidecar: $MEILI_SERVICE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et répond :

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Karakeep affiche sa page d'inscription/de connexion.
   **Créez le premier compte** — aucun identifiant administrateur n'est pré-provisionné ;
   la première personne qui s'inscrit devient automatiquement administrateur. Une fois le compte créé,
   enregistrez un favori (n'importe quelle URL) pour vérifier que le chemin d'écriture SQLite sur NFS fonctionne —
   le favori doit apparaître dans votre bibliothèque et y rester après une actualisation
   de la page. Vous pouvez aussi le rechercher par un mot-clé de son titre pour vérifier que le
   sidecar Meilisearch est joignable et indexe le contenu.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **N'augmentez pas `max_instance_count` au-delà de 1.** Contrairement à la plupart des modules de ce
   catalogue, le `max_instance_count` de Karakeep est fixé par conception — plusieurs
   instances Cloud Run écrivant dans le même fichier SQLite sur NFS risquent de le corrompre.
   Il n'existe aucun moyen pris en charge de mettre Karakeep à l'échelle horizontalement dans ce module.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle révision est déployée (sans
   nouveau build — l'image est récupérée directement depuis `ghcr.io/karakeep-app/karakeep`).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~karakeep"
   ```

5. **Inspectez le sidecar Meilisearch séparément :**

   ```bash
   gcloud run services describe "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run services logs read "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — l'application principale et le sidecar de recherche journalisent séparément :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Surveillance** — ouvrez le tableau de bord Cloud Run des deux services et examinez
   séparément le nombre de requêtes, la latence, le nombre d'instances et l'utilisation CPU/mémoire
   — une application principale saine avec un sidecar en difficulté paraît normale sur
   le tableau de bord de l'application principale, vérifiez donc les deux.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et
  ses journaux. La sonde de démarrage cible `/` avec un délai initial de 30 secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **L'application se charge mais la recherche ne renvoie rien :** le sidecar Meilisearch est probablement
  arrêté ou l'injection de `MEILI_ADDR` a échoué. Vérifiez l'état de la révision du sidecar lui-même
  et ses journaux (voir la tâche 3, étape 5) — l'enregistrement de favoris fonctionne toujours dans cet état, ce qui
  en fait un mode dégradé facile à manquer plutôt qu'une panne.
- **Les favoris ne persistent pas / erreurs SQLite dans les journaux :** vérifiez que le volume NFS
  s'est monté correctement (`enable_nfs = true`) et qu'aucune seconde instance n'écrit
  simultanément (`max_instance_count` doit valoir `1`).
- **Échec du build ou de la récupération de l'image :** Karakeep utilise une image préconstruite
  (`ghcr.io/karakeep-app/karakeep`) — un échec à ce stade provient presque toujours d'un tag
  `application_version` incorrect plutôt que d'un problème Cloud Build, puisqu'aucun build n'est exécuté.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à
chaque paramètre (notamment pourquoi `max_instance_count` est fixé et le comportement en mode dégradé
de Meilisearch).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme
RAD ne peut plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud. La suppression
retire tout ce que le module a créé — les deux services Cloud Run (application principale et
sidecar Meilisearch), les secrets Secret Manager et les images d'Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le NFS partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici. Notez que la suppression du déploiement n'efface
**pas** les données de favoris conservées sur le NFS, sauf si le volume NFS lui-même est
également démantelé au niveau de `Services_GCP`.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (application principale + sidecar Meilisearch), le montage NFS et deux secrets |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; créer le premier compte (administrateur) et enregistrer/rechercher un favori |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer les secrets, inspecter le sidecar séparément |
| 4 — Observer | Manuel | Interroger Cloud Logging pour les deux services ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de NFS, de sidecar et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire les deux services et les secrets |
