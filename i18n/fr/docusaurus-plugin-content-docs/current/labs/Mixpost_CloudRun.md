---
title: "Mixpost sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Mixpost sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Mixpost_CloudRun.md @ 3055034 sha256:75dcb9e3d05c -->

# Mixpost sur Cloud Run — Guide de lab {#mixpost-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Mixpost est une plateforme open source et auto-hébergée de planification et de gestion des
réseaux sociaux — une alternative à Buffer/Hootsuite pour rédiger, planifier, publier
et analyser des publications sur plusieurs comptes sociaux depuis un seul tableau de bord. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Mixpost on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Mixpost. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Comprendre le compromis lié au démarrage à froid pour la publication planifiée et savoir
  rétablir un fonctionnement continu.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, l'hôte NFS/Redis, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Mixpost (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (l'image préconstruite `inovector/mixpost`
   — sans build personnalisé), une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret
   Manager (la `APP_KEY` de Laravel et le mot de passe de la base), un bucket Cloud
   Storage, réplique l'image préconstruite dans Artifact Registry et exécute un
   job ponctuel `db-init` qui crée la base de données et l'utilisateur de l'application. Les premiers
   déploiements prennent environ **15 à 30 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~mixpost" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est joignable. La sonde de démarrage est une sonde TCP sur le port 80, et la
   sonde de vivacité est une sonde HTTP sur `/`, à laquelle Mixpost/nginx répond par `200` :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous. Le compte administrateur de Mixpost est
   **créé par l'image elle-même** et n'est pas configurable via ce module —
   le paramètre `mixpost_admin_email` est déclaré mais n'est pas actuellement injecté dans
   le conteneur en cours d'exécution. Utilisez les identifiants de première connexion par défaut documentés pour l'image
   (`admin@example.com` / `changeme`) et **changez le mot de passe
   immédiatement** après la première connexion.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, donc la mise à l'échelle est une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application).

3. **Comprenez le compromis de la publication planifiée.** Ce module utilise par défaut
   `min_instance_count = 0` et `cpu_always_allocated = false` (démarrage à froid,
   facturation à la requête). Le worker de file d'attente de Mixpost et le planificateur Laravel s'exécutent
   dans le même conteneur sous supervisord ; ils ne s'exécutent donc que lorsqu'une
   instance se trouve être active ou en train de traiter une requête — **les publications sociales planifiées
   ne sont pas publiées de manière fiable par elles-mêmes dans la configuration par défaut**, car Cloud Run ne
   met en place automatiquement aucun job Cloud Scheduler. Pour fiabiliser la
   publication planifiée, vous pouvez :
   - pointer un job Cloud Scheduler vers un point de terminaison cron/de contrôle d'état sur `$SERVICE_URL`
     toutes les minutes afin de garder une instance active et de déclencher `schedule:run` (utilisez la
     variable de base générique `cron_jobs` ou un planificateur externe), ou
   - définir `cpu_always_allocated = true` **et** `min_instance_count >= 1` sur le
     module et appliquer via **Update**, afin que le planificateur s'exécute en continu
     (conformément à la convention « toujours actif » du dépôt pour les applications avec traitement en arrière-plan).

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est récupérée et une nouvelle révision
   est déployée — il n'existe pas de job de migration distinct, puisque l'image exécute
   `php artisan migrate --force` à chaque démarrage.

5. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~mixpost"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + any scheduled backup jobs
   ```

6. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. mixpostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^mixpost" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
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
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. Le module peut provisionner un **test de disponibilité** (désactivé
   par défaut — `uptime_check_config.enabled = false`) ; activez-le pour un
   déploiement de production et vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Mixpost.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage est une sonde TCP sur le port 80 (délai initial de 90 s, seuil d'échec élevé pour le premier
  démarrage) ; la sonde de vivacité est une sonde HTTP sur `/`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et
  que le job `db-init` s'est terminé. Ce module définit par défaut `enable_cloudsql_volume =
  false` (TCP/IP privée, et non le socket de l'Auth Proxy) — si l'application ne parvient pas à joindre
  la base de données, examinez l'environnement de la révision déployée pour savoir si c'est un chemin socket ou TCP
  qui est réellement en vigueur.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les publications planifiées ne sont pas publiées :** c'est attendu avec la configuration par défaut
  à démarrage à froid — consultez la tâche 3, étape 3, pour la correction (appel cron Cloud Scheduler, ou
  `cpu_always_allocated = true` + `min_instance_count >= 1`).
- **Identifiants de connexion inconnus / « admin account not configured » :** le compte
  administrateur est créé par l'image elle-même, et non par la variable
  `mixpost_admin_email` de ce module — utilisez les identifiants par défaut documentés pour l'image.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais
renouveler `APP_KEY` après le premier démarrage, et l'immuabilité de
`application_database_name` / `application_database_user`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, l'hôte NFS/Redis,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets et un bucket de stockage, puis exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; se connecter avec les identifiants administrateur par défaut de l'image et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer le compromis de la publication planifiée, les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de planification et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
