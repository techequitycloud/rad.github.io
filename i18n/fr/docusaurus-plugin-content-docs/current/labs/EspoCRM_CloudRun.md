---
title: "EspoCRM sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez EspoCRM sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/EspoCRM_CloudRun.md @ 3055034 sha256:6f7861c77473 -->

# EspoCRM sur Cloud Run — Guide de lab {#espocrm-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

EspoCRM est une plateforme open source de gestion de la relation client (CRM), sous licence GPLv3,
construite sur PHP et Apache. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel
du module **EspoCRM on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit EspoCRM (contacts, prospects, opportunités, workflows). Pour la
liste complète des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun) —
ce lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au CRM, récupérer l'identifiant administrateur généré automatiquement et vérifier que le
  service est en bonne santé et connecté à sa base de données.
- Réaliser les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets, le stockage NFS
  et la base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le NFS Filestore, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **EspoCRM (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (`ESPOCRM_ADMIN_PASSWORD` et le mot de passe de la
   base de données), un bucket Cloud Storage `espocrm-data` (provisionné mais non monté par
   défaut), un volume NFS Filestore partagé monté sur `/var/www/html/data` pour les fichiers téléversés
   (`enable_nfs = true` par défaut), construit l'image de conteneur et exécute un job ponctuel
   d'initialisation de la base de données. L'installateur EspoCRM amont exécute ensuite automatiquement sa propre
   étape d'installation/migration au premier démarrage du conteneur. Les premiers déploiements prennent
   environ **20 à 35 minutes** (la création de Cloud SQL et de Filestore domine).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres indépendants des noms (pour que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~espocrm" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service affiche sa page de connexion (le point de terminaison de vivacité d'EspoCRM est
   l'écran de connexion non authentifié à `/`, qui renvoie `200` une fois l'étape d'installation/migration
   terminée — prévoyez plusieurs minutes au premier démarrage) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Récupérez le mot de passe administrateur généré automatiquement dans Secret Manager — l'installateur
   d'EspoCRM crée l'utilisateur `admin` avec ce mot de passe au premier démarrage ; il n'y a pas
   d'étape distincte de création de compte :

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-espocrm-admin-password" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant que `admin` avec le mot de passe
   récupéré. Changez immédiatement le mot de passe sous **Administration → Users** — la
   valeur générée automatiquement n'initialise que la **première** installation ; la perdre plus tard impose une
   réinitialisation au niveau de la base de données.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait annulée
   lors de l'application suivante). `max_instance_count` vaut `1` par défaut : Cloud Run n'offre pas
   d'affinité de session intégrée ; vérifiez donc le comportement d'EspoCRM avec des sessions PHP
   concurrentes réparties sur plusieurs réplicas avant de dépasser une instance.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée.

4. **Gérez les secrets et le stockage NFS :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~espocrm"
   gcloud filestore instances list --project="$PROJECT"   # backs /var/www/html/data uploads
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. espocrmdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^espocrm" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Activez Redis (facultatif)** pour décharger MySQL du cache d'objets d'EspoCRM : définissez
   `enable_redis = true` et appliquez via **Update** ; laissez `redis_host` vide pour réutiliser
   l'IP du serveur NFS comme point de terminaison Redis.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux. Le conteneur affiche au démarrage ses valeurs
   `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL` résolues, un moyen rapide de
   confirmer l'hôte de base de données et l'URL du site utilisés :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du processeur et de la mémoire. Le module provisionne également un **test de disponibilité** ; vérifiez
   qu'il est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'EspoCRM à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage est TCP sur le port `80` ; la sonde de vivacité
  est `HTTP GET /` avec un délai initial de 300 secondes, pour laisser l'étape d'installation/migration
  se terminer au premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et
  que le job `db-init` s'est terminé — EspoCRM se connecte par défaut en TCP sur IP privée (et non via un
  socket) ; la sortie VPC doit donc atteindre l'IP privée de l'instance.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Fichiers téléversés absents après un redémarrage :** vérifiez que `enable_nfs = true` et que l'instance
  Filestore est en bonne santé — sans NFS, les pièces jointes résident sur le disque éphémère du conteneur et
  sont perdues lorsqu'une instance est recyclée.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment l'immuabilité de `db_name`/`db_user` après le premier déploiement et le
caractère ponctuel du mot de passe administrateur généré automatiquement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie le déploiement). La
suppression retire tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL,
les secrets Secret Manager, les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, l'instance NFS Filestore, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage + le montage NFS, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | La page de connexion renvoie 200 ; récupérer le mot de passe administrateur généré automatiquement et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/le NFS, accéder à la base de données, Redis facultatif |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de NFS et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
