---
title: "Shlink sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Shlink sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Shlink_GKE.md @ 3055034 sha256:8826692586b9 -->

# Shlink sur GKE Autopilot — Guide de lab {#shlink-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Shlink est un raccourcisseur d'URL open source et auto-hébergé, doté d'une API REST,
de la génération de codes QR et d'analyses détaillées du suivi des visites. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Shlink on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Shlink. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Récupérer la clé d'API générée automatiquement et créer votre première URL courte.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Shlink (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Shlink_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (le
   mot de passe de la base de données et la clé `INITIAL_API_KEY` générée automatiquement), construit l'image
   de conteneur, une fine surcouche (`FROM shlinkio/shlink:stable`), et exécute un job ponctuel
   `db-init` qui crée le rôle applicatif et la base de données. Shlink n'a besoin
   ni de bucket GCS ni de partage NFS — tout l'état réside dans PostgreSQL. Un premier déploiement prend
   environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep shlink | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe. Shlink est
   exposé par défaut via un Service `LoadBalancer` doté d'une IP statique
   réservée :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel. Le chemin de santé de Shlink est `/rest/health` — un
   point de terminaison public, sans authentification, qui renvoie HTTP 200 avec
   `{"status":"pass",...}`. **Ne testez pas `/`** — Shlink est conçu d'abord comme une API et n'a pas de
   page d'accueil web, si bien que le chemin racine renvoie 404 par conception :

   ```bash
   curl -s "http://${EXTERNAL_IP}/rest/health"
   # {"status":"pass","version":"...","links":{...}}
   ```

3. Récupérez la clé d'API générée automatiquement dans Secret Manager et créez votre
   première URL courte via l'API REST. Shlink n'a pas de connexion administrateur par nom d'utilisateur
   et mot de passe — tout l'accès repose sur des clés d'API :

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -X POST "http://${EXTERNAL_IP}/rest/v3/short-urls" \
     -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"longUrl": "https://cloud.google.com/kubernetes-engine"}'
   ```

   Ouvrez la `shortUrl` renvoyée dans un navigateur (ou avec `curl -I`) et vérifiez la
   redirection ; listez ensuite les visites enregistrées :

   ```bash
   curl -s "http://${EXTERNAL_IP}/rest/v3/short-urls" -H "X-Api-Key: $API_KEY"
   ```

4. **Durcissement et configuration après déploiement :** définissez `DEFAULT_DOMAIN` sur l'IP externe ou
   le domaine personnalisé afin que les URL courtes générées portent le bon hôte — le module ne le
   prédéfinit pas :

   ```bash
   SERVICE=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl set env deploy/"$SERVICE" -n "$NS" DEFAULT_DOMAIN="${EXTERNAL_IP}"
   ```

   Ajoutez éventuellement une `GEOLITE_LICENSE_KEY` via `environment_variables` et
   **Update** pour activer la géolocalisation des visites. Pour disposer d'une interface navigateur, pointez le
   [shlink-web-client](https://app.shlink.io/) hébergé vers `http://${EXTERNAL_IP}` avec
   votre clé d'API.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement et les pods (Shlink se déploie sous la forme d'un
   `Deployment` sans état, avec la stratégie `RollingUpdate` par défaut ; il n'y a
   ni PVC ni StatefulSet à vérifier) :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).
   Shlink est sans état d'une requête à l'autre, l'état étant dans PostgreSQL (par défaut
   `min_instance_count = 1`, `max_instance_count = 3`), si bien que relever le plafond
   est sans risque, sans autre réglage. `session_affinity = ClientIP` est défini
   par défaut pour un routage persistant.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update**. Notez que `application_version` n'est **pas**
   relié au build de l'image pour Shlink — le Dockerfile construit toujours `FROM
   shlinkio/shlink:stable`, si bien que cela déclenche une reconstruction et un redéploiement de la même
   étiquette amont plutôt que l'épinglage d'une version précise. Shlink exécute automatiquement ses propres
   migrations de schéma au premier démarrage des nouveaux pods.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~shlink"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **contrôle de disponibilité** (uptime check) ciblant `/rest/health` (désactivé par défaut —
   `uptime_check_config.enabled = false`) ; lorsqu'il est activé, consultez Monitoring →
   Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Shlink.

- **`/` renvoie 404 :** ce n'est pas une défaillance — Shlink n'a pas de page d'accueil web. Vérifiez
  la santé sur `/rest/health` et interagissez via `/rest/v3/...` avec l'en-tête
  `X-Api-Key`.
- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de
  démarrage et de vivacité ciblent toutes deux `/rest/health` ; la sonde de démarrage accorde
  `failure_threshold=30` à `period_seconds=10` (~300s) aux migrations du premier
  démarrage, ne concluez donc pas trop tôt à un échec :

  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```

- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données a bien été matérialisé dans le namespace et que le
  job `db-init` s'est terminé. Ne définissez jamais `DB_USER`/`DB_NAME` manuellement dans
  `environment_variables` — la fondation injecte des valeurs propres au tenant, et
  les remplacer par les noms courts `shlink`/`shlink` provoque `password
  authentication failed` sur un rôle qui n'a jamais été créé.
- **Échec du job `db-init` :** inspectez le job et les journaux de son pod :

  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```

- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a reçu une
  IP :

  ```bash
  kubectl get svc -n "$NS" -o wide
  ```

- **401 sur les appels d'API :** l'en-tête `X-Api-Key` doit contenir la valeur du
  secret `INITIAL_API_KEY` (ou d'une clé que vous avez créée avec celui-ci). Récupérez-la à nouveau dans
  Secret Manager comme dans la tâche 2 — Shlink n'a pas de connexion administrateur de secours.
- **Mauvais hôte dans les URL courtes générées :** définissez `DEFAULT_DOMAIN` sur l'IP externe
  ou le domaine personnalisé (voir la tâche 2, étape 4) — d'ici là, Shlink peut construire les URL
  courtes avec le mauvais hôte.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment l'immuabilité de
`application_database_name`/`application_database_user` après le premier déploiement,
et la raison pour laquelle `DB_NAME`/`DB_USER` ne doivent jamais être définis manuellement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, la base de données Cloud SQL et les secrets Secret Manager (y compris la
clé d'API initiale). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15) et les secrets, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/rest/health` réussit ; première URL courte créée via l'API REST avec la clé d'amorçage |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de clé d'API, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
