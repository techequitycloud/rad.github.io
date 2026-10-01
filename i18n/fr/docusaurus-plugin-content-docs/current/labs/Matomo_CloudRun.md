---
title: "Matomo sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Matomo sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Matomo_CloudRun.md @ 3055034 sha256:6a39a788e259 -->

# Matomo sur Cloud Run — Guide de lab {#matomo-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Matomo est la principale plateforme open source d'analyse web — une alternative auto-hébergée à Google Analytics, axée sur la confidentialité. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Matomo on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités de Matomo. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun) — ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et terminer l'installateur web de premier démarrage de Matomo.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu'elle affiche, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Matomo (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec son secret de mot de passe dans Secret Manager, un partage NFS Filestore qui conserve
   la racine documentaire de Matomo (`/var/www/html`), un bucket GCS `matomo-data` dédié,
   recopie l'image officielle `matomo:5-apache` dans Artifact Registry (pas d'étape de
   build — il s'agit d'un module préconstruit), et exécute une tâche ponctuelle `db-init` qui crée
   la base de données vide et l'utilisateur. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~matomo" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est opérationnel. Le chemin de vérification de santé de Matomo est `/`, qui renvoie HTTP 200 —
   ou une **redirection 302 vers l'installateur sur un nouveau déploiement** — dès qu'Apache et PHP sont en cours d'exécution.
   Avec la mise à l'échelle à zéro par défaut, prévoyez un démarrage à froid de 10 à 30 secondes à la première
   requête :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Sur un nouveau déploiement, Matomo présente son **installateur
   web** : l'écran de base de données est prérempli à partir des variables d'environnement
   `MATOMO_DATABASE_*` injectées (la tâche `db-init` a déjà créé la
   base de données vide et l'utilisateur) ; parcourez donc les étapes, créez le compte **superuser** (super-utilisateur) et
   enregistrez votre premier site web suivi. L'installateur écrit `config.ini.php` dans la
   racine documentaire conservée sur NFS, de sorte que la configuration survit aux redémarrages. Si vous avez besoin du
   mot de passe de la base de données :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~matomo" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. **Durcissement immédiat :** l'URL de l'installateur est publique tant que la configuration n'est pas terminée —
   terminez l'assistant juste après le déploiement. Copiez ensuite l'extrait de suivi depuis
   **Administration → Websites → Tracking Code** dans une page de test et confirmez que la
   visite apparaît sous **Visitors → Visits Log**.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service ; la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply). Notez que le
   module utilise par défaut `min = 0`, `max = 1` : passez `min` à `1` pour un traceur de
   production toujours chaud, et conservez `max = 1` tant que la sécurité en multi-instance sur la
   racine documentaire NFS partagée n'a pas été confirmée.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (utilisez un tag de **variante Apache**, par exemple `5.x-apache`) via **Update** sur la
   page de détails du déploiement ; la nouvelle image est recopiée et une nouvelle révision est déployée.
   Matomo exécute ses propres migrations de schéma depuis la racine documentaire persistante.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~matomo"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~matomo"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (les tables d'analyse utilisent
   le préfixe `matomo_`) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. matomodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^matomo" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU
   et de la mémoire. Le **test de disponibilité du module est désactivé par défaut**
   (`uptime_check_config.enabled = false`) — activez-le via **Update** pour la
   production, puis confirmez qu'il est au vert sous Monitoring → Uptime checks et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Matomo.

- **Révision non saine / le service ne répond pas :** la sonde de démarrage est TCP, avec un
  seuil généreux de 20 échecs pour couvrir la copie, au premier démarrage, de l'application
  depuis `/usr/src/matomo` vers le volume NFS vide. Inspectez la dernière révision et
  ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** Matomo se connecte en **TCP à l'adresse IP privée de Cloud
  SQL** (`enable_cloudsql_volume = false` ; l'adresse IP est injectée sous la forme
  `MATOMO_DATABASE_HOST`). Confirmez que l'instance MySQL 8.0 est `RUNNABLE`, que le secret du mot de passe
  de la base de données existe et que la tâche `db-init` s'est terminée — elle vérifie les identifiants de
  l'utilisateur de l'application ; une tâche `db-init` au vert écarte donc la plupart des problèmes d'authentification.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Montage NFS / l'installateur réapparaît après un redémarrage :** vérifiez `enable_nfs = true`,
  `nfs_mount_path = /var/www/html`, et que l'environnement d'exécution est `gen2`
  (requis pour les montages Filestore dans Cloud Run). Si la racine documentaire n'est pas
  conservée, `config.ini.php` est perdu à chaque redémarrage et Matomo revient à l'installation.
- **Échec du pull de l'image :** il s'agit d'un module **préconstruit** — il n'y a pas d'étape Cloud
  Build. Vérifiez que l'image recopiée existe dans Artifact Registry et que
  `application_version` est un véritable tag de **variante Apache** (`5-apache`, `5.x-apache`) ;
  les tags fpm/alpine ne servent pas HTTP sur le port 80.
- **Pages lentes sous fort trafic (propre à l'application) :** Matomo utilise par défaut
  l'archivage des rapports déclenché par le navigateur, qui s'exécute au sein des requêtes des visiteurs. Pour les sites
  très fréquentés, ajoutez une entrée `cron_jobs` exécutant `console core:archive` afin que l'archivage s'exécute
  plutôt sous forme de Cloud Run Job planifié.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à
chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris le bucket `matomo-data`),
le partage NFS Filestore et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), NFS, le bucket GCS, les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | La vérification de santé réussit ; terminer l'installateur web de Matomo et vérifier le suivi |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer secrets/sauvegardes/stockage, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; activer le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation, de NFS, d'image, d'archivage et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
