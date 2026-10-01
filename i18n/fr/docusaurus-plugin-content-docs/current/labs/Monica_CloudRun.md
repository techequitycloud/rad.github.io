---
title: "Monica sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Monica sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Monica_CloudRun.md @ 3055034 sha256:521b9526aec4 -->

# Monica sur Cloud Run — Guide de lab {#monica-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Monica_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Monica est une application open source de gestion des relations personnelles (PRM) — un
« CRM personnel » pour organiser la façon dont vous restez en contact avec vos amis, votre famille et vos
contacts. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Monica on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Monica. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Monica_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Monica (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Monica_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (la `APP_KEY` de Laravel et le
   mot de passe de la base), un bucket Cloud Storage `monica-uploads`, un volume NFS pour
   le répertoire `storage/` de Laravel, ne construit rien (l'image est l'image officielle
   préconstruite `monica:<version>`) et exécute un job ponctuel d'initialisation de la base.
   Les premiers déploiements prennent environ **15 à 25 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois le déploiement terminé, identifiez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~monica" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. La sonde de démarrage est une sonde TCP sur `/` (elle réussit dès
   qu'Apache s'est lié au port) ; la sonde de vivacité est une sonde HTTP `GET /` :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

   Prévoyez un délai généreux pour la première requête après un démarrage à froid — le démarrage d'Apache et
   le `php artisan migrate --force` du point d'entrée s'exécutent tous deux avant que la page ne soit servie.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Monica n'a **aucun identifiant par défaut** — un
   visiteur non authentifié est redirigé vers la page d'inscription/de configuration. Enregistrez
   le premier compte (utilisez `admin@techequity.cloud` pour les déploiements RAD) ; il
   devient l'administrateur. Aucune autre action n'est nécessaire pour désactiver l'inscription
   ouverte — vérifiez que ce comportement correspond au modèle d'accès que vous souhaitez avant
   de partager l'URL.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application). `min_instance_count = 0` (la valeur par défaut) réduit le service à
   zéro entre les requêtes ; définissez-le à `1` pour éviter la latence du démarrage à froid et de la migration sur
   un CRM personnel que vous consultez souvent.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle révision est déployée en récupérant le
   nouveau tag `monica:<version>`, et le `php artisan migrate --force` du point d'entrée
   met automatiquement à niveau le schéma au démarrage suivant.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~monica"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   Ne renouvelez jamais le secret `APP_KEY` après le premier démarrage — il s'agit d'une clé
   de chiffrement Laravel, et la renouveler corrompt définitivement tous les champs chiffrés de la base de données
   et invalide toutes les sessions.

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. monicademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^monica" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Inspectez les fichiers téléversés** (les photos et documents des contacts résident sous le répertoire
   `storage/` de Laravel, conservé par défaut via NFS et répliqué dans le bucket
   `monica-uploads`) :

   ```bash
   gcloud storage ls gs://<uploads-bucket>/
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis le CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. Le module provisionne également un **test de disponibilité** ; vérifiez
   qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Monica.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage est une sonde TCP sur `/` (elle réussit dès qu'Apache s'est lié au port) ; la sonde
  de vivacité est une sonde HTTP `GET /` avec un délai généreux pour les migrations du premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que le job `db-init` s'est terminé avec succès. Monica
  se connecte par défaut via l'IP privée de l'instance (`enable_cloudsql_volume = false`) —
  sans socket Auth Proxy et sans SSL requis.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Fichiers téléversés manquants après un démarrage à froid :** vérifiez que `enable_nfs = true` —
  désactiver le NFS expose à la perte des fichiers écrits dans le répertoire `storage/` de Laravel
  entre deux démarrages à froid.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler `APP_KEY` après le premier démarrage,
et l'immuabilité de `db_name`/`db_user` une fois définis).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets, un bucket de stockage et le NFS, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; créer le compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base, inspecter les fichiers téléversés |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation et de NFS/persistance |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
