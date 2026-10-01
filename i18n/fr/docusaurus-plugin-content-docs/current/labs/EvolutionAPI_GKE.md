---
title: "Evolution API sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Evolution API sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/EvolutionAPI_GKE.md @ 3055034 sha256:ce3c7e47728c -->

# Evolution API sur GKE Autopilot — Guide de lab {#evolution-api-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Evolution API est une passerelle open source Node.js pour l'API WhatsApp Business (construite sur la
bibliothèque Baileys) qui provisionne des instances WhatsApp, envoie et reçoit des messages, et
expose une API REST ainsi qu'une interface de gestion pour connecter WhatsApp à d'autres systèmes. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Evolution API on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités des produits Evolution API / WhatsApp. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE) —
ce lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et effectuer la configuration
  initiale de WhatsApp.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets, le cache et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le NFS Filestore, Artifact Registry et les comptes de service partagés dont
  dépend ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Evolution API (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un seul
   réplica (Deployment), provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses
   secrets Secret Manager (la clé d'administration `AUTHENTICATION_API_KEY` générée automatiquement et
   le mot de passe de la base de données), un bucket de données Cloud Storage, une instance NFS Filestore
   (qui héberge aussi le point de terminaison Redis par défaut), un Service `LoadBalancer` externe,
   construit l'image de conteneur et exécute un job ponctuel d'initialisation de la base de données. Les premiers
   déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL et du NFS domine).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep evolutionapi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Les sondes de démarrage et de vivacité ciblent la racine `/` —
   un point de terminaison d'état non authentifié qui répond une fois le serveur démarré (prévoyez
   plusieurs minutes au premier démarrage, le temps que les migrations Prisma s'exécutent) :

   ```bash
   curl -s "http://${EXTERNAL_IP}/"   # expect a JSON status payload, not a connection error
   ```

3. Récupérez dans Secret Manager la clé d'administration globale générée automatiquement :

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT")
   echo "$API_KEY"
   ```

4. Ouvrez `http://${EXTERNAL_IP}/manager` dans un navigateur (ou appelez directement l'API REST)
   en utilisant `$API_KEY` comme en-tête `apikey`, puis créez votre première instance WhatsApp :

   ```bash
   curl -s -X POST "http://${EXTERNAL_IP}/instance/create" \
     -H "apikey: $API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"lab-instance","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```

5. Récupérez le QR code de connexion et scannez-le depuis WhatsApp sur votre téléphone (**Linked
   Devices → Link a Device**) pour connecter le numéro :

   ```bash
   curl -s "http://${EXTERNAL_IP}/instance/connect/lab-instance" -H "apikey: $API_KEY"
   ```

   Une fois l'IP externe confirmée comme stable, définissez `SERVER_URL` (via
   `environment_variables`) sur `http://${EXTERNAL_IP}` et appliquez via **Update**, afin que
   les URL de rappel des QR codes et des webhooks utilisent l'adresse externe joignable au lieu de
   la valeur interne par défaut du point d'entrée.

   **Ne renouvelez jamais `AUTHENTICATION_API_KEY` à partir de ce moment** — la renouveler rend
   injoignable chaque instance WhatsApp déjà provisionnée et renvoie `401` à chaque
   client qui détient encore l'ancienne clé.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement et les pods :

   ```bash
   kubectl get deploy,pods -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Ne dépassez pas un réplica.** Les sessions socket WhatsApp (Baileys) sont conservées
   dans la mémoire du pod et ne sont pas partagées entre les réplicas — `min_instance_count` et
   `max_instance_count` sont fixés à `1` par conception, et l'affinité de session `ClientIP`
   maintient chaque client sur cet unique pod. Augmenter `max_instance_count` fragmente
   les connexions actives et duplique les livraisons de webhooks ; n'y touchez pas.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version (par défaut
   `v2.1.1`) dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite
   et une mise à jour progressive remplace le pod, en réexécutant les migrations Prisma au démarrage.

4. **Gérez les secrets, le cache et les jobs :**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~evolutionapi"
   kubectl get jobs -n "$NAMESPACE"          # DB-init and any scheduled jobs
   # Confirm the Redis cache URI is injected into the running pod:
   kubectl exec -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -i CACHE_REDIS
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

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Le point d'entrée émet des
   marqueurs `[cloud-entrypoint]` qui confirment au démarrage la configuration DB/Redis/URL résolue :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du processeur et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Evolution API à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible `/` ; un échec de connexion à PostgreSQL empêche le pod de devenir
  Ready.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données a bien été matérialisé dans l'espace de noms et que le job d'initialisation s'est terminé. Sur
  GKE, le sidecar cloud-sql-proxy est une boucle locale TCP (`127.0.0.1`) ; le point d'entrée
  se connecte donc avec `sslmode=disable` — c'est le comportement attendu, et non une erreur de configuration.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Cache Redis désactivé silencieusement :** si `enable_redis=true` mais que la variable d'environnement de l'URI du cache
  est vide, vérifiez que `enable_nfs=true` (pour que l'IP du serveur NFS soit utilisée) ou qu'un
  `redis_host` explicite est défini.
- **401 sur chaque appel à l'API WhatsApp :** l'en-tête `apikey` est absent ou erroné, ou
  `AUTHENTICATION_API_KEY` a été renouvelée alors que des instances étaient déjà provisionnées — la
  solution consiste à reprovisionner les instances WhatsApp concernées, et non à revenir à l'ancienne clé.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`AUTHENTICATION_API_KEY` ni augmenter `max_instance_count` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le NFS, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE (Deployment à réplica unique), Cloud SQL (PostgreSQL 15), le NFS/Redis, les secrets, le bucket de stockage, le Service LoadBalancer, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; récupérer la clé API d'administration ; créer et connecter une instance WhatsApp via QR code |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à jour la version, gérer les secrets/le cache/les jobs, accéder à la base de données — ne pas dépasser un réplica |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de Redis, de clé d'authentification, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
