---
title: "Maybe Finance sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Maybe Finance sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/MaybeFinance_CloudRun.md @ 3055034 sha256:3173d99f13d8 -->

# Maybe Finance sur Cloud Run — Guide de lab {#maybe-finance-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Maybe (Maybe Finance) est une alternative open source et auto-hébergée à
Mint/Monarch pour la finance personnelle et la gestion de patrimoine — budget,
suivi de la valeur nette, catégorisation des transactions et agrégation
multicompte, construite sur Ruby on Rails. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **Maybe Finance on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Maybe. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris ses dépendances obligatoires PostgreSQL
  et Redis.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Comprendre pourquoi la mise à l'échelle à zéro affecte le worker de jobs d'arrière-plan Sidekiq colocalisé,
  et comment le maintenir en fonctionnement continu.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, NFS/Redis Filestore, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Maybe Finance (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une fine image d'enveloppe personnalisée `FROM
   ghcr.io/maybe-finance/maybe:stable`, provisionne le service Cloud Run, une
   base de données Cloud SQL (PostgreSQL 15), monte le volume NFS Filestore partagé
   sur `/opt/maybefinance/storage` (également la source par défaut de l'hôte
   Redis), crée le secret `SECRET_KEY_BASE` dans Secret Manager, provisionne
   un bucket de données `storage`, et exécute deux jobs ponctuels enchaînés — `db-init`
   (crée la base de données, l'utilisateur et les droits, et précrée `pgcrypto`) suivi de
   `maybefinance-migrate` (`rails db:prepare`). Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois terminé, repérez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~maybefinance" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est en bonne santé. L'application Rails de Maybe expose un point de terminaison
   de santé public et non authentifié, que ciblent également les sondes de démarrage et de vivacité
   de la plateforme :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/up"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Maybe s'exécute avec `SELF_HOSTED = "true"` ;
   le **premier visiteur** qui atteint le déploiement enregistre donc le compte
   administrateur initial via l'interface web — il n'existe aucun identifiant administrateur
   préenregistré dans Secret Manager. Enregistrez rapidement le compte administrateur ; toute personne
   disposant de l'URL qui arrive la première s'attribue ce rôle.

3. Confirmez que le worker d'arrière-plan est actif — Sidekiq s'exécute dans le même processus, au sein
   du même conteneur que Rails/Puma, et n'est démarré que si Redis était joignable au
   démarrage :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --limit=50 | grep -i sidekiq
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du service ; la mise à l'échelle
   est donc une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). Par défaut, `min_instance_count = 0` et
   `cpu_always_allocated = false` (priorité au coût) : le worker Sidekiq colocalisé
   ne s'exécute que lorsqu'une instance se trouve être active ; la synchronisation des comptes,
   le traitement des imports et les notifications cessent donc silencieusement de se déclencher pendant
   les périodes de mise à l'échelle à zéro. Pour un traitement continu des jobs d'arrière-plan, définissez
   `min_instance_count = 1` et `cpu_always_allocated = true`, comme les
   valeurs par défaut de la variante GKE.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite `FROM
   ghcr.io/maybe-finance/maybe:<tag>` (via l'ARG de build propre à l'application `MAYBE_VERSION`)
   et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~maybefinance"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, maybefinance-migrate, scheduled backup jobs
   ```

   Ne faites jamais tourner le secret `SECRET_KEY_BASE` après le premier démarrage — cela invalide
   toutes les sessions actives et rend définitivement illisibles les colonnes chiffrées par
   ActiveRecord.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. maybefinancedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^maybefinance" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation du CPU et de la mémoire — le processus combiné Rails + Sidekiq
   est gourmand en mémoire lors des imports et synchronisations. Le
   `uptime_check_config` est **désactivé par défaut** ; activez-le via la plateforme
   RAD et confirmez qu'il passe au vert sous Monitoring → Uptime checks, puis
   examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Maybe.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision
  et ses journaux pour repérer les erreurs de démarrage. La sonde de démarrage cible `/up` et accorde
  environ 8 minutes au premier démarrage (`initial_delay_seconds=60`,
  `failure_threshold=30`).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est
  `RUNNABLE`. Cloud Run l'atteint par défaut via l'**adresse IP privée de l'instance avec
  `sslmode=require`** (`enable_cloudsql_volume=false`, car le pilote
  `pg` de Rails ne sait pas analyser le DSN de socket Cloud SQL) — vérifiez que
  `PGSSLMODE=require` a été correctement résolu et que le job `db-init` s'est terminé.
- **Échec du job d'initialisation/de migration :** listez les exécutions et lisez les journaux de celle
  qui a échoué, en vérifiant `db-init` avant `maybefinance-migrate` (la seconde
  dépend de la première) :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-maybefinance-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les jobs d'arrière-plan (synchronisation des comptes, imports, notifications) ne se déclenchent pas :**
  cela signifie généralement que Sidekiq n'a jamais démarré — vérifiez que `REDIS_URL` a été résolu
  avec une valeur non vide dans l'environnement du conteneur, et que l'instance n'est pas redescendue à
  zéro entre les requêtes (voir la tâche 3, point 2).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris les règles essentielles de ne jamais faire tourner
`SECRET_KEY_BASE` après le premier démarrage, et le fait que `database_type` et
`enable_redis` sont imposés par des préconditions évaluées au moment du plan, qui rejettent tout
sauf PostgreSQL et un hôte Redis fonctionnel).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager et les
buckets GCS `storage`/`data`. Les ressources appartenant à **Services_GCP** (le VPC,
la VM NFS/Redis Filestore partagée, l'hôte Cloud SQL partagé, Artifact Registry)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit une image d'enveloppe personnalisée, provisionne Cloud Run, Cloud SQL (PostgreSQL 15), le câblage NFS/Redis, les secrets, les buckets de stockage, et exécute `db-init` + `maybefinance-migrate` |
| 2 — Accéder et vérifier | Manuel | La vérification de santé `/up` réussit ; enregistrer le compte administrateur initial dans l'interface ; confirmer que Sidekiq a démarré |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (en tenant compte du compromis Sidekiq/mise à l'échelle à zéro), mettre à jour la version, gérer secrets/sauvegardes, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données (mode SSL), de job d'initialisation/de migration, de jobs d'arrière-plan, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module ; le NFS/Redis partagé et l'hôte Cloud SQL ne sont pas touchés |
