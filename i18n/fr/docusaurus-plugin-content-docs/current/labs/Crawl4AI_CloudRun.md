---
title: "Crawl4AI sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Crawl4AI sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Crawl4AI_CloudRun.md @ 3055034 sha256:bba615f5f71f -->

# Crawl4AI sur Cloud Run — Guide de lab {#crawl4ai-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Crawl4AI est un robot d'exploration et d'extraction web open source adapté aux LLM, conçu pour les
équipes IA qui construisent des pipelines RAG, des bases de connaissances et des workflows de surveillance. Ce lab
vous guide à travers le cycle de vie opérationnel complet du module **Crawl4AI on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Crawl4AI. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Crawl4AI (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run Gen2, réplique l'image de conteneur
   dans Artifact Registry, configure la sortie VPC et met en place Cloud
   Monitoring. Crawl4AI n'a ni base de données externe ni job d'initialisation —
   les premiers déploiements sont plus rapides que ceux des modules adossés à une base de données.

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~crawl4ai" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. À la première requête, supervisord doit démarrer Redis
   puis Gunicorn — prévoyez jusqu'à 60 secondes pour la réponse initiale :

   ```bash
   curl -s "$SERVICE_URL/health"   # expect {"status":"ok"}
   ```

2. Crawl4AI n'a ni connexion administrateur ni identifiants générés automatiquement. Le service est
   prêt lorsque le contrôle de santé ci-dessus renvoie `{"status":"ok"}`. Un
   playground interactif est disponible à l'adresse `${SERVICE_URL}/playground` dans un navigateur —
   aucune connexion n'est requise par défaut.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max dans la plateforme RAD et
   en les appliquant via **Update** — le module gère la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait annulée lors de
   l'application suivante).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans l'interface
   RAD et en l'appliquant via **Update** ; une nouvelle image est répliquée et une nouvelle révision est déployée.

4. **Gérez les secrets** (les clés d'API LLM et le secret JWT facultatif sont stockés dans
   Secret Manager s'ils sont fournis au moment du déploiement) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
   ```

5. Crawl4AI est **entièrement sans état** — il n'a ni base de données, ni jobs de sauvegarde, ni
   stockage persistant par défaut. Les résultats des tâches résident dans le Redis intégré au
   conteneur et sont perdus au redémarrage du conteneur. Aucune session de base de données n'est nécessaire.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation du CPU et de la mémoire. Le module provisionne également un
   **test de disponibilité** (qui interroge `/health`) ; vérifiez qu'il est au vert dans
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Crawl4AI.

- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage interroge `/health`
  après un délai initial de 40 secondes afin de laisser supervisord démarrer Redis puis
  Gunicorn. Si la révision ne devient pas saine, inspectez ses journaux à la recherche
  d'erreurs de démarrage de supervisord ou de Chromium.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Manque de mémoire (OOM) / plantages de Chromium :** Chromium exige au moins 4 GiB par instance.
  Recherchez des signaux d'OOM dans les journaux et augmentez `memory_limit` dans la plateforme RAD.
- **Les explorations échouent immédiatement :** vérifiez `vpc_egress_setting = "ALL_TRAFFIC"` —
  `PRIVATE_RANGES_ONLY` bloque toutes les cibles d'exploration publiques.
- **L'extraction par LLM renvoie des résultats vides :** vérifiez que les clés d'API LLM requises
  ont été fournies via `secret_environment_variables` et que les secrets existent.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
  ```
- **Échec du build / de la réplication de l'image :** consultez l'historique Cloud Build pour le journal
  du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le service Cloud Run,
les secrets Secret Manager (s'il en a été provisionné) et les images Artifact Registry.
Crawl4AI ne provisionne aucune base de données ; il n'y a donc aucune instance Cloud SQL à supprimer.
Les ressources détenues par **Services_GCP** (le VPC, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run Gen2, réplique l'image, configure la sortie VPC et la surveillance |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit sur `/health` ; le playground est accessible |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de santé des révisions, d'OOM, de sortie réseau, de clés LLM, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
