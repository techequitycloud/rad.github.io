---
title: "CloudBeaver sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez CloudBeaver sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CloudBeaver_CloudRun.md @ 3055034 sha256:33ded13b61a5 -->

# CloudBeaver sur Cloud Run — Guide de lab {#cloudbeaver-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

CloudBeaver est la console web d'administration de bases de données du projet DBeaver — une interface unique dans le navigateur pour se connecter à PostgreSQL, MySQL, SQL Server, Oracle et bien d'autres moteurs, et les interroger. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **CloudBeaver on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités de CloudBeaver. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service via son entrée (ingress) par défaut `all` (publique) et vérifier qu'il est en bonne santé.
- Revendiquer le compte administrateur via l'assistant de configuration initiale et comprendre pourquoi le moment choisi compte.
- Effectuer les opérations du jour 2 — inspecter les révisions, gérer l'espace de travail adossé à GCS et mettre à jour la version.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **CloudBeaver (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image de conteneur (une enveloppe légère `FROM dbeaver/cloudbeaver`
   — sans point d'entrée personnalisé, le démarrage propre de l'image amont est utilisé tel quel),
   provisionne le service Cloud Run (port 8978, 1 vCPU / 1 GiB) et
   crée un **bucket d'espace de travail** GCS dédié, monté via GCS FUSE sur
   `/opt/cloudbeaver/workspace`. Il n'y a **ni instance Cloud SQL, ni Redis, ni
   secret applicatif** — CloudBeaver conserve tout son état dans l'espace de travail.
   Un premier déploiement prend généralement **10 à 20 minutes** (le build du conteneur domine —
   il n'y a aucune base de données à attendre).

3. Une fois terminé, identifiez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~cloudbeaver" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Commencez par tenir compte du mode d'entrée (ingress).** Le module utilise par défaut `ingress_settings = "all"`
   — l'URL du service est accessible depuis l'internet public dès la fin du déploiement,
   ce qui est pratique pour ce lab mais constitue un vrai point d'attention pour une console
   d'administration de bases de données (voir l'étape 3 de la tâche 2 sur la revendication rapide du compte administrateur). Vérifiez le
   mode actuel :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(metadata.annotations['run.googleapis.com/ingress'])"
   ```

   Pour restreindre l'accès au VPC, définissez `ingress_settings = "internal"` via
   **Update** sur la page de détails du déploiement, ou placez devant le service un équilibreur de charge
   HTTPS externe et IAP pour un accès public contrôlé.

2. Une fois le service accessible, vérifiez qu'il est en bonne santé. Le chemin de santé de CloudBeaver est `/`,
   qui renvoie HTTP 200 une fois le démarrage de la JVM terminé (comptez ~15 à 30 secondes
   après un démarrage à froid) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier accès, CloudBeaver présente son
   **assistant de configuration** — il n'existe aucun compte administrateur pré-créé, donc **la première personne qui termine
   l'assistant devient administrateur**. Terminez-le immédiatement : définissez le nom du
   serveur et créez le nom d'utilisateur et le mot de passe administrateur. Gardez l'entrée restreinte tant que vous
   ne l'avez pas fait.

4. Après vous être connecté en tant qu'administrateur, ajoutez une connexion à une base de données (New Connection → choisissez le
   pilote → indiquez l'hôte, le port et les identifiants). Pour atteindre des bases de données privées sur le VPC
   (y compris l'instance Cloud SQL partagée de Services_GCP), la sortie (egress) VPC gérée par la fondation
   doit être en place — vérifiez-le avec :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.metadata.annotations)"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **N'augmentez pas le nombre d'instances.** Ce module utilise délibérément par défaut
   `min_instance_count = 1` (pour éviter les démarrages à froid lents de la JVM) et
   `max_instance_count = 1`. L'espace de travail est un **magasin à écrivain unique** (une base
   H2 embarquée sur le montage GCS FUSE) — porter `max_instance_count` au-delà de 1 risque de
   le corrompre. Les modifications de mise à l'échelle, comme toutes les modifications de spécification, passent par **Update** sur
   la page de détails du déploiement, et non par des modifications manuelles via `gcloud` (une modification manuelle serait
   annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur
   la page de détails du déploiement ; une nouvelle image est construite à partir de `dbeaver/cloudbeaver:<version>`
   et une nouvelle révision est déployée. Épinglez un tag précis plutôt que `latest` pour des
   déploiements reproductibles.

4. **Gérez l'espace de travail et le stockage** — le bucket d'espace de travail GCS est le cœur durable
   du déploiement (connexions enregistrées, utilisateurs, paramètres, base de métadonnées
   embarquée). Sauvegardez-le avant toute modification risquée :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~cloudbeaver"
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~cloudbeaver" --format="value(name)" --limit=1)
   gcloud storage ls -r "gs://$WORKSPACE_BUCKET/" | head -20
   # One-off backup copy:
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/cloudbeaver-$(date +%F)"
   ```

