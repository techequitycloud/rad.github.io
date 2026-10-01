---
title: "Navidrome sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Navidrome sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Navidrome_CloudRun.md @ 3055034 sha256:3e168833aaa1 -->

# Navidrome sur Cloud Run — Guide de lab {#navidrome-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Navidrome est un serveur de streaming musical gratuit, open source, auto-hébergé et compatible Subsonic,
écrit en Go. Il ne dispose d'aucune base de données externe — l'intégralité de son état (bibliothèque,
utilisateurs, playlists) réside dans un fichier SQLite intégré. Ce lab vous fait parcourir
l'intégralité du cycle de vie opérationnel du module **Navidrome on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Navidrome. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et récupérer le mot de passe administrateur généré.
- Effectuer les opérations du jour 2 — inspecter les révisions, monter une bibliothèque musicale, gérer
  les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service partagés
  dont dépend ce module — Navidrome lui-même n'a besoin d'aucune instance Cloud SQL).
  Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Navidrome (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que le service utilise par défaut
   `ingress_settings = internal` (privé au VPC) et `enable_admin_password = true`
   (obligatoire si vous prévoyez de passer à une entrée publique). Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage dédié
   monté sur `/data` via GCS FUSE (la base de données SQLite, le cache de métadonnées et l'index
   de recherche s'y trouvent tous), un secret Secret Manager contenant un mot de passe administrateur généré de 24 caractères,
   et réplique l'image `deluan/navidrome` dans Artifact Registry.
   Il n'y a **ni instance Cloud SQL ni job d'initialisation de la base de données** — Navidrome
   crée et migre sa propre base de données SQLite au premier démarrage. Les premiers déploiements
   se terminent généralement en **5–15 minutes**, bien plus vite qu'un module adossé à une
   base de données.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~navidrome" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

   Avec la valeur par défaut `ingress_settings = internal`, `$SERVICE_URL` n'est joignable que
   depuis l'intérieur du VPC (par exemple depuis une VM Compute Engine ou un Cloud Shell disposant d'un accès
   au VPC) — et non directement depuis votre machine locale.

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Navidrome expose un point de terminaison de ping non authentifié
   qui répond une fois le serveur démarré :

   ```bash
   curl -s "$SERVICE_URL/ping"   # expect {"status":"ok"}
   ```

2. Récupérez le mot de passe administrateur généré dans Secret Manager :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~navidrome-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur (depuis un hôte connecté au VPC, ou après être
   passé temporairement à `ingress_settings = all`) et connectez-vous en tant que `admin` avec le
   mot de passe récupéré. Changez le mot de passe dès la première connexion. Si
   `enable_admin_password = false` a été choisi à la place, le premier visiteur termine
   un assistant de création d'administrateur — faites-le vous-même immédiatement.

4. La bibliothèque musicale reste vide tant que vous n'en montez pas une. Ajoutez une entrée `gcs_volumes` (ou
   activez NFS) pointant `/music` vers votre collection audio, puis appliquez-la via
   **Update** — Navidrome analyse `ND_MUSICFOLDER` (`/music`) à chaque démarrage.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count = 1` maintient le serveur
   actif (ce qui évite la latence d'un démarrage à froid en pleine écoute) ; `max_instance_count = 1` doit
   rester à 1 — Navidrome est un serveur à écrivain unique, et plusieurs instances écrivant
   dans le même fichier SQLite via GCS FUSE corrompront la bibliothèque. Ces deux valeurs sont des
   paramètres de configuration de la page de détails du déploiement, et non des valeurs à modifier
   manuellement via `gcloud` (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (épinglée via l'argument de build
   `NAVIDROME_VERSION`) et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup job, if configured
   ```

   Le paramètre `backup_schedule` (par défaut `0 2 * * *` UTC) crée un instantané du bucket `/data`
   selon une planification cron ; `backup_retention_days` détermine la durée de conservation des instantanés.

5. **Inspectez directement le bucket `/data`** (utile pour confirmer la persistance
   d'une révision à l'autre) :

   ```bash
   gcloud storage ls gs://<data-bucket-name>/   # bucket name is in the storage_buckets output
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
   de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU / de la mémoire (Navidrome
   conserve son index de recherche en mémoire ; surveillez donc attentivement la mémoire avec une bibliothèque volumineuse).
   Un **test de disponibilité** (uptime check) n'est provisionné que lorsque le point de terminaison est joignable publiquement
   (domaine personnalisé, ou `ingress_settings = all`) — avec l'entrée par défaut `internal`,
   aucun test de disponibilité ne s'exécute ; ne vérifiez sous Monitoring → Uptime checks qu'après
   être passé à une entrée publique.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Navidrome.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `GET /ping` avec un délai initial de 15 secondes
  et une fenêtre de nouvelles tentatives généreuse ; la sonde de vivacité interroge le service toutes les 30
  secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Bibliothèque vide / aucun morceau trouvé :** vérifiez qu'une entrée `gcs_volumes` (ou un montage NFS)
  est bien rattachée à `/music` — le module ne monte pas automatiquement de source musicale,
  un déploiement non configuré n'a donc rien à analyser.
- **URL publique rejetée au moment du plan :** `ingress_settings = "all"` est bloqué
  sauf si `enable_admin_password = true` — c'est intentionnel, afin qu'un inconnu ne puisse
  jamais atteindre un assistant de premier lancement ouvert sur une URL publique.
- **`/data` semble effacé après un redéploiement :** vérifiez que le bucket de stockage n'a pas été
  supprimé ni redirigé — il constitue l'unique source de vérité pour la base de données SQLite,
  les utilisateurs et les playlists.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment pourquoi `max_instance_count` ne doit jamais dépasser
1, et pourquoi `execution_environment` doit rester `gen2`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run,
le bucket Cloud Storage `/data` (**cela supprime définitivement les métadonnées de la bibliothèque musicale,
les utilisateurs et les playlists** — il n'existe aucun Cloud SQL à sauvegarder séparément),
le secret Secret Manager du mot de passe administrateur et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le service Cloud Run, un bucket GCS FUSE `/data`, un secret de mot de passe administrateur, et réplique l'image — ni Cloud SQL, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification d'état (`/ping`) réussit ; récupérer le mot de passe administrateur généré et se connecter ; monter une bibliothèque musicale sur `/music` |
| 3 — Exploiter | Manuel | Inspecter les révisions, maintenir la mise à l'échelle à 1/1, mettre à jour la version, gérer les secrets/sauvegardes, inspecter `/data` |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring (test de disponibilité uniquement si le service est joignable publiquement) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de bibliothèque vide, de garde-fou d'entrée publique et de build/IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket `/data` |
