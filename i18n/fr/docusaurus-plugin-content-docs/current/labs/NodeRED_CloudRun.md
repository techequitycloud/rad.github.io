---
title: "NodeRED sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez NodeRED sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/NodeRED_CloudRun.md @ 3055034 sha256:8ce40a5ce0af -->

# NodeRED sur Cloud Run — Guide de lab {#nodered-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Node-RED est un outil open source de programmation par flux qui permet de relier des objets connectés,
des API et des services en ligne au moyen d'un éditeur visuel dans le navigateur. Ce lab vous fait
parcourir le cycle de vie opérationnel complet du module **Node-RED on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Node-RED. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le NFS Filestore, Artifact Registry et les
  comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **NodeRED (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (gen2, requis pour NFS), un partage NFS
   Filestore monté sur `/data` pour le stockage persistant des flux, un bucket Cloud Storage, un
   secret Secret Manager pour la clé de chiffrement des identifiants des flux, et construit ou met en miroir
   l'image de conteneur. Aucune base de données n'est provisionnée. Les premiers déploiements prennent environ
   **8 à 18 minutes** (le provisionnement de Filestore domine).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~nodered" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain — la sonde de démarrage de Node-RED cible une requête HTTP GET sur `/`,
   qui renvoie l'interface de l'éditeur une fois le service entièrement démarré :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   # expect: 200
   ```

   Si vous obtenez `503`, attendez 30 à 60 secondes que le remontage NFS et la sonde de démarrage
   se terminent, puis réessayez.

2. Ouvrez l'éditeur Node-RED dans votre navigateur à l'adresse `$SERVICE_URL`. Aucun identifiant n'est
   requis par défaut ; pour les déploiements de production, IAP est recommandé (consultez le
   Guide de configuration). L'éditeur donne un accès complet à la modification des flux et à la gestion
   des identifiants — ne le laissez pas accessible publiquement en production.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service ; la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors du prochain apply). Conservez
   `max_instance_count = 1`, sauf si les flux sont sans état ou si un stockage de contexte externe
   adossé à Redis est activé.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est mise en miroir ou construite et une nouvelle révision est déployée.

4. **Gérez les secrets et les jobs de sauvegarde :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~nodered"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspectez le stockage adossé à NFS** — tous les flux, les identifiants et les nœuds de palette
   installés sont conservés dans le partage Filestore monté sur `/data` :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.volumes)'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du CPU et de la mémoire. Le module provisionne également un **test de disponibilité** sur `/`
   (lorsqu'il est activé) ; confirmez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Node-RED.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible `/` avec un délai initial
  de 30 secondes ; le remontage NFS allonge le temps de démarrage à froid.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échec du montage NFS :** confirmez que l'instance Filestore est `READY`, que
  `execution_environment = "gen2"` est défini (NFS exige gen2) et que le connecteur
  VPC permet au service d'atteindre l'adresse IP du serveur NFS.
- **Identifiants des flux illisibles après un **Update** :** le `NODE_RED_CREDENTIAL_SECRET`
  a peut-être fait l'objet d'une rotation ou d'une modification. Récupérez la valeur actuelle du secret et vérifiez qu'elle
  correspond à la clé utilisée lors du dernier déploiement des flux.
  ```bash
  CRED_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~nodered" --format="value(name)" --limit=1)
  gcloud secrets versions access latest --secret="$CRED_SECRET" --project="$PROJECT"
  ```
- **Échec du build ou de la récupération de l'image :** consultez l'historique de Cloud Build pour lire le journal du build
  en échec. Confirmez que l'image a bien été mise en miroir dans Artifact Registry.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution et
  son accès à Secret Manager.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
l'instance NFS Filestore, les secrets Secret Manager, le bucket GCS et les images Artifact
Registry. Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (gen2), le NFS Filestore, le bucket GCS et le secret des identifiants |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit (HTTP 200 sur `/`) ; l'éditeur se charge dans le navigateur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, inspecter le NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de montage NFS, d'identifiants, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