5. **Il n'y a aucune base de données applicative à gérer.** `database_type = "NONE"` — ni
   instance Cloud SQL, ni job db-init, ni secret de mot de passe de base de données. Les bases de données que
   CloudBeaver *administre* sont des cibles externes que vous enregistrez dans son interface.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (qui doit rester stable à 1) et
   l'utilisation CPU / mémoire (surveillez la mémoire — CloudBeaver repose sur la JVM). Notez que
   `uptime_check_config.enabled` vaut `false` par défaut ; Monitoring → Uptime checks est donc
   légitimement vide tant que vous ne l'activez pas ; si vous l'activez, un contrôle de disponibilité Cloud Monitoring
   n'est provisionné que lorsque le point de terminaison est accessible publiquement — l'entrée par défaut
   `all` le permet, mais passer à `ingress_settings = "internal"` supprime
   le point de terminaison public et la possibilité d'en provisionner un.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de CloudBeaver.

- **L'URL renvoie 404 depuis votre machine :** si vous avez passé `ingress_settings` à
  `internal` pour un déploiement plus restreint, c'est la politique d'entrée qui fonctionne, et non une
  panne — dans ce mode, le service n'est accessible que depuis l'intérieur du VPC. Vérifiez
  l'annotation d'entrée (tâche 2) avant de lire les journaux.
- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage cible `/` avec un
  délai initial de 15 secondes et une fenêtre de 10 tentatives en échec (le démarrage de la JVM est rapide mais
  pas instantané). Inspectez la dernière révision et ses journaux :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **État de l'espace de travail manquant / paramètres réinitialisés :** vérifiez que le montage GCS FUSE est présent
  et que le bucket d'espace de travail existe toujours — tout l'état de CloudBeaver s'y trouve. GCS FUSE
  requiert l'environnement d'exécution `gen2` (la valeur par défaut du module ; ne la remplacez pas par
  `gen1`).
- **Espace de travail corrompu / erreurs de métadonnées étranges :** vérifiez si `max_instance_count`
  a été porté au-delà de 1 — deux écrivains concurrents corrompent le magasin H2 embarqué. Restaurez
  le bucket d'espace de travail à partir d'une copie de sauvegarde.
- **Impossible d'atteindre une base de données privée depuis l'interface :** vérifiez que la sortie VPC est configurée sur
  le service (tâche 2, étape 4) et que la base de données cible accepte les connexions provenant du
  VPC.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec.
  L'image est construite sur mesure à partir de `dbeaver/cloudbeaver:<version>` via l'ARG de build
  `CLOUDBEAVER_VERSION`.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run, le bucket d'espace de travail GCS (et avec lui **toutes les connexions enregistrées, les utilisateurs et les paramètres**) et les images Artifact Registry. Copiez d'abord le bucket d'espace de travail si vous souhaitez conserver la configuration. Les ressources appartenant à **Services_GCP** (le VPC, l'instance Cloud SQL partagée, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne Cloud Run + le bucket d'espace de travail GCS (sans base de données, sans Redis, sans secrets) |
| 2 — Accéder et vérifier | Manuel | Comprendre l'entrée par défaut `all` (publique) ; le contrôle de santé réussit ; revendiquer le compte administrateur via l'assistant de configuration |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver une seule instance, mettre à jour la version, sauvegarder le bucket d'espace de travail |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; comprendre quand le contrôle de disponibilité existe |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'entrée, de révision, d'espace de travail, de sortie VPC, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket d'espace de travail |
