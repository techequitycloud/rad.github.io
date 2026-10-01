---
title: "LimeSurvey sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez LimeSurvey sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/LimeSurvey_CloudRun.md @ 3055034 sha256:c377eedf96ba -->

# LimeSurvey sur Cloud Run — Guide de lab {#limesurvey-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

LimeSurvey est une plateforme d'enquêtes et de questionnaires en ligne, gratuite et open source (GPL),
écrite en PHP, qui prend en charge un nombre illimité d'enquêtes, les branchements conditionnels, les quotas et
les questionnaires multilingues. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **LimeSurvey on Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants
et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de création d'enquêtes de LimeSurvey. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris la connexion du super-administrateur lors du premier lancement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les téléversements.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Filestore/NFS, Artifact
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

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **LimeSurvey (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0)
   avec ses secrets Secret Manager (`ADMIN_PASSWORD` et le mot de passe de la base), une
   instance Cloud Filestore (NFS) pour le répertoire des téléversements, un bucket Cloud Storage
   `limesurvey-uploads` dédié, construit l'image de conteneur et exécute
   un job ponctuel `db-init` qui crée la base de données vide et l'utilisateur. L'installateur
   en console de LimeSurvey crée ensuite le schéma au premier démarrage du conteneur. Les premiers
   déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL et de Filestore
   représente l'essentiel du temps), plus quelques minutes supplémentaires lors du tout premier démarrage pour
   l'installation du schéma.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~limesurvey" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. La sonde de vivacité de LimeSurvey est une requête `GET /`
   non authentifiée sur la page d'accueil — prévoyez un délai généreux pour la toute première requête, le temps que
   l'installateur en console termine la création du schéma :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Récupérez le mot de passe du super-administrateur généré automatiquement depuis Secret Manager :

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" \
       --filter='name~admin-password' --format='value(name)' | head -1)" \
     --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous au panneau d'administration (`/admin`) en tant que
   `admin` / `admin@techequity.cloud` avec le mot de passe récupéré ci-dessus. Créez une
   enquête de test pour vérifier que la base de données et les chemins de téléversement fonctionnent de bout en bout.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, donc la mise à l'échelle est une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Conservez
   `max_instance_count = 1` tant que le NFS partagé et la gestion des sessions pour plusieurs
   instances n'ont pas été validés — LimeSurvey conserve un état de session PHP.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   `latest` correspond au tag épinglé `6-apache` — épinglez-le explicitement en production
   pour éviter une mise à niveau du schéma non planifiée.

4. **Gérez les secrets, les téléversements et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~limesurvey"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"        # db-init job
   gcloud storage ls "gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter='name~limesurvey-uploads' --format='value(name)' | head -1)"
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. limesurveydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^limesurvey" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation CPU / mémoire. Vérifiez également les métriques de capacité et de débit de l'instance
   Filestore, puisque les téléversements des enquêtes s'y accumulent. Le module provisionne également
   un **test de disponibilité** (uptime check) ; vérifiez qu'il est au vert sous Monitoring → Uptime
   checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LimeSurvey.

- **Chaque page renvoie une erreur 500 avec « table settings_global not found » :** la création du schéma par
  l'installateur en console a échoué silencieusement — presque toujours un problème de moteur de stockage
  (l'image utilise MyISAM par défaut, que Cloud SQL désactive ; ce module
  impose `InnoDB`) ou l'installateur n'a pas pu joindre la base de données. Consultez les
  journaux du conteneur dès le tout premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200
  ```
- **Le service s'arrête immédiatement au démarrage :** `ADMIN_PASSWORD` est obligatoire — le
  conteneur se termine avec le code 1 en son absence. Vérifiez que le secret existe et qu'il a été résolu dans la
  révision.
- **Échec du job `db-init` :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les fichiers téléversés disparaissent après un redémarrage :** vérifiez que `enable_nfs = true` et que
  l'instance Filestore est joignable — sans NFS, `/var/www/html/upload` est
  éphémère.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`
  et, comme ce module se connecte par défaut en TCP sur IP privée
  (`enable_cloudsql_volume = false`), que le service dispose d'une sortie VPC pour la joindre.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment la règle essentielle : ne jamais revenir sur le moteur `InnoDB` imposé,
et ne jamais renommer `db_name`/`db_user` après le premier déploiement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, l'instance Cloud Filestore, les secrets Secret Manager, les buckets GCS
et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le
Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), Filestore (NFS), le bucket de stockage et les secrets, puis exécute db-init |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; récupérer le mot de passe administrateur ; se connecter et créer une enquête de test |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/téléversements, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'installation du schéma, de démarrage, de job d'initialisation, de NFS et de base de données |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
