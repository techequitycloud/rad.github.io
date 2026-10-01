---
title: "Evolution API sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Evolution API sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/EvolutionAPI_CloudRun.md @ 3055034 sha256:b4e099211ed0 -->

# Evolution API sur Cloud Run — Guide de lab {#evolution-api-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Evolution API est une passerelle open source Node.js pour l'API WhatsApp Business (construite sur la
bibliothèque Baileys) qui provisionne des instances WhatsApp, envoie et reçoit des messages, et
expose une API REST ainsi qu'une interface de gestion pour connecter WhatsApp à d'autres systèmes. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Evolution API on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités des produits Evolution API / WhatsApp. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun) —
ce lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et effectuer la configuration initiale de WhatsApp.
- Réaliser les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets, le cache et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le NFS Filestore, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Evolution API (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (fixé à une seule instance maintenue
   active en permanence), une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (la clé d'administration `AUTHENTICATION_API_KEY` générée automatiquement et le mot de passe de la base de données),
   un bucket de données Cloud Storage, une instance NFS Filestore (qui héberge aussi le point de terminaison
   Redis par défaut), construit l'image de conteneur et exécute un job ponctuel d'initialisation de la
   base de données. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL et
   du NFS domine).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres indépendants des noms (pour que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~evolutionapi" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Les sondes de démarrage et de vivacité d'Evolution API ciblent
   la racine `/` — un point de terminaison d'état non authentifié qui répond une fois le serveur
   démarré (prévoyez jusqu'à ~7 minutes au premier démarrage, le temps que les migrations Prisma s'exécutent) :

   ```bash
   curl -s "$SERVICE_URL/"   # expect a JSON status payload, not a connection error
   ```

2. Récupérez dans Secret Manager la clé d'administration globale générée automatiquement :

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT")
   echo "$API_KEY"
   ```

3. Ouvrez `$SERVICE_URL/manager` dans un navigateur (ou appelez directement l'API REST) en utilisant
   `$API_KEY` comme en-tête `apikey`, puis créez votre première instance WhatsApp :

   ```bash
   curl -s -X POST "$SERVICE_URL/instance/create" \
     -H "apikey: $API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"lab-instance","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```

4. Récupérez le QR code de connexion et scannez-le depuis WhatsApp sur votre téléphone (**Linked
   Devices → Link a Device**) pour connecter le numéro :

   ```bash
   curl -s "$SERVICE_URL/instance/connect/lab-instance" -H "apikey: $API_KEY"
   ```

   **Ne renouvelez jamais `AUTHENTICATION_API_KEY` à partir de ce moment** — la renouveler rend
   injoignable chaque instance WhatsApp déjà provisionnée et renvoie `401` à chaque
   client qui détient encore l'ancienne clé.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** Les sessions socket WhatsApp (Baileys) sont conservées
   dans la mémoire de l'instance et ne sont pas partagées entre les réplicas — `min_instance_count`
   et `max_instance_count` sont fixés à `1` par conception. Augmenter `max_instance_count`
   fragmente les connexions actives et duplique les livraisons de webhooks ; n'y touchez pas.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version (par défaut
   `v2.1.1`) dans la plateforme RAD et en l'appliquant via **Update** — une nouvelle image est construite
   et les migrations Prisma s'exécutent de nouveau au démarrage suivant.

4. **Gérez les secrets, le cache et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~evolutionapi"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"          # db-init + any scheduled jobs
   # Confirm the Redis cache URI resolved in the running revision:
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -i redis
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. evolutionapidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^evolutionapi" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^evolutionapi" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux. Le point d'entrée émet des
   marqueurs `[cloud-entrypoint]` qui confirment au démarrage la configuration DB/Redis/URL résolue :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99) et l'utilisation du processeur et de la mémoire (l'instance
   reste active à `min=1` ; attendez-vous donc à une petite ligne de base stable plutôt qu'à un comportement
   de mise à l'échelle jusqu'à zéro). Le module provisionne également un **test de disponibilité** ; vérifiez qu'il est au vert
   sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Evolution API à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde
  de démarrage cible `/` et accorde jusqu'à ~7 minutes au premier démarrage (délai initial de 60 s plus
  une fenêtre de 30 tentatives pendant la migration Prisma).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données existe et que le job d'initialisation s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Cache Redis désactivé silencieusement :** si `enable_redis=true` mais que la variable d'environnement de l'URI du cache
  est vide, vérifiez que `enable_nfs=true` (pour que l'IP du serveur NFS soit utilisée) ou qu'un
  `redis_host` explicite est défini.
- **401 sur chaque appel à l'API WhatsApp :** l'en-tête `apikey` est absent ou erroné, ou
  `AUTHENTICATION_API_KEY` a été renouvelée alors que des instances étaient déjà provisionnées — la
  solution consiste à reprovisionner les instances WhatsApp concernées, et non à revenir à l'ancienne clé.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`AUTHENTICATION_API_KEY` ni augmenter `max_instance_count` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le NFS,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (instance unique fixe), Cloud SQL (PostgreSQL 15), le NFS/Redis, les secrets, le bucket de stockage, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; récupérer la clé API d'administration ; créer et connecter une instance WhatsApp via QR code |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer les secrets/le cache/les jobs, accéder à la base de données — ne pas dépasser une instance |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de Redis, de clé d'authentification, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
