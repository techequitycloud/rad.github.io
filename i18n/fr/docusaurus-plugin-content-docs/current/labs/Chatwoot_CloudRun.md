---
title: "Chatwoot sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Chatwoot sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Chatwoot_CloudRun.md @ 3055034 sha256:cd0ec5abf048 -->

# Chatwoot sur Cloud Run — Guide de lab {#chatwoot-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Chatwoot est une plateforme open source et multicanal de support client et d'engagement
client (boîtes de réception e-mail, chat en direct, réseaux sociaux et messageries, suivi des SLA et
rapports) — une alternative conforme au RGPD à Zendesk ou Intercom. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Chatwoot on Cloud
Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Chatwoot. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les jobs.
- Observer le service (et son worker Sidekiq colocalisé) avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, NFS/Redis, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Chatwoot (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur Chatwoot personnalisée (`chatwoot/chatwoot`
   enveloppée dans un point d'entrée cloud), provisionne le service Cloud Run, une base de données Cloud
   SQL (PostgreSQL 15, avec `pgvector`) avec ses secrets Secret Manager
   (`SECRET_KEY_BASE` et le mot de passe de la base), un bucket Cloud Storage,
   un montage NFS Filestore pour les pièces jointes, et Redis. Elle exécute ensuite deux
   jobs d'initialisation **chaînés** — `db-init` (crée la base de données, le rôle
   et les droits, y compris `cloudsqlsuperuser`) suivi de `chatwoot-prepare`
   (`rails db:chatwoot_prepare`, qui utilise l'image applicative construite, pour créer le
   schéma). Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   et le build de l'image personnalisée représentent l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~chatwoot" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. La page de connexion/d'accueil de Chatwoot répond
   avec HTTP 200 et ne requiert aucune authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Vérifiez que les deux jobs d'initialisation chaînés se sont terminés avec succès avant
   de considérer que le schéma est prêt :

   ```bash
   gcloud run jobs executions list --job="${SERVICE}-db-init" \
     --project="$PROJECT" --region="$REGION"
   gcloud run jobs executions list --job="${SERVICE}-chatwoot-prepare" \
     --project="$PROJECT" --region="$REGION"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, l'interface d'accueil de Chatwoot
   vous invite à créer le compte administrateur initial de manière interactive — aucun
   identifiant administrateur pré-provisionné n'existe dans Secret Manager. Renseignez votre nom,
   votre e-mail et un mot de passe pour terminer l'accueil. `ENABLE_ACCOUNT_SIGNUP`
   vaut `"false"` par défaut, si bien qu'ensuite seuls les utilisateurs invités peuvent rejoindre la plateforme ; basculez-le
   temporairement via `environment_variables` si vous avez besoin d'une inscription publique en
   libre-service.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle
   est une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application). Le worker Sidekiq de Chatwoot (exécution des jobs
   en arrière-plan, notifications, rapports) et ActionCable (mises à jour de l'interface en temps réel)
   s'exécutent dans le même conteneur et ne fonctionnent que pendant le traitement d'une requête
   ou pendant la fenêtre de maintien à chaud qui suit la requête (`cpu_always_allocated
   = false` par défaut). En production, définissez `min_instance_count >= 1` et
   `cpu_always_allocated = true` pour assurer un traitement continu en arrière-plan.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (le tag de l'image `chatwoot/chatwoot`) dans la plateforme RAD et en l'appliquant
   via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chatwoot"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + chatwoot-prepare
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. chatwootdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^chatwoot" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez la persistance des pièces jointes** — les fichiers téléversés résident sur le NFS Filestore dans
   `/opt/chatwoot/storage`, et non dans le bucket GCS provisionné automatiquement dont le nom se termine
   par `storage` :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~chatwoot"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Le processus web Rails
   et le worker Sidekiq colocalisé écrivent tous deux sur les mêmes stdout/stderr du conteneur :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. Si un test de disponibilité est activé (`uptime_check_config`),
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Chatwoot.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et
  ses journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La
  sonde de démarrage cible `GET /` et accorde un délai initial de 60 secondes plus jusqu'à
  30 nouvelles tentatives à une période de 15 secondes (~8 minutes) — dimensionnée pour absorber
  la fin de `chatwoot-prepare` avant le conteneur de l'application.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échec d'un job d'initialisation :** `chatwoot-prepare` exige que `db-init`
  se termine d'abord ; si la préparation du schéma échoue avec `must be superuser` sur `CREATE
  EXTENSION`, le droit `cloudsqlsuperuser` dans `db-init` n'a pas été appliqué. Listez les
  exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-chatwoot-prepare" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`
  et que le secret du mot de passe de la base existe. Rappelez-vous que Cloud Run atteint Postgres via
  un socket Unix (`/cloudsql/<instance>`), et non via un bouclage TCP `127.0.0.1` — cette
  forme de bouclage ne s'applique qu'à la variante GKE.
- **Les jobs en arrière-plan/notifications ne sont pas délivrés alors que l'interface se charge correctement :**
  Sidekiq ne s'exécute que tant que le conteneur est actif. Vérifiez `min_instance_count`
  et `cpu_always_allocated` — avec `min=0`/`cpu_always_allocated=false`, Sidekiq
  se met en pause entre les requêtes et la fenêtre de maintien à chaud.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build
  en échec. Un tag `application_version` inexistant (par exemple une valeur par défaut héritée
  d'une autre application) fait échouer la récupération avec `MANIFEST_UNKNOWN` — vérifiez que le tag existe
  sur Docker Hub pour `chatwoot/chatwoot`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment les règles essentielles : ne jamais renouveler
`SECRET_KEY_BASE` après le premier démarrage, et ne jamais désactiver `enable_redis`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, les pièces jointes
hébergées sur le NFS et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, NFS/Redis, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image Chatwoot personnalisée, provisionne Cloud Run, Cloud SQL (PostgreSQL 15 + pgvector), les secrets, le stockage, le NFS et Redis, puis exécute les jobs chaînés `db-init` → `chatwoot-prepare` |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état (`GET /`) réussit ; les jobs d'initialisation ont réussi ; créer le compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/jobs, accéder à la base, vérifier la persistance des pièces jointes |
| 4 — Observer | Manuel | Interroger Cloud Logging (web + Sidekiq) ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de job d'initialisation, de base de données, de traitement en arrière-plan, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
