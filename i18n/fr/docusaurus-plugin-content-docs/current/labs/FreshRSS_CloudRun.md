---
title: "FreshRSS sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez FreshRSS sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/FreshRSS_CloudRun.md @ 3055034 sha256:ab555e120fb0 -->

# FreshRSS sur Cloud Run — Guide de lab {#freshrss-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

FreshRSS est un agrégateur de flux RSS et Atom gratuit et auto-hébergé — un
« lecteur d'actualités » léger et multi-utilisateur écrit en PHP, qui expose
les API Google Reader et Fever pour les clients mobiles. Ce lab vous fait
parcourir l'ensemble du cycle de vie opérationnel du module
**FreshRSS on Cloud Run** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants, puis le démonter.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit FreshRSS. Pour la liste
complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris l'installation au premier démarrage et la connexion administrateur.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démonter proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le serveur NFS, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **FreshRSS (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (PHP/Apache sur le port 80),
   une base de données et un utilisateur Cloud SQL (PostgreSQL 15) avec les
   secrets `FRESHRSS_ADMIN_PASSWORD` et du mot de passe de la base de données
   dans Secret Manager, un volume NFS monté sur
   `/var/www/FreshRSS/data` (aucun bucket GCS n'est créé), construit l'image de
   conteneur personnalisée et exécute une tâche ponctuelle `db-init`. Les
   premiers déploiements prennent environ **15–25 minutes** (la création de
   Cloud SQL représente l'essentiel de ce temps).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres
   indépendants des noms (afin que les commandes continuent de fonctionner quel
   que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~freshrss" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est en bonne santé. FreshRSS expose un point de
   terminaison JSON `/status` non authentifié qui répond dès que le serveur est
   opérationnel :

   ```bash
   curl -s "$SERVICE_URL/status"   # expect a JSON status response
   ```

2. Récupérez le mot de passe administrateur généré automatiquement dans Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freshrss AND name~ADMIN_PASSWORD" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom
   d'utilisateur `admin` et le mot de passe obtenu à l'étape 2. À la première
   requête, le point d'entrée du conteneur exécute le programme d'installation
   propre à FreshRSS (`do-install.php` + `create-user.php`) ; prévoyez donc une
   marge confortable au premier démarrage avant que la page de connexion se
   stabilise — cette opération est idempotente et ne s'exécute qu'une fois.
   Après vous être connecté, **changez le mot de passe administrateur dans
   l'interface de FreshRSS** — faire tourner la seule valeur dans Secret
   Manager ne réinitialise pas un compte déjà installé.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances et en cliquant sur **Update** sur la page de détails du
   déploiement — le module est propriétaire de la spécification du service : la
   mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée
   lors de l'application suivante). Par défaut, `min_instance_count = 0` (mise à
   l'échelle jusqu'à zéro) et
   `max_instance_count = 1`. La tâche cron d'actualisation des flux dans le
   conteneur (`CRON_MIN = */15`) ne se déclenche que tant qu'une instance est
   active ; si vous avez besoin que les flux s'actualisent selon un calendrier
   fixe plutôt qu'à la requête suivante, définissez `min_instance_count = 1`.
   Conservez `max_instance_count` à `1` — une seule instance détient le cron
   d'actualisation et l'état de session et de cache stocké sous forme de
   fichiers sur le volume NFS.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et une nouvelle révision est déployée.
   `application_version = "latest"` est figé sur un tag réputé fiable au moment
   du build — fixez-le explicitement pour la production.

4. **Gérez les secrets et la base de données :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~freshrss"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init (and import job, if enabled)
   gcloud sql backups list --instance=<instance-name> --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. freshrssdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre pour Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du
   processeur et de la mémoire. `uptime_check_config` est désactivé par défaut —
   activez-le et examinez Monitoring → Uptime checks et Alerting → Policies si
   vous souhaitez des alertes de disponibilité automatisées.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de FreshRSS à l'autre.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage. La sonde de
  démarrage est un contrôle TCP sur le port 80 ; la sonde de vivacité est une
  requête HTTP GET sur `/` — une installation lente au premier démarrage
  (création du schéma) peut épuiser un seuil trop serré.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`, que le secret du mot de passe de la base de données
  existe, que `enable_cloudsql_volume = true` (socket de l'Auth Proxy) et que
  la tâche `db-init` s'est terminée avec succès.
- **Échec de la tâche `db-init` :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Configuration / état réinitialisés à chaque démarrage à froid :** vérifiez
  que `enable_nfs = true` et
  `nfs_mount_path = /var/www/FreshRSS/data` ; sans le volume NFS, `config.php`
  et l'état propre à chaque utilisateur résident sur un disque éphémère et sont
  perdus à chaque démarrage à froid.
- **Les flux ne s'actualisent pas :** le cron du conteneur ne s'exécute que
  tant qu'une instance est active — avec `min_instance_count = 0`, les
  actualisations sont suspendues jusqu'à ce que la requête suivante réveille le
  service. Définissez `min_instance_count = 1` pour une actualisation régulière
  et fiable.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de
configuration pour les pièges propres à chaque paramètre (notamment les règles
essentielles concernant `enable_nfs`,
`database_type` et le caractère immuable de `db_name`/`db_user`).

---

## Tâche 6 — Démonter [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données et l'utilisateur Cloud SQL, les secrets Secret Manager et le
contenu du répertoire de données stocké sur NFS. Les ressources appartenant à
**Services_GCP** (le VPC, l'instance Cloud SQL partagée, le serveur NFS partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets et un volume NFS, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | `/status` répond ; se connecter en tant que `admin` avec le mot de passe généré, puis le changer |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et la base de données, régler le cron d'actualisation |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de `db-init`, de NFS et de cron d'actualisation |
| 6 — Démonter | Automatisé | La suppression (Trash) retire toutes les ressources du module |
