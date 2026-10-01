---
title: "code-server sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez code-server sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/CodeServer_CloudRun.md @ 3055034 sha256:f4dede2e6dec -->

# code-server sur Cloud Run — Guide de lab {#code-server-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

code-server est la version open source de Visual Studio Code développée par Coder, qui s'exécute sur un serveur distant et s'utilise entièrement depuis le navigateur — un IDE complet avec la place de marché d'extensions, un terminal intégré et un espace de travail persistant. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **code-server on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit code-server. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à l'éditeur via son entrée publique par défaut (`all`), récupérer le mot de passe généré et vérifier le service.
- Effectuer les opérations du jour 2 — inspecter les révisions, gérer l'espace de travail adossé à GCS et mettre à jour la version.
- Comprendre pourquoi le module est limité à une seule instance et comment modifier la mise à l'échelle en toute sécurité.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **code-server (Cloud Run)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image d'encapsulation légère au-dessus de `codercom/code-server` (répliquée
   dans Artifact Registry via Cloud Build), provisionne le service Cloud Run
   (port 8080, 1 vCPU / 1 GiB, environnement d'exécution `gen2`), monte un **bucket
   d'espace de travail** GCS dédié via GCS FUSE sur `/home/coder`, et génère un
   `PASSWORD` aléatoire pour l'éditeur dans Secret Manager. Il n'y a **ni instance Cloud SQL ni Redis** —
   code-server n'a pas de base de données. Les premiers déploiements prennent généralement **10–20 minutes** (le
   build du conteneur domine — il n'y a aucune base de données à attendre).

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~codeserver" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Tenez d'abord compte du mode d'entrée (ingress).** Le module utilise par défaut
   `ingress_settings = "all"` — l'éditeur est joignable publiquement dès l'installation,
   protégé par le secret `PASSWORD` généré automatiquement (voir l'étape 3). Vérifiez le
   mode actuel :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(metadata.annotations['run.googleapis.com/ingress'])"
   ```

   Pour restreindre plutôt l'accès au VPC, définissez `ingress_settings = "internal"` via
   **Update** sur la page de détails du déploiement — un `curl` depuis l'extérieur du VPC
   renverra alors **404** (c'est la règle d'entrée qui fonctionne, pas une panne). Tant que l'entrée
   est à `all`, **conservez `enable_password = true`** (un IDE public et non authentifié
   inclut un terminal public).

2. Une fois le service joignable, vérifiez qu'il est en bonne santé. Le chemin de santé non authentifié
   de code-server est `/healthz` (remarque : **pas** `/health`, qui renvoie 401 lorsqu'un
   mot de passe est défini) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"
   ```

3. Récupérez le mot de passe de l'éditeur généré dans Secret Manager, puis ouvrez
   `$SERVICE_URL` dans un navigateur et connectez-vous :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~codeserver AND name~password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

4. Vérifiez la persistance : créez un fichier ou installez une extension dans l'éditeur, puis
   vérifiez qu'il arrive dans le bucket d'espace de travail — tout ce qui se trouve sous `/home/coder`
   (paramètres, raccourcis clavier, extensions, projets ouverts) réside sur GCS FUSE :

   ```bash
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~codeserver" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$WORKSPACE_BUCKET/"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **N'augmentez pas le nombre d'instances.** Le module fixe délibérément
   `min_instance_count = max_instance_count = 1` : les sessions de l'éditeur sont conservées en mémoire
   et le volume d'espace de travail n'a qu'un seul rédacteur — une seconde instance diviserait les
   sessions et risquerait des écritures concurrentes dans `/home/coder`. Les modifications de ressources
   (`cpu_limit`, `memory_limit` pour les serveurs de langage gourmands) passent par **Update** sur
   la page de détails du déploiement, et non par des modifications manuelles avec `gcloud` (une modification manuelle serait
   annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur
   la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.
   Il n'y a aucune migration — code-server n'a pas de schéma. `latest` est fixé à `4.99.1` au
   moment du build ; fixez une version précise en production.

4. **Gérez les secrets et le stockage :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~codeserver"
   gcloud storage buckets list --project="$PROJECT" --filter="name~codeserver"
   # One-off workspace backup:
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/codeserver-$(date +%F)"
   ```

5. **Il n'y a aucune session de base de données à ouvrir.** `database_type = "NONE"` — ni instance
   Cloud SQL, ni job db-init, ni mot de passe de base de données. Le seul état durable est le
   bucket d'espace de travail.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (qui doit rester stable à 1) et
   l'utilisation du CPU et de la mémoire — les serveurs de langage et les extensions sont les principaux
   consommateurs de mémoire. Le **test de disponibilité** du module est désactivé par défaut
   (`uptime_check_config.enabled = false`) et exige en outre un point de terminaison joignable
   publiquement ; Monitoring → Uptime checks peut donc légitimement être vide, même
   si l'entrée est à `all` par défaut.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de code-server.

- **L'URL renvoie 404 depuis votre machine :** si `ingress_settings` a été passé à
  `internal`, c'est normal — ce n'est pas une panne. Vérifiez l'annotation d'entrée
  (tâche 2) avant de lire les journaux.
- **La révision ne devient jamais Ready :** vérifiez les chemins des sondes. Les sondes doivent cibler
  `/healthz`, non authentifié ; les faire pointer vers `/health` alors qu'un mot de passe est défini
  renvoie 401 et la révision échoue au test de disponibilité même si l'application a bien démarré :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Connexion refusée :** relisez le secret `PASSWORD` (tâche 2, étape 3) — la valeur est
  injectée comme variable d'environnement `PASSWORD` du conteneur ; une nouvelle version du secret ne prend
  effet qu'à la révision suivante.
- **État de l'espace de travail manquant / extensions disparues :** vérifiez que le bucket d'espace de travail existe
  et que l'environnement d'exécution est `gen2` (GCS FUSE ne peut pas être monté sous `gen1` — la
  validation au moment du plan le détecte, mais vérifiez-le si le module a été modifié).
- **Éditeur lent / arrêts pour manque de mémoire (OOM) :** augmentez `memory_limit` (les serveurs de langage gourmands peuvent manquer de mémoire
  en dessous de 1 GiB) via le parcours **Update** de RAD et surveillez le graphique de mémoire dans Monitoring.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec ;
  l'image est une encapsulation légère au-dessus de `codercom/code-server`, répliquée dans Artifact
  Registry.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le service Cloud Run, le secret Secret Manager `PASSWORD`, le bucket d'espace de travail GCS (et avec lui **tous les fichiers, paramètres et extensions sous `/home/coder`**) et les images Artifact Registry. Copiez d'abord le bucket d'espace de travail si vous souhaitez conserver votre travail. Les ressources détenues par **Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne Cloud Run + le bucket d'espace de travail GCS + le secret `PASSWORD` (ni base de données, ni Redis) |
| 2 — Accéder et vérifier | Manuel | Comprendre l'entrée publique par défaut (`all`) ; `/healthz` réussit ; récupérer le mot de passe et se connecter ; vérifier la persistance de l'espace de travail |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver une seule instance, mettre à jour la version, sauvegarder le bucket d'espace de travail |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; comprendre quand le test de disponibilité existe |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'entrée, de chemin de sonde, de mot de passe, d'espace de travail, de mémoire, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket d'espace de travail |
