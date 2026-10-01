---
title: "Gitea sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Gitea sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Gitea_CloudRun.md @ 3055034 sha256:ed1942085ebf -->

# Gitea sur Cloud Run — Guide de lab {#gitea-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Gitea est un service Git et une forge logicielle légers et auto-hébergés — hébergement de dépôts, tickets, pull requests, revue de code et registre de paquets, le tout depuis un unique binaire Go. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Gitea sur Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Gitea. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder à la forge, revendiquer le compte administrateur du premier inscrit et vérifier l’état de santé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Gitea (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (mot de passe de la base, `SECRET_KEY` et
   `INTERNAL_TOKEN` de Gitea), un partage NFS contenant les dépôts, les objets LFS et les pièces jointes, un bucket GCS
   `data`, construit via Cloud Build l’image personnalisée allégée basée sur `gitea/gitea`,
   et exécute un job ponctuel d’initialisation de la base de données. Un premier déploiement prend environ
   **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois terminé, repérez les ressources à l’aide de filtres indépendants du nom (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gitea" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le chemin de santé de Gitea est `/api/healthz`, qui
   renvoie HTTP 200 sans authentification une fois le serveur démarré (le premier démarrage
   exécute aussi les migrations de schéma — comptez jusqu’à ~60 secondes sur un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. L’installateur web du premier lancement est ignoré
   (`INSTALL_LOCK=true` — la configuration est pilotée par les variables d’environnement), et **le premier utilisateur
   à s’inscrire devient l’administrateur**. Cliquez sur **Register**, créez immédiatement votre compte
   administrateur, puis connectez-vous.

3. **Durcissement immédiat :** l’auto-inscription est activée par défaut. Pour une forge
   privée, désactivez-la juste après avoir revendiqué le compte administrateur en ajoutant
   `GITEA__service__DISABLE_REGISTRATION = "true"` à `environment_variables` via
   le parcours **Update** de RAD. Définissez aussi `public_domain` / `public_url` sur l’hôte réel
   du service afin que les URL de clonage soient correctes (la valeur par défaut `localhost` les rend inutilisables).

4. Créez un dépôt de test dans l’interface et clonez-le via **HTTPS** (Cloud Run n’achemine
   que le port HTTP ; les URL de clonage SSH ne sont donc pas joignables sur cette plateforme) :

   ```bash
   git clone "$SERVICE_URL/<your-user>/<test-repo>.git"
   ```

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service ; la mise à l’échelle est donc une modification de configuration, et non une
   modification manuelle avec `gcloud` (une modification manuelle serait annulée lors du prochain apply).
   Les valeurs par défaut sont min `0` / max `1` ; définissez min `1` pour les équipes gênées par les démarrages à froid,
   et `cpu_always_allocated = true` uniquement si vous comptez sur la synchronisation planifiée des miroirs ou
   sur la livraison programmée des webhooks.

3. **Mettez à jour la version de l’application** en modifiant le paramètre `application_version`
   via **Update** sur la page de détails du déploiement ; Cloud Build reconstruit l’image
   à partir du tag `gitea/gitea` correspondant et une nouvelle révision est déployée (Gitea migre
   automatiquement son schéma au démarrage).

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gitea"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~gitea"
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance. Le rôle
   applicatif et la base de données sont préfixés par le tenant — lisez les noms réels dans
   l’environnement du service plutôt que de supposer `gitea` :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json" | grep -A1 '"name": "DB_USER"' | grep value | cut -d'"' -f4)
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
   À chaque démarrage, le point d’entrée de la plateforme journalise une ligne `Gitea DB wired: host=… sslmode=…`
   — utile pour confirmer le raccordement à la base de données.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d’instances (comportement de mise à l’échelle) et l’utilisation du CPU
   et de la mémoire. Le **test de disponibilité** (uptime check) du module est désactivé par défaut —
   activez `uptime_check_config` en production et vérifiez qu’il est au vert sous
   Monitoring → Uptime checks ; examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Gitea à l’autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux ; la sonde de démarrage cible `/api/healthz` avec un délai initial de 30 secondes :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job `db-init` s’est terminé. Consultez
  la ligne de journal `Gitea DB wired:` — l’utilisateur et le nom doivent être les valeurs préfixées par le tenant,
  jamais un `gitea` codé en dur.
- **Le job d’initialisation a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **`lookup $(DB_HOST): no such host` dans les journaux :** l’image amont standard a été
  déployée à la place du build personnalisé. `container_image_source` doit valoir `custom` —
  Cloud Run n’interpole pas les références d’environnement `$(VAR)` ; le point d’entrée de la plateforme
  présent dans l’image personnalisée est donc nécessaire pour composer la connexion à la base de données.
- **URL de clonage incorrectes / redirections vers `localhost` :** `public_domain` / `public_url`
  conservent leurs valeurs par défaut — définissez-les sur l’hôte du service via **Update**.
- **Le clonage SSH échoue :** c’est attendu — Cloud Run n’expose que le port HTTP. Utilisez des
  remotes HTTPS avec un jeton d’accès Gitea.
- **Montage NFS / dépôts manquants :** vérifiez que `enable_nfs = true` et que
  l’environnement d’exécution est `gen2` (requis pour les montages NFS dans Cloud Run).
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager (mot de passe de la base, `SECRET_KEY`,
`INTERNAL_TOKEN`), les buckets GCS, les données de dépôts stockées sur NFS et les images Artifact
Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), NFS, GCS, des secrets, construit l’image et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; le premier inscrit revendique le compte administrateur ; l’inscription est verrouillée |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle, mettre à jour la version, gérer secrets/sauvegardes/stockage, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d’initialisation, de source d’image, d’URL de clonage, de NFS, de build et d’IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
