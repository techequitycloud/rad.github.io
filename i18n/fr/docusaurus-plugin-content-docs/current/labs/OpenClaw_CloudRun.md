---
title: "OpenClaw sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer OpenClaw sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/OpenClaw_CloudRun.md @ 3055034 sha256:33d72d3a2eca -->

# OpenClaw sur Cloud Run — Guide de lab {#openclaw-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

OpenClaw est une passerelle d'agents d'IA multi-tenant permettant d'exécuter des assistants d'IA isolés et persistants
reposant sur des modèles Anthropic, avec des espaces de travail GCS-Fuse dédiés et une intégration facultative
de canaux Telegram ou Slack. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **OpenClaw on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit OpenClaw. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Serverless VPC Access, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **OpenClaw (Cloud Run)** depuis la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Une clé API Anthropic est requise lors du premier déploiement — saisissez-la dans le
   champ de paramètre correspondant. Ne configurez que ce dont vous avez besoin par ailleurs — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur personnalisée (en ajoutant `entrypoint.sh` par-dessus
   l'image OpenClaw amont), crée un bucket d'espace de travail GCS monté sur `/data` via
   GCS Fuse, stocke la clé API Anthropic et le jeton de passerelle dans Secret Manager, puis
   déploie le service Cloud Run. OpenClaw ne nécessite ni Cloud SQL ni tâche d'initialisation — l'état
   des agents réside entièrement sur GCS. Les premiers déploiements prennent environ **10–20 minutes** (Cloud
   Build en représente l'essentiel).

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~openclaw" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Par défaut, `ingress_settings = "all"` rend le service directement joignable à son
   URL `run.app` — aucun proxy ni tunnel n'est nécessaire. Si vous définissez `ingress_settings = "internal"`
   (ce qui limite le service au trafic VPC, par exemple lorsqu'il est placé derrière un routeur OpenClaw),
   utilisez plutôt le proxy `gcloud` :

   ```bash
   gcloud run services proxy "$SERVICE" \
     --region="$REGION" --project="$PROJECT" --port=8080
   # Access at http://localhost:8080
   ```

2. Vérifiez que le service est en bonne santé :

   ```bash
   curl -s "$SERVICE_URL/health"   # expect {"status":"ok"}
   ```

3. Récupérez le jeton de passerelle dans Secret Manager pour authentifier les appels d'API :

   ```bash
   GW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~openclaw~gateway-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$GW_SECRET" --project="$PROJECT"
   ```

   Le jeton de passerelle est l'identifiant utilisé par les clients et intégrations OpenClaw. La
   clé API Anthropic peut, si nécessaire, être récupérée de la même façon depuis son secret Secret Manager
   (filtrez sur `~openclaw~anthropic-api-key`).

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
   qu'OpenClaw est avec état (stateful) ; conservez `max_instance_count = 1` par tenant, sauf si un routage
   persistant (sticky routing) est en place.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~openclaw"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspectez l'espace de travail GCS** qui héberge tout l'état des agents :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~openclaw~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/"
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
   l'utilisation du CPU / de la mémoire. Le module provisionne également un **test de disponibilité** (uptime check) (lorsqu'il est activé) ;
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'OpenClaw.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `GET /health` sur le port 8080 et
  accorde environ 2 minutes pour le montage GCS Fuse et le démarrage de Node.js.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échec du montage GCS Fuse :** vérifiez que le bucket d'espace de travail existe et que le
  compte de service d'exécution dispose du rôle Storage Object Admin sur celui-ci. Le service nécessite
  l'environnement d'exécution Gen2 — Gen1 ne prend pas en charge GCS Fuse et échouera silencieusement.
- **Erreurs de l'API Anthropic (401) :** vérifiez que le secret `anthropic-api-key` possède une
  version valide. Récupérez-la et vérifiez-la via Secret Manager.
- **Erreurs de jeton de passerelle :** si des clients rencontrent des échecs d'authentification après la rotation d'un secret,
  le service doit être mis à jour pour prendre en compte la nouvelle valeur du jeton.
- **Échec du clonage du dépôt de skills :** une valeur `skills_repo_url`
  / `skills_repo_ref` injoignable ou inexistante fait échouer le conteneur au démarrage. Recherchez dans Cloud Logging
  les entrées `skill-library` et corrigez l'URL/la référence dans la plateforme RAD.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run, le bucket
d'espace de travail GCS, les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant
à **Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image, provisionne l'espace de travail GCS, stocke les secrets et déploie Cloud Run |
| 2 — Accès et vérification | Manuel | Accès par proxy ou public ; la vérification d'état réussit ; jeton de passerelle récupéré |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, inspecter l'espace de travail GCS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de GCS Fuse, d'API Anthropic, de jeton de passerelle, de synchronisation des skills et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
