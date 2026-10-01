---
title: "Radicale sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Radicale sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Radicale_CloudRun.md @ 3055034 sha256:f0877a10761c -->

# Radicale sur Cloud Run — Guide de lab {#radicale-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Radicale est un serveur CalDAV/CardDAV open source auto-hébergé pour la synchronisation
des agendas et des contacts. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **Radicale on Cloud Run** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Radicale. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, récupérer l'identifiant administrateur généré et connecter un client CalDAV/CardDAV.
- Comprendre pourquoi Cloud Run ne permet pas de créer de NOUVELLES collections via un client standard, et d'où proviennent les collections par défaut pré-créées.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

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
- (Facultatif) Un client CalDAV/CardDAV pour vérifier la synchronisation de bout en bout — par exemple Thunderbird, Apple Calendar/Contacts ou DAVx5.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Radicale (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. **Définissez explicitement
   `application_display_name = "Radicale"`** — la valeur par défaut du module
   contient actuellement une valeur obsolète héritée de la source à partir de laquelle il a été cloné
   (voir la section Pitfalls du Guide de configuration). Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket GCS `storage`
   monté sur `/var/lib/radicale`, un secret Secret Manager contenant un
   `ADMIN_PASSWORD` généré, et exécute le job d'initialisation `seed-default-collections`
   qui écrit un agenda et un carnet d'adresses par défaut sur
   le volume de stockage. Un premier déploiement prend généralement **5 à 10 minutes** — bien
   plus rapide que pour les modules adossés à une base de données, puisqu'il n'y a aucune instance Cloud SQL
   à provisionner.

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~radicale" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et répond (attendez-vous à une redirection `302` vers
   l'interface web, puisque `/` est non authentifié par conception) :

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code}\n'   # expect 302
   ```

2. Radicale est livré **sans compte administrateur intégré par défaut** — récupérez
   l'identifiant généré dans Secret Manager :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~radicale-admin-password" \
     --format="value(name)" --limit=1)
   ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Username: admin"
   echo "Password: $ADMIN_PASSWORD"
   ```

3. Vérifiez que l'accès authentifié fonctionne avec un `PROPFIND` sur le principal
   de l'administrateur (attendez-vous à `207 Multi-Status`) :

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X PROPFIND "$SERVICE_URL/admin/" \
     -H "Depth: 1" -o /dev/null -w '%{http_code}\n'
   ```

4. Connectez un client CalDAV/CardDAV (Thunderbird, Apple Calendar, DAVx5) à
   `$SERVICE_URL/admin/` avec le nom d'utilisateur `admin` et le mot de passe
   récupéré. Vous devriez voir les collections pré-créées **Default Calendar** et
   **Default Address Book** — elles ont été créées automatiquement par le
   job `seed-default-collections` au moment du déploiement (voir la tâche 5 pour comprendre pourquoi ce
   job existe).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise à l'échelle** — `max_instance_count` est fixé à `1` et ne doit **pas** être
   augmenté : le backend de stockage de Radicale n'est pas conçu pour un accès
   simultané par plusieurs instances. `min_instance_count` peut être porté à `1` via le
   flux **Update** de la plateforme RAD si vous souhaitez éviter les démarrages à froid, au
   prix d'une instance toujours active.

3. **Mettez à jour la balise de version de l'application** via le flux **Update** de la plateforme
   RAD. Rappel : les balises du registre de conteneurs de Radicale n'ont **pas de préfixe `v`**
   (par exemple `3.7.7`, et non `v3.7.7`).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~radicale"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Inspectez le bucket de stockage** qui contient toutes les collections :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~radicale" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/collections/collection-root/admin/"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence, le nombre d'instances et l'utilisation CPU/mémoire. Le
   module peut provisionner un **test de disponibilité** (uptime check, désactivé par défaut) ; s'il est
   activé, vérifiez qu'il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision
  et ses journaux. La sonde de démarrage cible `/`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Le job `seed-default-collections` a échoué, ou aucun agenda par défaut n'apparaît :**
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-seed-default-collections" --project="$PROJECT" --region="$REGION"
  ```
  Vérifiez que le bucket GCS `storage` existe et que l'exécution du job a réussi.

- **Un client CalDAV/CardDAV (ou l'interface web propre à Radicale) échoue à créer un NOUVEL
  agenda avec une erreur générique, « Bad Request » ou similaire.** C'est le
  **comportement attendu sur Cloud Run, et non un bug de votre client.** La création d'une
  nouvelle collection requiert la méthode WebDAV `MKCOL`, et le frontal de Cloud Run de Google
  (GFE) rejette `MKCOL` en périphérie — la requête n'atteint jamais le
  conteneur Radicale. Vérifiez-le avec :
  ```bash
  curl -s -u "admin:$ADMIN_PASSWORD" -X MKCOL "$SERVICE_URL/admin/a-new-calendar/" -o /dev/null -w '%{http_code}\n'
  # expect a Google frontend error (400), NOT a Radicale response
  ```
  Vous ne pouvez pas contourner ce problème côté client, et Cloud Run n'offre aucun
  accès shell permettant une correction manuelle. Utilisez les collections pré-créées Default Calendar/Address
  Book, ajoutez une entrée `initialization_jobs` personnalisée pour créer d'autres collections au
  moment du déploiement, ou passez à `Radicale_GKE`, dont le Service LoadBalancer n'a
  pas cette restriction.

- **401 Unauthorized sur chaque requête, même avec un identifiant qui semble
  correct :** vérifiez que vous avez récupéré l'`ADMIN_PASSWORD` *actuel*
  dans Secret Manager — la valeur n'est régénérée que lorsque le secret lui-même
  change, mais un mot de passe obsolète copié manuellement ne correspondra pas. Vérifiez aussi
  que vous utilisez `admin` (ou votre `ADMIN_USERNAME` configuré), et non une
  adresse e-mail — l'authentification htpasswd de Radicale attend un simple nom d'utilisateur.

- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez
plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. La suppression retire tout ce que le module a créé —
le service Cloud Run, le bucket GCS `storage` (et tous les agendas/carnets
d'adresses qu'il contenait), les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, un bucket de stockage GCS, un secret administrateur généré, et exécute le job de création des collections par défaut |
| 2 — Accéder et vérifier | Manuel | 302 sur `/` ; récupérer le mot de passe administrateur généré ; connecter un client CalDAV/CardDAV et voir les collections par défaut pré-créées |
| 3 — Exploiter | Manuel | Inspecter les révisions, comprendre la limite de mise à l'échelle `max=1`, mettre à jour la version, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de job de création, de MKCOL/périphérie Cloud Run et d'authentification |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris toutes les collections stockées |
