---
title: "DokuWiki sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez DokuWiki sur Cloud Run dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/DokuWiki_CloudRun.md @ 3055034 sha256:8fd076df6484 -->

# DokuWiki sur Cloud Run — Guide de lab {#dokuwiki-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Une plateforme de wiki simple, basée sur des fichiers et ne nécessitant aucune base de données, qui stocke les pages dans un bucket
Cloud Storage monté via gcsfuse. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **DokuWiki on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit DokuWiki. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer le stockage.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **DokuWiki (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage (monté sur
   `/storage` via gcsfuse) pour les pages du wiki et les pièces jointes, et construit l'image
   de conteneur. DokuWiki ne nécessite aucune base de données — tout le contenu est stocké sous forme de fichiers simples dans le
   bucket monté via gcsfuse.

3. Une fois l'opération terminée, découvrez les ressources avec des filtres indépendants des noms (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dokuwiki" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et que le wiki est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   # expect 200
   ```

   Le chemin racine de DokuWiki renvoie HTTP 200 avec la page principale du wiki (ou l'assistant
   d'installation lors de la première visite). Si vous recevez une réponse autre que 200, attendez 30 secondes et réessayez —
   le bucket de stockage monté via gcsfuse est peut-être encore en cours d'initialisation.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier accès, DokuWiki présente
   l'**Install Wizard** (assistant d'installation) sur `$SERVICE_URL/install.php`. Terminez l'assistant pour définir le
   nom du wiki, le nom d'utilisateur administrateur, le mot de passe administrateur et la politique ACL initiale. Une fois
   l'assistant terminé, la page `install.php` n'est plus accessible par la suite.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification du service, la mise à l'échelle est donc un changement de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de l'application suivante). DokuWiki
   utilise un verrouillage basé sur des fichiers dans le bucket monté via gcsfuse, de sorte que plusieurs instances
   simultanées sont prises en charge, mais des conflits d'écriture restent possibles en cas de forte concurrence.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez le stockage** (DokuWiki ne crée aucun secret Secret Manager — le compte
   administrateur est créé de manière interactive via `/install.php`) :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~dokuwiki"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU
   / de la mémoire. Le module provisionne également un **uptime check** ; vérifiez qu'il
   est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de DokuWiki.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que le montage du volume gcsfuse a réussi.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de montage gcsfuse :** vérifiez que le bucket de données du module
  (`gcs-dokuwiki<tenant-prefix>-data`, monté en tant que volume `dokuwiki-data`) existe et que
  `execution_environment = "gen2"` est défini (les montages de volumes GCS Fuse exigent Gen2).
- **L'assistant d'installation réapparaît après la configuration :** vérifiez que l'assistant s'est terminé et que le
  fichier `install.php` a été supprimé du bucket `/storage`. Sinon, relancez
  l'assistant.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
le bucket Cloud Storage qui sous-tend `/storage` et les images Artifact Registry (DokuWiki
ne crée aucun secret Secret Manager). Les ressources appartenant à **Services_GCP** (le VPC,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, un bucket Cloud Storage (gcsfuse) et construit l'image |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé répond ; terminer l'assistant d'installation de DokuWiki dans le navigateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'uptime check |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de montage gcsfuse, d'assistant d'installation, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
