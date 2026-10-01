---
title: "SnipeIT sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez SnipeIT sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/SnipeIT_CloudRun.md @ 3055034 sha256:0e179279ea70 -->

# SnipeIT sur Cloud Run — Guide de lab {#snipeit-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Snipe-IT est un système libre et open source de gestion des actifs et de l'inventaire informatiques,
qui permet de suivre le matériel, les licences logicielles, les accessoires et les consommables, avec
l'enregistrement des entrées et sorties d'actifs, la journalisation d'audit, l'amortissement et une API REST complète. Ce
lab vous fait parcourir le cycle de vie opérationnel complet du module **Snipe-IT on
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Snipe-IT. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris son assistant de premier lancement `/setup`.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la plateforme RAD, puis ouvrez **Snipe-IT (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run qui exécute l'image PHP/Apache officielle
   `snipe/snipe-it` (sans build personnalisé), une base de données Cloud SQL pour
   MySQL 8.0 avec ses secrets Secret Manager (l'`APP_KEY` de Laravel
   et le mot de passe de la base de données), une instance Cloud Filestore (NFS) montée sur
   `/var/lib/snipeit` pour les images, signatures et codes-barres d'actifs téléversés, un bucket Cloud
   Storage `snipeit-uploads`, et exécute deux jobs d'initialisation ordonnés
   (`db-init` puis `migrate`). Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL et de Filestore représente l'essentiel de ce temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~snipeit" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain et connecté à sa base de données. Snipe-IT
   sert sa page de connexion/configuration sur `/` sans authentification ; un `200` à cet endroit
   confirme donc que l'application PHP et la connexion MySQL sont toutes deux saines :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Sur une nouvelle installation, Snipe-IT redirige
   `/` vers l'assistant d'installation **`/setup`** au lieu de proposer un
   formulaire d'inscription en libre-service. Suivez l'assistant pour créer le premier
   compte administrateur. Si la redirection boucle ou aboutit sur le mauvais hôte,
   vérifiez que `APP_URL` correspond à l'URL du service déployé (Snipe-IT la déduit
   automatiquement de l'URL Cloud Run prévue, mais un domaine personnalisé ou un
   équilibreur de charge ajouté après le déploiement exige de mettre `APP_URL` à jour en conséquence via
   `environment_variables`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est maître de la spécification du service ; la mise à l'échelle
   est donc une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). `max_instance_count` vaut `1` par défaut et
   doit rester à cette valeur, sauf si le comportement multi-instance avec le stockage NFS
   partagé et le pilote de session de Laravel adossé à la base de données a été vérifié pour
   votre déploiement.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est récupérée et une nouvelle
   révision est déployée. En production, figez `application_version` sur une étiquette de version
   `snipe/snipe-it` précise plutôt que de suivre `v8-latest`.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~snipeit"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + migrate + any scheduled backup jobs
   ```

   Ne faites jamais tourner le secret `APP_KEY` après le premier démarrage — cela invalide toutes les
   sessions actives et toutes les données d'application que Snipe-IT a chiffrées avec l'ancienne clé.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. snipeitdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^snipeit" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^snipeit" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
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
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. `uptime_check_config` est **désactivé par défaut**
   pour ce module — activez-le dans les paramètres du déploiement si vous souhaitez un
   test de disponibilité provisionné et une alerte en cas d'échec, sous Monitoring →
   Uptime checks / Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Snipe-IT.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La
  sonde de démarrage est une sonde TCP sur le port du conteneur (délai initial de 30 s, fenêtre d'échec d'environ
  5 minutes) afin de laisser le temps à la configuration de la base au premier démarrage ; la sonde de vivacité est une sonde HTTP
  `GET /` (délai initial de 300 s).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`.
  Ce module atteint Cloud SQL en **TCP via l'IP privée** par défaut
  (`enable_cloudsql_volume = false`), et non via le socket Unix de l'Auth Proxy utilisé par
  la plupart des autres modules Cloud Run — vérifiez que le compte de service d'exécution dispose d'une sortie
  VPC et que l'IP privée de l'instance est joignable.
- **Échec d'un job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué,
  pour l'un ou l'autre job de la chaîne (`db-init` s'exécute en premier, puis `migrate`) :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **L'assistant `/setup` boucle ou renvoie des 404 :** il s'agit presque toujours d'une incohérence d'`APP_URL` —
  vérifiez que l'`APP_URL` injectée correspond à l'hôte que vous consultez.
- **Les fichiers téléversés / images d'actifs disparaissent après un démarrage à froid :** vérifiez que
  `enable_nfs = true` et que l'instance Filestore est joignable ; désactiver NFS
  rend l'arborescence de téléversement `/var/lib/snipeit` éphémère pour chaque instance.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner
`APP_KEY` après le premier démarrage, et la raison pour laquelle `db_user_env_var_name` /
`db_name_env_var_name` / `db_password_env_var_name` sont sans effet pour ce
module).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, l'instance Filestore (NFS), les secrets Secret Manager, les buckets
GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), NFS, les secrets, un bucket de stockage, et exécute `db-init` → `migrate` |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; terminer l'assistant `/setup` pour créer le premier compte administrateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de `/setup` et de NFS |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
