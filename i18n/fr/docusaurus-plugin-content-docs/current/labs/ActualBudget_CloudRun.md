---
title: "ActualBudget sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer ActualBudget sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/ActualBudget_CloudRun.md @ 3055034 sha256:568e4e5d1453 -->

# ActualBudget sur Cloud Run — Guide de lab {#actualbudget-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 20–40 minutes

Une application de budget personnel fondée sur la méthode des enveloppes pour suivre les revenus et les dépenses. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **ActualBudget on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit ActualBudget. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
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
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **ActualBudget (Cloud Run)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun) documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run et un bucket de données GCS, et construit l'image du conteneur. Aucune base de données ni job d'initialisation n'est nécessaire. Les premiers déploiements prennent environ **10–20 minutes** (la construction de l'image en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Vérifiez que le service est en bonne santé** en interrogeant le point de terminaison de liveness (le chemin de sonde de démarrage/liveness configuré par le module) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

   Attendez-vous à une réponse HTTP 200 confirmant que le service s'exécute et écoute — il s'agit du même chemin racine que celui vérifié par les sondes de démarrage et de vivacité du déploiement.

2. **Ouvrez l'interface d'ActualBudget** dans votre navigateur en accédant à `$SERVICE_URL`. ActualBudget ne nécessite pas d'identifiants initiaux — il vous sera demandé de créer ou d'importer un fichier de budget lors du premier accès. Aucune récupération de mot de passe n'est nécessaire avant de commencer.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente qui est en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et le stockage :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~actualbudget"
   gsutil ls -p "$PROJECT" | grep actualbudget
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'ActualBudget.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses journaux à la recherche d'erreurs de démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run, les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Service Cloud Run et bucket GCS provisionnés ; image construite et déployée |
| 2 — Accéder et vérifier | Manuel | Le point de terminaison de liveness renvoie 200 ; l'interface de budget se charge dans le navigateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les échecs de révision, les erreurs de build et les problèmes d'autorisation |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
