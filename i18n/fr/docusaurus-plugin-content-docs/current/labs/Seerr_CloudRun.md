---
title: "Seerr sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Seerr sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Seerr_CloudRun.md @ 3055034 sha256:36295f80f6e2 -->

# Seerr sur Cloud Run — Guide de lab {#seerr-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Seerr est la fusion, en 2026, de Jellyseerr et d'Overseerr — une interface de
demandes placée devant Jellyfin, Plex ou Emby, qui permet aux utilisateurs de
parcourir et de demander des titres qu'un administrateur approuve. Ce lab vous
fait parcourir tout le cycle de vie opérationnel du module **Seerr on Cloud
Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités de Seerr. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et terminer l'assistant de première configuration de Seerr.
- Comprendre pourquoi `DB_TYPE=postgres` est important et comment confirmer que votre déploiement utilise bien Postgres, et non un repli SQLite effacé sans avertissement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- (Facultatif) Une instance Jellyfin, Plex ou Emby existante, ainsi que Sonarr/Radarr, à connecter pendant l'assistant de configuration de Seerr.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Seerr (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous prévoyez
   d'exécuter plusieurs instances et souhaitez éviter une situation de concurrence entraînant la perte d'écritures sur `settings.json`,
   envisagez de définir explicitement `max_instance_count = 1` (voir la section
   Pitfalls du Guide de configuration). Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données et un rôle Cloud SQL
   PostgreSQL 15, un bucket GCS `storage` monté sur `/app/config`, et un
   secret Secret Manager contenant le mot de passe de base de données généré. Il n'y a
   **aucun identifiant administrateur initial à récupérer** — les migrations de schéma de Seerr
   s'exécutent automatiquement au premier démarrage de l'application, et le compte administrateur est
   créé via l'assistant de configuration propre à l'application. Un premier déploiement prend généralement
   **5 à 10 minutes**.

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~seerr" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel et répond — il s'agit du point de terminaison
   d'état propre à Seerr, sans authentification, et non d'une page de santé générique :

   ```bash
   curl -s "$SERVICE_URL/api/v1/status" | head -c 300; echo
   # expect JSON: {"version":"...","commitTag":"...", ...}
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur et terminez l'**assistant de première
   configuration** de Seerr :
   - Connectez-vous avec un compte Jellyfin/Plex/Emby, ou créez un compte Seerr local.
   - Connectez votre serveur multimédia.
   - Connectez Sonarr et/ou Radarr, si vous les utilisez.

3. **Vérifiez que Postgres est bien utilisé, et non le repli SQLite.** C'est
   l'étape de vérification la plus importante pour ce module — un
   `DB_TYPE` mal configuré permettrait quand même au service de démarrer et de réussir le contrôle de santé tout en
   écrivant silencieusement dans un fichier local au conteneur. Vérifiez directement la variable
   d'environnement injectée :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)' | grep -o 'DB_TYPE[^,]*'
   # expect: name:DB_TYPE value:postgres
   ```

   Pour une seconde confirmation, comportementale cette fois : effectuez une petite modification de paramètre (par exemple
   basculer un curseur de découverte), puis forcez une nouvelle révision ou redémarrez le
   service, et vérifiez que la modification a été conservée — un repli SQLite l'aurait
   perdue.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** — la valeur par défaut du module est `min_instance_count = 1` /
   `max_instance_count = 5`. Si plusieurs instances risquent de modifier simultanément les
   paramètres de Seerr (configuration du serveur multimédia, curseurs de découverte, agents de notification),
   envisagez d'abaisser `max_instance_count` à `1` via le flux **Update** de la
   plateforme RAD — `settings.json` est un fichier modifiable unique,
   et non une base de données transactionnelle, si bien que des écritures concurrentes risquent d'entraîner une perte d'écriture.

3. **Mettez à jour l'étiquette de version de l'application** via le flux **Update**
   de la plateforme RAD. L'image étant réellement préconstruite (`ghcr.io/seerr-team/seerr`),
   aucune étape Cloud Build locale n'intervient — la plateforme fait simplement pointer la prochaine
   révision vers la nouvelle étiquette.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~seerr"
   ```

5. **Inspectez le volume de paramètres** — `settings.json` et les fichiers associés :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~seerr" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
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
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Révision non opérationnelle / le service ne répond pas :** inspectez la dernière révision
  et ses journaux. La sonde de démarrage cible `/api/v1/status`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **Les paramètres (connexion au serveur multimédia, curseurs, agents de notification) semblent
  se « réinitialiser » après un redéploiement ou un redémarrage.** C'est le symptôme classique du
  piège `DB_TYPE` — Seerr s'est rabattu sans avertissement sur une base de données SQLite locale au
  conteneur. Vérifiez que `DB_TYPE=postgres` est bien injecté (voir la tâche 2, étape
  3). Si vous avez personnalisé `environment_variables` en remplaçant toute la map
  au lieu d'y ajouter des entrées, c'est la cause la plus probable.

- **L'application démarre et réussit les contrôles de santé, mais l'historique des demandes est vide
  après un démarrage à froid consécutif à une mise à l'échelle à zéro.** Vérifiez que l'instance Cloud SQL et le
  rôle de base de données existent et que `enable_cloudsql_volume = true` :
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project="$PROJECT"
  ```

- **Erreurs 401/403 lors des appels à Sonarr/Radarr depuis le flux d'approbation des demandes
  de Seerr.** Il s'agit d'un problème d'identifiants au niveau applicatif, dans les
  paramètres propres à Seerr (clés d'API saisies pendant la configuration), et non d'un problème de plateforme ou de module
  — revérifiez la clé d'API et l'URL de base saisies dans la page Settings →
  Services de Seerr.

- **Erreurs 403 / d'autorisation provenant de GCP lui-même :** vérifiez les rôles IAM du compte
  de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible. Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer, utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. La suppression retire tout ce que le module a créé —
le service Cloud Run, la base de données et le rôle Cloud SQL, le bucket GCS `storage`
(et son `settings.json`), les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le registre, l'instance Cloud SQL
elle-même) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL PostgreSQL et un bucket GCS de paramètres |
| 2 — Accéder et vérifier | Manuel | `/api/v1/status` renvoie du JSON ; terminer l'assistant de configuration ; vérifier que `DB_TYPE=postgres` est bien injecté |
| 3 — Exploiter | Manuel | Inspecter les révisions, comprendre le compromis concurrence/écriture des paramètres, mettre à jour la version, inspecter le bucket de paramètres |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de repli DB_TYPE et de base de données au démarrage à froid |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket de paramètres et la base de données |
