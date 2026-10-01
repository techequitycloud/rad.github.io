---
title: "OpenEMR sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer OpenEMR sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OpenEMR_CloudRun.md @ 3055034 sha256:8faedb87126b -->

# OpenEMR sur Cloud Run — Guide de lab {#openemr-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenEMR_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

OpenEMR est le système open source de dossiers médicaux électroniques (Electronic Health Records, EHR)
et de gestion de cabinet le plus largement adopté au monde, utilisé par des prestataires de soins dans plus de 100 pays. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **OpenEMR on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit OpenEMR. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenEMR_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

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
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **OpenEMR (Cloud Run)** depuis la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenEMR_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (environnement d'exécution gen2, requis
   pour la prise en charge de NFS), une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager,
   un partage NFS Filestore pour le répertoire `sites/`, un Redis facultatif pour le stockage des sessions
   PHP, construit l'image du conteneur et exécute deux tâches ponctuelles d'initialisation
   (`nfs-init` et `db-init`). Lors du premier déploiement, le conteneur lui-même exécute
   `auto_configure.php` pour installer le schéma de la base de données. **Les premiers déploiements prennent environ
   20–40 minutes** (la création de Cloud SQL et l'installation du schéma OpenEMR y contribuent toutes deux).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~openemr" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. La sonde de vivacité (liveness) d'OpenEMR vérifie la page de connexion ; un
   code HTTP 200 sur ce chemin signifie donc qu'Apache, PHP-FPM et la connexion à la base de données sont tous
   opérationnels :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     "${SERVICE_URL}/interface/login/login.php"
   # expect: 200
   ```

   Prévoyez jusqu'à **20 minutes** après le premier déploiement pour que l'installateur du schéma OpenEMR
   se termine avant que cette vérification réussisse.

2. Récupérez le mot de passe administrateur dans Secret Manager et connectez-vous sur
   `${SERVICE_URL}/interface/login/login.php` (nom d'utilisateur : `admin`) :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~openemr.*admin" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Notez
   qu'augmenter `max_instance_count` au-delà de 1 exige que le partage des sessions via Redis soit
   opérationnel au préalable ; sans cela, les sessions PHP sont perdues lorsque les requêtes sont acheminées vers des
   instances différentes.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets, les sauvegardes et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~openemr"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # nfs-init, db-init, backup
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. openemrdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^openemr" --limit=1)
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
   l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il est
   au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OpenEMR.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. Notez que la
  sonde de démarrage est de type **TCP** (et non HTTP) ; un délai dépassé à ce stade signifie donc généralement que le port n'est
  pas encore ouvert — l'installateur du schéma est toujours en cours d'exécution.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La révision semble bloquée indéfiniment au « démarrage » (aucun plantage, aucun journal d'erreur) :** il s'agit d'un
  mode de défaillance connu et propre à OpenEMR, et non d'un blocage générique. La configuration du premier démarrage d'OpenEMR
  (vidage du cache Twig, vérification en base de la mise en page de la page de connexion, et une passe récursive de durcissement
  des permissions de fichiers) s'exécute en tâche de fond, sans être liée à une requête entrante
  particulière. Si `cpu_always_allocated = false` (facturation à la requête), Cloud Run
  réduit le CPU quasiment à zéro entre les requêtes ; cette configuration ponctuelle peut alors prendre de nombreuses
  minutes, voire ne jamais se terminer en pratique — alors qu'elle s'achève en moins de 15 secondes
  avec un CPU continu. Correctif : vérifiez que `cpu_always_allocated = true` (la valeur par défaut du module)
  et redéployez/redémarrez la révision ; ne supposez pas que l'application ou le point d'entrée est défectueux.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base existe et que les deux tâches d'initialisation se sont terminées avec succès.
- **Échec des tâches d'initialisation :** listez les exécutions et lisez les journaux de la tâche en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-nfs-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run et
les tâches, la base de données Cloud SQL, l'instance NFS Filestore, les secrets Secret Manager, les buckets GCS
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL
partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (gen2), Cloud SQL MySQL, NFS, Redis, les secrets, et exécute les tâches nfs-init et db-init |
| 2 — Accès et vérification | Manuel | La page de connexion renvoie HTTP 200 ; connexion avec les identifiants administrateur issus de Secret Manager |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de sonde de démarrage TCP, de base de données, de tâche d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
