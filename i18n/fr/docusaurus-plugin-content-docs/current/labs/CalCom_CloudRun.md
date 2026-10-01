---
title: "Cal.com sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Cal.com sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CalCom_CloudRun.md @ 3055034 sha256:f1829586f995 -->

# Cal.com sur Cloud Run — Guide de lab {#calcom-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Cal.com est une plateforme de planification de rendez-vous open source — l'alternative auto-hébergée à Calendly — construite avec Next.js et Prisma sur PostgreSQL. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Cal.com on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Cal.com. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et terminer la prise en main initiale (onboarding) de Cal.com.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Cal.com (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (Next.js sur le port 3000), une base
   de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (le mot de passe
   de la base ainsi que `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY`, générés
   automatiquement), copie l'image Cal.com dans Artifact Registry et exécute un job
   ponctuel d'initialisation de la base de données qui crée la base vide et le rôle.
   **Aucun bucket GCS n'est créé** — Cal.com conserve tout son état dans PostgreSQL. Un
   premier déploiement prend environ **20–35 minutes** (la création de Cloud SQL en
   représente l'essentiel).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres
   indépendants des noms (pour que les commandes fonctionnent quel que soit le
   suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~calcom" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Le chemin de santé de Cal.com est `/`, qui renvoie
   HTTP 200 une fois que l'application a fini d'exécuter ses migrations Prisma au
   premier démarrage — le schéma est créé **au démarrage**, et non par le job
   d'initialisation ; prévoyez donc plusieurs minutes sur un nouveau déploiement (la
   fenêtre de la sonde de démarrage est d'environ 8 minutes précisément pour cette
   raison) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur et terminez l'onboarding de Cal.com pour
   créer le compte administrateur/propriétaire initial, puis connectez au moins un
   calendrier. **Renforcement à effectuer immédiatement :** Cal.com auto-hébergé
   autorise par défaut l'inscription en libre-service — restreignez-la (ou placez le
   service derrière IAP) si l'instance ne doit pas être publique. Le mot de passe de la
   base de données peut être récupéré au besoin :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~calcom" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Soyez rigoureux sur l'URL : `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` prennent par
   défaut l'URL déterministe `run.app`. Avant de partager des liens de réservation sur
   un domaine personnalisé, définissez `webapp_url` — l'URL publique est intégrée dans
   chaque lien de réservation et chaque lien OAuth.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Par défaut, le
   service se met à l'échelle à zéro (`min = 0`, `max = 1`, facturation à la requête) ;
   définissez `min_instance_count = 1` si les démarrages à froid gênent les personnes
   qui réservent.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   via **Update** sur la page de détails du déploiement ; le nouveau tag d'image est
   copié et une nouvelle révision est déployée, qui applique les éventuelles migrations
   Prisma en attente à son premier démarrage.

4. **Gérez les secrets et les jobs** — et sachez quels secrets sont immuables :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~calcom"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   `CALENDSO_ENCRYPTION_KEY` chiffre les identifiants de calendrier/OAuth stockés et
   `NEXTAUTH_SECRET` signe les sessions — **ne faites jamais tourner l'un ou l'autre
   après le premier démarrage** en dehors d'une fenêtre de maintenance planifiée (la
   rotation rend orphelins tous les calendriers connectés ou déconnecte tous les
   utilisateurs, respectivement).

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. calcomdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^calcom" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances
   (comportement de mise à l'échelle, y compris les périodes à zéro instance) et
   l'utilisation du CPU et de la mémoire. Le module provisionne également un **test de
   disponibilité** (uptime check) sur `/` ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Cal.com à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** Cal.com exécute
  `prisma migrate deploy` à chaque démarrage, et la sonde de démarrage accorde environ
  8 minutes aux migrations du premier démarrage. Inspectez la dernière révision et ses
  journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Plantage OOM au démarrage :** `memory_limit` doit être **≥ 2 GiB** — en dessous,
  Next.js 16 plante par manque de mémoire et la révision ne devient jamais Ready.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL
  (PostgreSQL 15) est `RUNNABLE`, que le secret du mot de passe de la base existe et
  que `enable_cloudsql_volume = true` — une connexion TCP directe par IP privée échoue à
  la vérification du certificat de Prisma face à l'autorité de certification de Cloud
  SQL ; le socket de l'Auth Proxy est indispensable.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Le serveur refuse de démarrer / erreurs d'URL :** Cal.com valide son URL publique
  au démarrage. Vérifiez que `webapp_url` (ou la valeur par défaut injectée) est une
  véritable URL — la valeur par défaut de l'image, `localhost:3000`, est rejetée.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution ; si IAP est activé, n'oubliez pas qu'il bloque *toutes* les requêtes non
  authentifiées — y compris les pages de réservation publiques et les intégrations
  (embeds).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL (tous les utilisateurs, types d'événements et
réservations), les secrets Secret Manager (y compris `NEXTAUTH_SECRET` et
`CALENDSO_ENCRYPTION_KEY`) et les images Artifact Registry. Les ressources appartenant
à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15) et les secrets, copie l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; terminer l'onboarding, restreindre l'inscription ouverte, définir `webapp_url` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, respecter les secrets immuables, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'OOM, de base de données, de job d'initialisation, de validation d'URL et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
