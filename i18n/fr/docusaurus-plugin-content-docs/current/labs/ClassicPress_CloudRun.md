---
title: "ClassicPress sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez ClassicPress sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/ClassicPress_CloudRun.md @ 3055034 sha256:96792fcbb737 -->

# ClassicPress sur Cloud Run — Guide de lab {#classicpress-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ClassicPress est un CMS libre et open source orienté entreprise — un fork léger de
WordPress 4.9.x qui préserve l'expérience d'édition classique (antérieure à Gutenberg), avec
extensions, thèmes, médiathèque et API REST. Ce lab vous fait parcourir tout le cycle
de vie opérationnel du module **ClassicPress on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de ClassicPress. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et terminer l'installateur initial de ClassicPress.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Vérifier comment le montage NFS par défaut assure la persistance des fichiers téléversés, extensions et thèmes sur
  Cloud Run, et connaître les réserves qui subsistent à ce sujet.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **ClassicPress (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme construit une image personnalisée légère (`FROM classicpress/classicpress`) via
   Cloud Build, provisionne le service Cloud Run, une base de données Cloud SQL pour MySQL 8.0
   avec ses secrets Secret Manager (`CLASSICPRESS_SALT_SEED` et le mot de passe de la
   base de données), une instance Filestore (NFS) (`enable_nfs = true` par défaut), deux buckets
   Cloud Storage (`data` et `classicpress-uploads`), puis exécute un job ponctuel
   d'initialisation de la base de données (`db-init`) qui crée la base de données de l'application et
   son utilisateur. Un premier déploiement prend environ **15 à 30 minutes** (la création de Cloud SQL
   et de Filestore domine).

3. Une fois terminé, identifiez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~classicpress" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. ClassicPress n'a pas de point de terminaison de santé dédié avant
   l'installation ; une simple vérification d'accessibilité est donc la bonne première sonde :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   # expect 200 (already installed) or 302 (redirect to the first-run installer)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Sur une base de données vierge, ClassicPress redirige vers
   `/wp-admin/install.php` — terminez l'installateur (titre du site, nom d'utilisateur administrateur,
   mot de passe et adresse e-mail) pour créer le schéma et le compte administrateur. Il n'existe
   **aucun identifiant administrateur pré-renseigné** dans Secret Manager ; l'installateur est le seul
   moyen d'en définir un.

