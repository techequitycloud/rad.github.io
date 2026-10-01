---
title: "Gotify sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Gotify sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Gotify_CloudRun.md @ 3055034 sha256:3f0642b3b838 -->

# Gotify sur Cloud Run — Guide de lab {#gotify-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Gotify est un serveur open source et auto-hébergé de notifications push en temps réel :
les applications envoient des messages via une simple API REST et les clients les reçoivent instantanément
via WebSocket. Ce lab vous guide à travers le cycle de vie opérationnel complet du
module **Gotify on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, envoyer
et recevoir une notification en direct, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Gotify. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et récupérer le mot de passe administrateur généré.
- Envoyer un message via l'API REST et le recevoir sur le flux WebSocket.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un client WebSocket pour l'exemple pratique — `websocat` (recommandé) ou `curl` 8.x.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Gotify (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (le mot de passe administrateur et le mot de passe de la base de données),
   construit l'image de conteneur personnalisée (qui encapsule `ghcr.io/gotify/server`) et exécute un
   job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ **20–35 minutes**
   (la création de Cloud SQL domine).

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gotify" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. Gotify expose un
   point de terminaison de santé public qui indique l'état du serveur et de la base de données :

   ```bash
   curl -s "$SERVICE_URL/health"    # expect {"health":"green","database":"green"}
   ```

2. Récupérez le mot de passe administrateur généré dans Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~gotify-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant que **`admin`** avec ce mot de passe.
   Changez immédiatement le mot de passe sous **Users** — le mot de passe d'amorçage n'est appliqué
   que lors de la première initialisation de la base de données et n'est pas réinitialisé par les déploiements ultérieurs.

---

## Tâche 3 — Envoyer et recevoir une notification [Manuel] {#task-3--send-and-receive-a-notification-manual}

C'est le flux de travail principal de Gotify : un *jeton d'application* envoie des messages ; un *jeton
client* s'y abonne.

1. **Créez une application** (dans l'interface : **Apps → Create Application**), ou via
   l'API REST en utilisant l'authentification HTTP basique en tant qu'utilisateur administrateur. Récupérez le jeton d'application renvoyé :

   ```bash
   ADMIN_PASS='<paste-the-admin-password>'
   APP_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-app","description":"lab notifications"}' \
     "$SERVICE_URL/application" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "App token: $APP_TOKEN"
   ```

2. **Créez un client** pour recevoir les messages, et récupérez son jeton :

   ```bash
   CLIENT_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-client"}' \
     "$SERVICE_URL/client" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "Client token: $CLIENT_TOKEN"
   ```

3. **Abonnez-vous au flux** dans un terminal (laissez-le tourner). Gotify diffuse les nouveaux
   messages via WebSocket sur `/stream` :

   ```bash
   WS_URL="${SERVICE_URL/https:/wss:}/stream?token=$CLIENT_TOKEN"
   websocat "$WS_URL"          # or: curl --include -N "$SERVICE_URL/stream?token=$CLIENT_TOKEN"
   ```

4. **Envoyez un message** depuis un autre terminal avec le jeton d'application. Il doit apparaître dans
   le terminal du flux en moins d'une seconde :

   ```bash
   curl -s "$SERVICE_URL/message?token=$APP_TOKEN" \
     -F "title=Deploy complete" -F "message=Gotify is live on Cloud Run" -F "priority=5"
   ```

   Le terminal du flux affiche le message JSON. Ce chemin de bout en bout — REST en entrée,
   WebSocket en sortie — est exactement celui qu'utiliseront vos applications et vos clients.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** Le bus de messages de Gotify est interne au processus ; un
   client ne reçoit donc que les messages remis à l'instance à laquelle il est connecté. Le
   module fixe `min = max = 1` ; modifier cela sans couche de diffusion externe fait perdre
   des messages à certains abonnés.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.
   Gotify exécute sa migration automatique GORM au démarrage ; les modifications de schéma s'appliquent donc
   automatiquement.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gotify"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. gotifydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^gotify" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation du CPU et de la mémoire.
   Le module peut provisionner un **test de disponibilité** sur `/health` via
   `uptime_check_config`, mais sa valeur par défaut est `enabled = false` — définissez
   `uptime_check_config.enabled = true` lors du déploiement si vous en voulez un, puis vérifiez
   qu'il est au vert dans Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Gotify.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. La sonde de
  démarrage cible `/health` et autorise environ 5 minutes au premier démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données existe et que le job d'initialisation s'est terminé avec succès. Gotify
  journalise l'hôte, le port et le nom de la base de données au démarrage.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle en échec :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
- **`403 invalid API token` à l'envoi ou à la réception :** revérifiez le jeton — les jetons d'application envoient
  (`/message`), les jetons client s'abonnent (`/stream`) ; ils ne sont pas interchangeables.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment pourquoi `max_instance_count` doit rester à 1).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud. Cette opération supprime tout ce que le module a créé
— le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager et les images Artifact
Registry. Les ressources détenues par **Services_GCP** (le VPC, Cloud SQL partagé, le
registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le test de santé réussit ; se connecter en tant que `admin` avec le mot de passe généré |
| 3 — Envoyer et recevoir | Manuel | Créer les jetons d'application et client, envoyer un message par POST, le recevoir via WebSocket |
| 4 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de build et de jeton |
| 7 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
