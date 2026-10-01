---
title: "Spoolman sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Spoolman sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Spoolman_CloudRun.md @ 3055034 sha256:fc5ad9a40bbd -->

# Spoolman sur Cloud Run — Guide de lab {#spoolman-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 45 minutes

Spoolman est un outil open source de suivi de l'inventaire et de la consommation des bobines de filament
pour l'impression 3D. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Spoolman on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Spoolman. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la plateforme RAD, puis ouvrez **Spoolman (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run et une base de données Cloud SQL (PostgreSQL
   15) avec son secret de mot de passe dans Secret Manager, et récupère directement l'image
   préconstruite `ghcr.io/donkie/spoolman` — il n'y a aucune étape Cloud Build
   ni aucun job d'initialisation de la base de données à attendre (Spoolman effectue lui-même
   ses migrations au démarrage). Les premiers déploiements prennent environ **15 à 25 minutes** (la création de Cloud SQL
   représente l'essentiel de ce temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~spoolman" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain et connecté à sa base de données :

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect a 200/OK JSON status
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Spoolman n'a **aucune barrière de connexion** — l'interface
   s'ouvre directement sur le tableau de bord de l'inventaire des bobines, sans compte administrateur à
   créer. Si vous devez restreindre l'accès, appliquez dès maintenant IAP ou une liste d'autorisation
   Cloud Armor, avant de partager l'URL avec qui que ce soit.

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
   annulée lors du prochain apply). Spoolman n'exécute aucune tâche en arrière-plan ; la
   mise à l'échelle jusqu'à zéro (`min_instance_count = 0`) est donc sans risque à tout moment.

3. **Mettez à jour l'étiquette de version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; Cloud Run récupère la nouvelle étiquette
   directement depuis `ghcr.io/donkie/spoolman` — aucune reconstruction n'est nécessaire puisqu'il s'agit
   d'une image réellement préconstruite.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~spoolman"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. spoolmandemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^spoolman" --limit=1)
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

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes, le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Le module peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true`) ; s'il est activé, confirmez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Spoolman.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement `SPOOLMAN_DB_*`
  ont été résolues. La sonde de démarrage cible `/api/health` avec un court délai initial
  de 10 secondes — Spoolman démarre rapidement, puisqu'il n'y a aucun job de migration de schéma
  à attendre séparément.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE` et que le secret du mot de passe de la base existe. Comme il n'y a pas de job d'initialisation,
  cette catégorie de défaillance apparaît directement dans les journaux de démarrage du service lui-même.
- **L'application fonctionne mais affiche un inventaire vide, en utilisant SQLite au lieu de Postgres :**
  vérifiez si `SPOOLMAN_DB_TYPE=postgres` a été accidentellement remplacé ou
  supprimé dans `environment_variables` — Spoolman se rabat silencieusement sur un
  fichier SQLite local jetable, sans aucune erreur, si cette variable est absente.
  ```bash
  gcloud run revisions describe <revision> --project="$PROJECT" --region="$REGION" \
    --format='value(spec.containers[0].env)' | tr ';' '\n' | grep -i spoolman_db
  ```
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris l'absence d'authentification intégrée).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL et les secrets Secret Manager.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run et Cloud SQL (PostgreSQL 15) avec son secret de mot de passe ; sans build ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; l'interface se charge directement, sans barrière de connexion |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données et de repli du moteur de base de données |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