3. Connectez-vous sur `$SERVICE_URL/wp-login.php` avec le compte que vous venez de créer et
   vérifiez que le tableau de bord se charge.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc une
   modification de configuration et non une modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors de la prochaine application). Conservez `max_instance_count = 1` : `wp-content` (fichiers téléversés, extensions,
   thèmes) est partagé entre les instances via le montage NFS, mais les fichiers du cœur de ClassicPress
   situés hors de `wp-content` sont copiés indépendamment par chaque instance au démarrage, et la
   sécurité des écritures concurrentes sur le montage partagé `wp-content` entre plusieurs répliques
   n'a pas été validée pour ce module.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~classicpress"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. classicpressdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^classicpress" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Les médias téléversés, extensions et thèmes persistent par défaut d'un démarrage à froid à l'autre.**
   Ce module utilise par défaut `min_instance_count = 0` (réduction à zéro) et
   `enable_nfs = true`, qui monte Filestore sur `/var/www/html/wp-content` — le
   répertoire où ClassicPress (un fork de WordPress) lit et écrit les médias téléversés,
   les extensions installées et les thèmes. La logique de copie au premier démarrage du point d'entrée amont
   ignore explicitement un répertoire `wp-content` existant au lieu de l'écraser ;
   c'est donc le montage NFS à cet emplacement qui rend ce contenu durable malgré le renouvellement des instances
   (délai d'inactivité, redéploiement, remplacement d'instance). Seuls les fichiers du *cœur* de ClassicPress
   situés hors de `wp-content` sont copiés à neuf dans `/var/www/html` à chaque démarrage
   à froid — ce qui est attendu, puisque ces fichiers sont livrés avec l'image et n'ont besoin d'aucune persistance.
   Vous pouvez le vérifier vous-même : téléversez un fichier média, provoquez un démarrage à froid (attendez
   au-delà du délai d'inactivité ou forcez une nouvelle révision), puis vérifiez que le fichier est toujours
   présent.

   Deux réserves subsistent, à connaître :

   - **Les deux buckets GCS provisionnés par le module (`data` et `classicpress-uploads`)
     ne sont pas branchés par défaut en tant que montage `gcs_volumes`.** Ils existent mais restent
     inutilisés tant que vous n'ajoutez pas d'entrée `gcs_volumes` — c'est NFS qui assure la persistance
     effectivement active dès l'installation, et non ces buckets.
   - **`max_instance_count` reste à `1` par défaut.** `wp-content` est partagé entre
     les instances via NFS, mais la sécurité des écritures concurrentes de plusieurs répliques simultanées
     sur ce montage partagé n'a pas été validée pour ce module —
     voir le point 2 ci-dessus.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. `uptime_check_config` est désactivé (`enabled = false`) par
   défaut pour ce module — activez-le dans la plateforme si vous souhaitez un contrôle de disponibilité
   Monitoring et une alerte en cas d'échec du contrôle.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de ClassicPress.

- **Les fichiers téléversés ou les extensions installées semblent disparaître après une période
  d'inactivité :** avec la valeur par défaut `enable_nfs = true`, `wp-content` (fichiers téléversés, extensions,
  thèmes) est monté sur Filestore à `/var/www/html/wp-content` et doit survivre aux
  démarrages à froid après réduction à zéro — la logique de copie du point d'entrée amont ignore ce
  répertoire au lieu de l'écraser. Si du contenu disparaît réellement, vérifiez d'abord
  que `enable_nfs` n'a pas été désactivé et que l'instance Filestore est
  `READY` (`gcloud filestore instances list --project="$PROJECT"`) plutôt que de
  supposer que la persistance est défaillante par conception. Comparez le nombre de fichiers de `wp-content/uploads`
  avant et après une période d'inactivité assez longue pour déclencher la réduction à zéro, ou vérifiez
  que l'identité de la révision ou de l'instance a changé :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  ```
- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage est de type TCP sur le port 80 avec un `failure_threshold = 20` généreux, ce qui laisse au
  point d'entrée amont le temps de remplir `/var/www/html` au premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Le site reste bloqué sur l'installateur initial alors que vous pensiez l'avoir terminé :**
  `wp-config.php` et les fichiers du cœur de ClassicPress sont recréés à neuf à chaque
  démarrage à froid (c'est attendu — ils sont livrés avec l'image), tandis que la base de données et
  `wp-content` (via NFS) persistent. Si l'installateur semble se relancer, vérifiez que
  le schéma de la base de données a bien été écrit lors de la tentative précédente — `db-init` ne fait que
  créer la base de données vide et son utilisateur ; l'installateur lui-même doit aboutir
  pour créer le schéma et le compte administrateur. Relancer l'installateur
  sur une base de données déjà remplie n'est pas sûr ; vérifiez d'abord l'état du schéma
  avec `gcloud sql connect` avant de réessayer.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et
  que le job `db-init` s'est terminé avec succès. MySQL est joint via TCP sur IP privée par
  défaut (`enable_cloudsql_volume = false`) ; aucune configuration SSL n'est requise.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`CLASSICPRESS_SALT_SEED` après le premier démarrage, ainsi que le détail complet du
mécanisme de persistance adossé à NFS décrit plus haut).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, l'instance Filestore, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, l'instance Cloud
SQL partagée, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), Filestore, les secrets et les buckets de stockage, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | La vérification d'accessibilité réussit ; terminer l'installateur initial pour créer le compte administrateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base ; vérifier la persistance des fichiers téléversés/extensions/thèmes adossée à NFS d'un démarrage à froid à l'autre |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et d'IAM ; vérifier la persistance des fichiers téléversés/extensions adossée à NFS d'un démarrage à froid à l'autre |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
