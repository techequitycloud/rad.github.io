---
title: "AFFiNE sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer AFFiNE sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Affine_GKE.md @ 3055034 sha256:8a8926e2934a -->

# AFFiNE sur GKE Autopilot — Guide de lab {#affine-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

AFFiNE est une base de connaissances open source, respectueuse de la vie privée, qui réunit documents, tableaux blancs et bases de données dans un même espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **AFFiNE on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit AFFiNE. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, la
  VM NFS/Redis partagée, Artifact Registry et les comptes de service partagés dont
  dépend ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible
  et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **AFFiNE (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Affine_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec son secret de mot de passe dans Secret Manager, un
   montage NFS Filestore pour la persistance des blobs (la même VM NFS partagée sert également de
   point de terminaison Redis par défaut, indispensable à AFFiNE), un bucket GCS dédié `storage`,
   construit l'image de conteneur personnalisée (une fine surcouche de
   `ghcr.io/toeverything/affine`) et exécute deux Jobs d'initialisation ponctuels : `db-init`
   (base de données + utilisateur) et `affine-migrate` (la migration de schéma `self-host-predeploy`
   propre à AFFiNE et la génération de la clé de signature). Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep affine | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Les sondes de démarrage, de liveness et de disponibilité (readiness) d'AFFiNE
   ciblent toutes un simple `GET /` HTTP, qui renvoie 200 dès que le serveur est prêt — sans
   authentification (la sonde de démarrage accorde jusqu'à ~510 secondes, mais un
   pod en bonne santé devient généralement Ready bien avant, puisque la migration de schéma
   a déjà été exécutée par le job `affine-migrate`, et non au démarrage) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur (ou `http://<EXTERNAL_IP>.nip.io` si
   vous préférez un nom d'hôte) et **créez le premier compte** — sur une nouvelle instance
   AFFiNE auto-hébergée, le premier utilisateur inscrit devient l'administrateur du serveur
   (le panneau d'administration se trouve à `/admin`). Faites-le immédiatement après le déploiement : tant qu'aucun
   compte administrateur n'existe, quiconque atteint l'URL peut l'enregistrer. AFFiNE ne dispose d'aucun
   identifiant administrateur prédéfini dans Secret Manager — le seul secret qui y est stocké est
   le mot de passe de la base de données, récupérable si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~affine" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et les volumes persistants :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module gère la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). La collaboration en temps réel et la file de jobs d'AFFiNE passent
   par Redis ; plusieurs réplicas dépendent donc de `enable_redis = true` (la valeur
   par défaut) et de la VM NFS partagée. L'affinité de session (`ClientIP`) est définie par défaut
   pour maintenir les sessions de collaboration WebSocket sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (par ex. `stable` → un tag de version figé) dans la plateforme RAD et en l'appliquant via
   **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les pods. Le
   job `affine-migrate` est réexécuté de manière idempotente sur la nouvelle version.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~affine"
   kubectl get jobs -n "$NS"          # db-init and affine-migrate
   gcloud storage buckets list --project="$PROJECT" --filter="name~affine"
   kubectl get pvc -n "$NS"           # NFS-backed blob storage claims
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (PostgreSQL 15,
   atteint depuis la charge de travail via le sidecar Cloud SQL Auth Proxy ; depuis votre
   propre shell, `gcloud sql connect` ouvre son propre tunnel) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. affinedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^affine" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez la connectivité Redis** — AFFiNE a besoin de Redis pour la synchronisation des documents
   en temps réel Yjs et pour sa file de jobs en arrière-plan ; par défaut, il se résout vers
   l'IP de la VM NFS/Redis partagée :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -i REDIS
   gcloud compute instances list --project="$PROJECT" --filter="name~nfs"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Les lignes de journal de démarrage indiquent
   quel hôte de base de données et quel point de terminaison Redis le point d'entrée cloud a résolus :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le job d'initialisation `affine-migrate`
   demande à lui seul 2Gi ; surveillez donc également les événements OOM sur le conteneur du serveur,
   en particulier sous charge de collaboration en temps réel. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'AFFiNE.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible `/` ; un échec de connexion à PostgreSQL (via le sidecar Cloud SQL Auth
  Proxy sur `127.0.0.1:5432`) ou à Redis empêchera le pod de devenir
  Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15)
  est `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms via le
  pilote Secret Store CSI et que le job `db-init` s'est terminé.
- **Schéma / clé de signature absents :** c'est le job `affine-migrate` (et non le conteneur
  du serveur) qui crée le schéma et génère la clé de signature d'AFFiNE dans PostgreSQL.
  S'il a échoué ou est encore en cours de nouvelles tentatives (`max_retries = 3`), le serveur n'atteindra jamais
  un état sain :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<affine-migrate-job-name>
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **La collaboration en temps réel ne se synchronise pas :** Redis est obligatoire, pas facultatif.
  Vérifiez que la VM NFS/Redis partagée est `RUNNING` et que l'environnement du pod affiche
  une valeur non vide pour `REDIS_SERVER_HOST`. Désactiver `enable_nfs` sans fournir de
  `redis_host` externe supprime silencieusement la connectivité Redis en plus de la persistance
  des blobs.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer. `container_image_source` doit valoir `custom` —
  l'image amont ne dispose pas du point d'entrée qui assemble `DATABASE_URL` et les
  variables `REDIS_SERVER_*`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle selon laquelle `application_database_name` et
`application_database_user` sont immuables après le premier déploiement, et le fait que désactiver
NFS sans hôte Redis externe casse silencieusement la collaboration).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, la VM NFS/Redis partagée, le registre) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), le stockage de blobs NFS, un bucket GCS, les secrets, et exécute db-init + affine-migrate |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état réussit ; le premier compte inscrit devient l'administrateur du serveur |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage/les jobs, vérifier la base et Redis |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de Redis, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
