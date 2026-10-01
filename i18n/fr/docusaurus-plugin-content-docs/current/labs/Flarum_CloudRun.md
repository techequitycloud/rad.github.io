---
title: "Flarum sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Flarum sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Flarum_CloudRun.md @ 3055034 sha256:a71e7fd1493c -->

# Flarum sur Cloud Run — Guide de lab {#flarum-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Flarum est une plateforme de forum et de discussion gratuite et open source : une alternative
moderne et extensible aux logiciels de forum traditionnels, construite en PHP
avec une interface JavaScript/Mithril. Ce lab vous fait parcourir l’intégralité du
cycle de vie opérationnel du module **Flarum on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer
les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du forum Flarum. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun) :
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu’il provisionne.
- Accéder au service en cours d’exécution, le vérifier et récupérer l’identifiant administrateur généré.
- Effectuer les opérations du jour 2 : inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration, y compris les paramètres de mise à l’échelle et de version des tâches du jour 2, se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Flarum (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin : le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (le `FLARUM_ADMIN_PASS`
   généré automatiquement ; le mot de passe de la base de données est géré séparément), un
   partage Cloud Filestore (NFS) pour les avatars et pièces jointes téléversés, un bucket Cloud Storage
   `flarum-assets` ainsi qu’un bucket `data` par défaut, construit
   l’image de conteneur (une fine surcouche `FROM mondedie/flarum`) et exécute un
   job ponctuel d’initialisation de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois le déploiement terminé, découvrez les ressources à l’aide de filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~flarum" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Flarum sert la page d’accueil publique du forum
   sur `/` une fois installé et dès que la base de données est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Récupérez le mot de passe administrateur généré ; le nom d’utilisateur et
   l’adresse e-mail de l’administrateur sont fixés par le module à `admin` / `admin@techequity.cloud` et
   ne sont pas exposés comme paramètres de configuration :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~flarum AND name~admin-pass" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec `admin` et le mot de passe
   récupéré ci-dessus. `FORUM_URL` est automatiquement raccordé à l’URL `run.app` prévue
   du service sur Cloud Run, les liens absolus et les URL des ressources statiques devraient donc déjà
   être corrects. Si vous placez ensuite le service derrière un domaine personnalisé ou un
   équilibreur de charge HTTPS externe, mettez à jour `FORUM_URL` via
   `environment_variables` pour qu’il corresponde au nom d’hôte public réel, sinon Flarum
   générera des liens à partir de l’ancienne valeur par défaut.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la
   page de détails du déploiement : le module est propriétaire de la spécification du service, la mise à l’échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors de l’application suivante). Conservez `max_instance_count` à `1` sauf si vous
   avez vérifié le comportement de Flarum avec plusieurs instances simultanées
   partageant le même volume NFS de ressources et la même base de données.

3. **Mettez à jour la version de l’application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l’appliquant via **Update** ; la valeur est
   transmise via l’ARG de build propre à l’application `FLARUM_VERSION` (et non via
   l’argument de version générique), une nouvelle image est construite et une nouvelle révision est déployée.
   `latest` correspond à la balise `stable` de l’image `mondedie/flarum` elle-même.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~flarum"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. flarumdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^flarum" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^flarum" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

6. **Vérifiez la persistance des ressources téléversées** : les avatars et pièces jointes résident sur
   Cloud Filestore (NFS) dans `/flarum/app/public/assets`, monté parce que
   `enable_nfs = true` par défaut ; ils survivent donc aux redémarrages et à la mise à l’échelle à zéro :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** : depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** : ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise à l’échelle) et
   l’utilisation du processeur / de la mémoire. Le **test de disponibilité du module est désactivé par
   défaut** (`uptime_check_config.enabled = false`) ; activez-le via la
   configuration si vous voulez que Cloud Monitoring alerte en cas d’indisponibilité, puis
   vérifiez qu’il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Flarum à l’autre.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses
  journaux pour repérer des erreurs de démarrage. La sonde de démarrage est un contrôle **TCP** sur le port 8888
  avec une fenêtre généreuse d’environ 5 minutes (`failure_threshold=20`, `period_seconds=15`)
  pour laisser le temps à l’installateur du premier démarrage, et la sonde de vivacité (liveness) est un
  `GET /` HTTP avec un délai initial de 300 secondes.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** par défaut (`enable_cloudsql_volume = false`),
  Flarum se connecte à Cloud SQL en **TCP direct sur adresse IP privée** via la sortie
  VPC, et non via le socket de l’Auth Proxy. Vérifiez que l’instance Cloud SQL est
  `RUNNABLE`, que la sortie VPC ne bloque pas la plage privée et que le job `db-init`
  s’est terminé avec succès.
- **Échec du job db-init :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l’image :** consultez l’historique Cloud Build pour lire le journal du build en échec ;
  rappelez-vous que `container_image_source` doit rester `custom` : passer à `prebuilt`
  contourne le mécanisme d’argument de build `FLARUM_VERSION` sur lequel repose ce module.
- **Accès au compte administrateur perdu :** le secret `FLARUM_ADMIN_PASS` n’est
  lu qu’au premier démarrage ; le faire tourner ensuite ne modifie pas le mot de passe
  administrateur en vigueur : réinitialisez-le plutôt depuis l’interface d’administration de Flarum ou dans la base de données.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* (pièges de configuration) du Guide de configuration pour les
pièges propres à chaque paramètre (notamment l’immuabilité de `db_name`/`db_user`
après le premier déploiement, et la raison pour laquelle `php_memory_limit`/`upload_max_filesize`/
`post_max_size` sont sans effet sur ce module).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) : cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé : le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, le partage Filestore (NFS), les buckets
GCS (`flarum-assets` et `data`) et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), Filestore (NFS), les buckets de stockage, les secrets, et exécute db-init |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; récupération de `FLARUM_ADMIN_PASS` et connexion en tant que `admin` |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base, vérifier la persistance NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de db-init, de build, de perte d’accès administrateur et d’IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
