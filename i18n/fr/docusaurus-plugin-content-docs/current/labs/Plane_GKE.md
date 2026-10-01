---
title: "Plane sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Plane sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Plane_GKE.md @ 3055034 sha256:41e59fb36357 -->

# Plane sur GKE Autopilot — Guide de lab {#plane-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Plane est un outil open source de gestion de projet et de suivi des tickets — une alternative à Jira / Linear / Asana couvrant les tickets, les sprints, les cycles, les modules et les feuilles de route. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Plane on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Plane. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail Plane en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris la dépendance à RabbitMQ et l'étape migrator intégrée à l'image.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Plane (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Plane_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie l'**image communautaire tout-en-un** de Plane
   (`makeplane/plane-aio-community`, construite sur mesure par ce module) dans le cluster GKE
   Autopilot sous la forme d'un seul Deployment (2 vCPU / 4 GiB par défaut), servi
   en interne par Caddy sur le port 80. En parallèle, la plateforme provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_KEY` et `LIVE_SERVER_SECRET_KEY` générés automatiquement, ainsi que le mot de passe
   de la base de données), un broker **RabbitMQ** sous la forme d'un second Deployment dans le cluster (interne uniquement,
   obligatoire — le `start.sh` de Plane refuse de démarrer sans `AMQP_URL`), Redis sur
   la VM NFS partagée, un bucket GCS `storage` (le raccordement des envois de fichiers est un TODO
   documenté — voir la tâche 5), construit l'image de conteneur personnalisée et exécute une tâche ponctuelle
   `db-init`. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep plane | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

   Vous devriez voir un Deployment pour la charge de travail tout-en-un de Plane et un second
   pour RabbitMQ (suffixe de Service `-mq`), ainsi que le Job `db-init`.

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Les sondes de démarrage et de liveness ciblent toutes deux
   `GET /health` sur le proxy Caddy interne ; sur un nouveau déploiement, prévoyez plusieurs
   minutes pour que l'étape `migrator` intégrée (les migrations de schéma Django propres à Plane,
   exécutées sous supervisord avant le démarrage d'api/worker/beat/web) se termine — la
   sonde de démarrage accorde jusqu'à ~5 minutes (30 échecs à une période de 10s) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"
   ```

3. Vérifiez que le point d'entrée d'encapsulation a composé les trois URL de connexion dont Plane
   a besoin à partir des valeurs distinctes injectées par la plateforme :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'DATABASE_URL|REDIS_URL|AMQP_URL'
   ```

4. Ouvrez `http://${EXTERNAL_IP}/god-mode/` dans un navigateur — le panneau d'administration
   de l'instance Plane (notez la barre oblique finale ; le point d'entrée modifie Caddy avec une redirection
   depuis le chemin sans barre oblique) — et créez le compte administrateur de l'instance. Ouvrez ensuite
   `http://${EXTERNAL_IP}/` pour vous inscrire et créer votre premier espace de travail, projet
   et ticket. Aucun identifiant administrateur prédéfini n'existe dans Secret Manager — le
   premier compte est créé de manière interactive.

5. **Note de durcissement immédiat :** les envois de fichiers (pièces jointes, avatars, images
   de couverture) nécessitent de véritables identifiants compatibles S3. Le module provisionne un bucket
   GCS et fait pointer `AWS_S3_ENDPOINT_URL` vers `storage.googleapis.com`, mais la couche
   d'interopérabilité S3 de GCS exige des clés HMAC que ce module ne provisionne pas — les envois
   échouent silencieusement tant que vous ne fournissez pas `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_REGION`, `AWS_S3_BUCKET_NAME` et `AWS_S3_ENDPOINT_URL` via le paramètre
   `environment_variables` puis appliquez via **Update**. Tout le reste
   (tickets, projets, cycles) fonctionne sans cela.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods, RabbitMQ et l'autoscaler
   horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- supervisorctl status
   ```

   La sortie de `supervisorctl status` liste chaque sous-processus intégré (api,
   worker, beat, web, space, admin, live, migrator) dans l'unique pod.

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).
   La valeur par défaut est `min=1`/`max=3`. Comme le planificateur `beat` de Celery s'exécute dans le processus
   de chaque pod (et non comme un singleton distinct), passer à plus d'un réplica peut
   dupliquer les déclenchements de tâches planifiées — vérifiez que c'est acceptable avant d'augmenter
   `max_instance_count`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite (le Dockerfile d'encapsulation fige
   `makeplane/plane-aio-community:<version>` — il n'existe aucun tag `latest` en amont ;
   le module utilise donc `stable` par défaut et convertit automatiquement un `latest` fourni en `stable`)
   et une mise à jour progressive remplace les pods. Le migrator réapplique
   les éventuelles modifications de schéma au démarrage du nouveau pod.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   kubectl get jobs -n "$NS"                       # db-init and any additional jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   ```

5. **Vérifiez RabbitMQ** — il est obligatoire et son stockage est éphémère (aucun
   PVC/NFS attaché) ; un redémarrage du pod ou une préemption de nœud fait donc perdre les tâches
   Celery en file d'attente :

   ```bash
   kubectl get deploy,svc -n "$NS" | grep -- '-mq'
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')-mq" \
     -- rabbitmqctl list_queues
   ```

6. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. planedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^plane" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — supervisord multiplexe chaque sous-processus intégré (migrator, api,
   worker, beat, frontends, Caddy) dans le stdout/stderr du pod, auxquels s'ajoutent les
   journaux propres au pod RabbitMQ distinct :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')-mq" --tail=50
   ```

   Filtre de l'explorateur de journaux (Logs Explorer) :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (uptime check) sur `/health` (lorsqu'il est activé) ; consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Plane.

- **Pod non Ready / CrashLoopBackOff :** inspectez d'abord les événements et les journaux.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```

- **PROBLÈME CONNU, NON RÉSOLU — le sous-processus migrator boucle en échec sans erreur
  visible, et `/api/instances/` renvoie 502 :** dans certains déploiements, les sous-processus
  api/worker/beat/live démarrent tous correctement et passent la vérification de liveness `/health`,
  mais l'étape `migrator` intégrée de Plane sous supervisord se termine avec un code
  non nul et supervisord la relance indéfiniment — laissant les migrations de schéma Django
  inachevées. Le symptôme est une charge de travail qui semble Ready (`/health`
  est servi par Caddy indépendamment du migrator) tandis que les appels API touchant
  des tables non migrées renvoient 502. **Cela n'apparaît pas dans Cloud Logging** — supervisord
  ne transmet pas le stderr du processus enfant du programme `migrator` vers le
  stdout/stderr du conteneur ; `kubectl logs` n'affiche donc rien d'utile.
  Le diagnostic exige actuellement un exec interactif dans le pod en cours d'exécution :
  ```bash
  POD=$(kubectl get pods -n "$NS" -l app!=mq -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NS" "$POD" -- supervisorctl status         # confirm migrator shows FATAL/BACKOFF
  kubectl exec -n "$NS" "$POD" -- supervisorctl tail -1000 migrator stderr
  kubectl exec -n "$NS" "$POD" -- supervisorctl tail -1000 migrator stdout
  ```
  Si la fin du journal propre au migrator reste peu parlante, essayez d'exécuter directement sa
  commande de gestion sous-jacente dans le pod pour faire apparaître la trace
  brute (le chemin et le nom de la commande varient selon la version de l'image — inspectez
  `/app/supervisor/*.conf` ou l'équivalent dans le conteneur pour confirmer l'invocation
  exacte avant de la lancer manuellement). Traitez ceci comme un problème ouvert de la plateforme,
  et non comme une erreur de configuration de votre part — ne supposez pas qu'une migration
  du premier démarrage s'est bien déroulée simplement parce que le pod indique Ready.

- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que la tâche `db-init`
  s'est terminée (elle crée le rôle/la base de données et accorde les privilèges avant même que le
  migrator ne s'exécute) :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```

- **Erreurs Celery / du broker (worker ou beat ne peut pas se connecter) :** le
  `start.sh` de Plane valide `AMQP_URL` et refuse tout démarrage s'il est vide —
  c'est tout le pod qui boucle en échec, pas seulement le worker. Vérifiez que le Deployment `mq`
  est Running et que `RABBITMQ_HOST` a été résolu vers le nom DNS interne au cluster
  (`<service-name>-mq.<namespace>.svc.cluster.local`) :
  ```bash
  kubectl get deploy,svc -n "$NS" | grep -- '-mq'
  kubectl exec -n "$NS" "$POD" -- env | grep -E 'RABBITMQ_HOST|AMQP_URL'
  ```
  Comme le stockage de RabbitMQ est éphémère, un redémarrage du pod fait perdre toutes les tâches en file d'attente —
  il s'agit d'une valeur par défaut acceptée, et non d'un bug à corriger localement.

- **Les envois de fichiers échouent (application par ailleurs en bonne santé) :** comportement attendu tant que le stockage
  compatible S3 n'est pas raccordé — voir la tâche 2, étape 5. C'est propre à Plane et documenté
  dans la section Pitfalls du Guide de configuration.

- **Échec de la tâche d'initialisation :** inspectez la tâche et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```

- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.

- **Erreurs de récupération / de build d'image :** consultez l'historique Cloud Build. Une cause fréquente est
  un `application_version` invalide — l'image amont `plane-aio-community`
  n'a pas de tag `latest` (le module convertit `latest`→`stable`, mais un tag explicite
  mal saisi renvoie une 404 avec `MANIFEST_UNKNOWN`).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre, notamment la règle selon laquelle RabbitMQ est obligatoire et le
TODO concernant les envois de fichiers.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms (y compris le Deployment RabbitMQ), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre, l'hôte NFS/Redis) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE (image tout-en-un + Deployment RabbitMQ), Cloud SQL (PostgreSQL 15), Redis, un bucket de stockage, les secrets, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; `/health` répond ; URL de connexion composées ; administrateur de l'instance créé via `/god-mode/` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail/RabbitMQ, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage/les tâches, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de broker, d'envoi de fichiers, de tâche d'initialisation et de build d'image — y compris la boucle d'échec non résolue du migrator (diagnostic par exec requis) |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
