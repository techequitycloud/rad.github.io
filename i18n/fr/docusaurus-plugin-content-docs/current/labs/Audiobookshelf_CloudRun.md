---
title: "Audiobookshelf sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Audiobookshelf sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Audiobookshelf_CloudRun.md @ 3055034 sha256:f870a9c9d643 -->

# Audiobookshelf sur Cloud Run — Guide de lab {#audiobookshelf-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Audiobookshelf est un serveur auto-hébergé de livres audio et de podcasts, doté d'une interface web, d'applications mobiles et d'une synchronisation de la progression d'écoute par utilisateur. Ce lab vous accompagne tout au long du cycle de vie opérationnel du module **Audiobookshelf sur Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Audiobookshelf. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisé par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris son paramètre d'entrée (ingress).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer le bucket d'état persistant.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour ne comportent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Audiobookshelf (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. `ingress_settings` vaut déjà
   `"all"` par défaut ; l'interface web est donc joignable depuis votre navigateur à la tâche 2 sans aucune modification ;
   définissez plutôt `ingress_settings = "internal"` si vous souhaitez restreindre le service à un
   accès depuis le VPC uniquement. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un **bucket d'état** GCS dédié
   monté sur `/data` via GCS FUSE, et construit l'image de conteneur légère qui enveloppe l'image amont
   (`FROM ghcr.io/advplyr/audiobookshelf`) dans Artifact Registry. Il n'y a **ni base de
   données Cloud SQL, ni Redis, ni job d'initialisation** — Audiobookshelf initialise lui-même
   sa base de données SQLite au premier démarrage. Sans base de données à créer, les premiers déploiements sont
   relativement rapides : environ **10–20 minutes** (le build de l'image par Cloud Build
   représente l'essentiel de la durée).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~audiobookshelf" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le chemin de santé d'Audiobookshelf est `/healthcheck`,
   qui renvoie HTTP 200 sans authentification une fois le serveur prêt (la sonde de démarrage
   accorde environ 115 secondes de délai au premier démarrage) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthcheck"
   ```

   > Si cette commande renvoie **404**, vérifiez si `ingress_settings` a été modifié en
   > `"internal"` (la valeur par défaut est `"all"`, joignable publiquement) — un service
   > `internal` ne répond qu'aux appelants situés dans le VPC. Remettez le paramètre d'entrée à
   > `all` via **Update** sur la page de détails du déploiement (ou vérifiez depuis une VM située dans
   > le VPC).

2. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier démarrage, Audiobookshelf présente son
   **assistant de configuration initiale** — créez l'utilisateur **root** (administrateur) initial avec un mot de passe
   robuste. Il n'y a aucun identifiant généré à récupérer : ce module ne crée **aucun
   secret d'application** (pas de mot de passe de base de données, pas de clé maîtresse). Les jetons d'API pour les
   applications mobiles ou l'automatisation sont générés ultérieurement dans l'interface web.

3. Durcissement immédiat : comme le compte administrateur est créé par la première personne qui atteint
   l'assistant, effectuez l'étape 2 juste après le déploiement — ou définissez `ingress_settings =
   "internal"` (la valeur par défaut est `"all"`, public) / activez IAP en attendant.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module gère la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors du prochain apply). **Conservez `max_instance_count = 1`** : Audiobookshelf sert une
   bibliothèque SQLite partagée unique depuis un seul volume — un second rédacteur risque de la corrompre.
   `min_instance_count = 0` ne met pas les données en danger (l'état est sur GCS) mais ajoute un démarrage à froid.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version` via
   **Update** sur la page de détails du déploiement ; Cloud Build produit une nouvelle image et une
   nouvelle révision est déployée. Notez que `latest` construit la version amont épinglée — épinglez une
   étiquette explicite pour maîtriser les mises à niveau.

4. **Gérez l'état persistant et les jobs** (tout l'état d'Audiobookshelf — base SQLite,
   configuration, pochettes, métadonnées — se trouve dans le bucket `/data`) :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~audiobookshelf"
   gcloud storage ls "gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~audiobookshelf" --format="value(name)" --limit=1)/"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # backup jobs, if any
   ```

5. **Sauvegardez l'état** à la demande en copiant le bucket (le module prend également en charge une
   sauvegarde planifiée via `backup_schedule`) :

   ```bash
   gcloud storage cp -r "gs://<state-bucket>/config" "gs://<your-backup-bucket>/abs-config-$(date +%F)/"
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
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation du CPU / de la
   mémoire (les analyses de bibliothèque sont les pics de CPU/mémoire à surveiller). Le **test de
   disponibilité** (uptime check) du module (`uptime_check_config`) vaut `enabled = false` par défaut,
   indépendamment de l'entrée — activez-le (chemin `/healthcheck`) via **Update** et
   vérifiez qu'il est au vert sous Monitoring → Uptime checks. Notez qu'il ne peut réussir que
   contre un point de terminaison joignable publiquement ; il nécessite donc `ingress_settings = "all"`
   (la valeur par défaut) pour aboutir.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Audiobookshelf à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux ; la sonde de démarrage (`/healthcheck`) accorde environ 115 secondes avant que l'instance ne soit
  déclarée en échec :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **404 sur chaque requête :** il s'agit presque toujours du paramètre d'entrée — `internal` renvoie
  404 aux appelants externes. Vérifiez avec
  `gcloud run services describe "$SERVICE" --format="value(metadata.annotations['run.googleapis.com/ingress'])"`.
- **État manquant après un redéploiement / erreurs de volume :** vérifiez le montage GCS FUSE —
  `execution_environment` doit valoir `gen2`, et le bucket `storage` doit exister
  (`gcloud storage buckets list --filter="name~audiobookshelf"`). Les signalements de perte d'état
  signifient généralement que le bucket a été recréé, et non que SQLite a échoué.
- **Échec du job d'initialisation :** ce module n'injecte aucun job d'initialisation par défaut ; les échecs
  à ce niveau ne concernent donc que les jobs personnalisés que vous avez ajoutés :
  ```bash
  gcloud run jobs executions list --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec
  (`gcloud builds list --project="$PROJECT" --limit=5`). Une erreur `MANIFEST_UNKNOWN` sur
  l'image de base signifie que l'étiquette `application_version` demandée n'existe pas en amont.
- **Analyses de bibliothèque lentes / démarrages de lecture poussifs (propre à l'application) :** SQLite et l'indexation
  des médias sur GCS FUSE ont une latence réelle. Pour les grandes bibliothèques, réduisez la fréquence
  des analyses, ou passez à `Audiobookshelf_GKE`, qui utilise un PVC en mode bloc sur `/data`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (elle fait oublier le déploiement à RAD). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket d'état GCS (y compris la base de données SQLite et toutes les métadonnées de la bibliothèque) et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, le bucket d'état GCS `/data`, et construit l'image — pas de base de données, pas de secrets |
| 2 — Accéder et vérifier | Manuel | `/healthcheck` renvoie 200 ; créer l'utilisateur root dans l'assistant de configuration initiale |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle dans le respect de la contrainte d'un rédacteur unique, mettre à jour la version, gérer le bucket d'état |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et activer le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'entrée, de FUSE/état, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
