---
title: "OpenSourcePOS sur Cloud Run — Guide de Lab"
description: "Lab pratique : déployez Open Source POS sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/OpenSourcePOS_CloudRun.md @ 2829548 sha256:bb1e25d5a161 -->

# OpenSourcePOS sur Cloud Run — Guide de Lab {#opensourcepos-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 60 minutes

Open Source Point of Sale (OSPOS) est un point de vente de détail web gratuit et
open source — ventes, articles, clients, fournisseurs, reçus et rapports. Ce lab
vous guide à travers le cycle de vie opérationnel complet du module
**OpenSourcePOS sur Cloud Run** sur Google Cloud : déployez-le, accédez-y et
vérifiez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes
courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit OpenSourcePOS. Pour la
liste complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun)
— ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Accéder au service en cours d'exécution et le vérifier, et confirmer le schéma
  chargé dans Cloud SQL.
- Effectuer des opérations de jour 2 — inspecter, mettre à l'échelle, mettre à
  jour et gérer les secrets, les téléchargements et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les
  plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même en premier — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce
  n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation de déploiement vous demande de prouver que
  vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle
  affiche en tant que Propriétaire de projet, puis **Verify**) et de donner le
  rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD
  crée pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet que RAD crée
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Update** sur la page du déploiement après avoir coché
  **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le
  coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais
  de frais de module). Dans un environnement de lab, seul un administrateur
  peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**,
   puis ouvrez **OpenSourcePOS (Cloud Run)** depuis la liste **Platform
   Modules**, choisissez **Configuration Form** sous *How would you like to
   configure this deployment?* (le formulaire s'ouvre sur l'**Assistant
   Conversationnel** si vous détenez des crédits achetés ou si vous êtes un
   partenaire ou un administrateur), définissez `project_id`, et examinez les
   entrées. Ne configurez que ce dont vous avez besoin — le [Guide de
   configuration](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Deploy Module**, examinez le coût estimé dans la boîte de dialogue
   **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit**
   (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la
   vérification d'un projet que vous apportez, complétez-la et cliquez sur
   **Confirm**), ce qui ouvre la page d'état du déploiement avec des logs en
   temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (MySQL 8.0) avec son mot de passe dans Secret Manager, un bucket Cloud
   Storage `storage` (monté à `/app/public/uploads` pour les images d'articles et le logo de
   l'entreprise) et un bucket générique `data`, construit l'image de conteneur
   personnalisée (en encapsulant `jekkos/opensourcepos:3.4.1`), et exécute la chaîne
   d'initialisation en deux étapes : `db-init` (crée la base de données,
   l'utilisateur et les autorisations) suivi de `schema-load` (charge le schéma
   fourni dans l'image OpenSourcePOS). La création de Cloud SQL et la
   construction de l'image dominent un premier déploiement.

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le
   suffixe de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ospos" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service répond à la racine du document, ce que les deux
   sondes de santé vérifient :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Confirmez que le conteneur a démarré contre Cloud SQL plutôt qu'un
   mécanisme de secours. Le wrapper enregistre sa cible de connexion à chaque
   démarrage :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --limit=200 | grep "\[startup\]"
   ```

   Attendez-vous à `OpenSourcePOS pointed at <private-ip>:3306/<db-name> as <db-user>`.

3. Confirmez que le schéma a été chargé. Le log du job `schema-load` se termine par
   `Schema loaded: N tables in <db-name>` lors du premier déploiement, ou par `Schema already present ... -- nothing to do` lors des
   applications ultérieures :

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~schema-load"
   ```

4. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant
   qu'administrateur (nom d'utilisateur `admin`) créé par le schéma
   fourni. **Changez immédiatement le mot de passe de l'administrateur** — le
   module ne le randomise pas.

5. Téléchargez un logo d'entreprise ou une image d'article, puis confirmez
   qu'il a atterri dans le bucket `storage` (et survit donc à un
   redémarrage) :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --format="value(name)" --filter="name~storage" --limit=1)
   gcloud storage ls -r "gs://$BUCKET/"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les entrées d'instances min/max et en
   cliquant sur **Update** sur la page des détails du déploiement — le module
   possède la spécification du service, donc la mise à l'échelle est un
   changement de configuration, pas une modification manuelle `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Pour une caisse
   en utilisation quotidienne, définissez `min_instance_count = 1` afin qu'aucune vente
   n'attende un démarrage à froid. L'exécution de plus d'une instance est sûre :
   les sessions sont stockées dans MySQL.

3. **Mettez à jour la version de l'application** en changeant `application_version` pour
   une autre balise de version exacte de `jekkos/opensourcepos` et en l'appliquant via
   **Update** ; une nouvelle image est construite et une nouvelle révision est
   déployée. N'utilisez jamais `latest`. Notez que `schema-load` ne charge le
   schéma que dans une base de données vide — il ne migre pas une base de
   données existante entre les versions.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # User and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ospos" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes, le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de
   la mémoire. Le test de disponibilité est **désactivé** par défaut ;
   activez-le avec `uptime_check_config` si vous en voulez un, puis confirmez qu'il est
   vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions d'OpenSourcePOS.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs pour les erreurs de démarrage, et confirmez que les
  variables d'environnement et les secrets ont été résolus. Les deux sondes
  `GET /` ; la sonde de démarrage autorise 20 échecs avec une période de
  15 secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Le conteneur se termine avec `FATAL: DB_... is empty or unset` :** le wrapper refuse de démarrer
  lorsqu'une variable de base de données est vide, car OpenSourcePOS utiliserait
  sinon silencieusement les identifiants `localhost` intégrés à l'image.
  Vérifiez que `db_host_env_var_name` est toujours `DB_IP` et que le secret du mot de
  passe de la base de données existe.
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de
  données existe, et que `db-init` s'est terminé avant `schema-load`.
- **Le job d'initialisation a échoué :** listez les exécutions et lisez les
  logs de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-schema-load" \
    --project="$PROJECT" --region="$REGION"
  ```
  `schema-load` échoue explicitement si le chargement signale un succès mais que la
  base de données n'a toujours pas de tables.
- **Les images téléchargées disparaissent après un redémarrage :** `enable_gcs_storage_volume`
  a été désactivé, donc les téléchargements sont allés sur le disque éphémère
  du conteneur.
- **La construction de l'image a échoué :** examinez l'historique de Cloud
  Build pour le log de la construction échouée, et vérifiez que `application_version`
  nomme une balise qui existe sur `jekkos/opensourcepos`.
- **403 / erreurs de permission :** vérifiez les rôles IAM du compte de
  service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible
(l'enregistrement du déploiement est conservé pour l'historique). Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez **Purge** à la place (depuis la même boîte de dialogue
**Delete**) — cela supprime le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela
supprime tout ce que le module a créé — le service Cloud Run, la base de
données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris les
images téléchargées) et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les buckets `storage` et `data`, et exécute la chaîne d'initialisation `db-init` → `schema-load` |
| 2 — Accéder et vérifier | Manuel | La ligne de log `[startup]` nomme Cloud SQL ; schéma chargé ; connectez-vous en tant que `admin` et changez le mot de passe ; le téléchargement atterrit dans le bucket `storage` |
| 3 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle (min 1 pour une caisse), mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; activer éventuellement le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de révision, de refus de variable vide, de base de données, de job d'initialisation, de téléchargement et de build |
| 6 — Suppression | Automatisé | Supprimer (Trash) supprime toutes les ressources du module |
