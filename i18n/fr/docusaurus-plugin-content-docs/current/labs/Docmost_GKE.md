---
title: "Docmost sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Docmost sur GKE Autopilot dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Docmost_GKE.md @ 3055034 sha256:6c9b124fb853 -->

# Docmost sur GKE Autopilot — Guide de lab {#docmost-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Docmost est une plateforme open source de wiki et de documentation collaborative en temps réel —
une alternative auto-hébergée à Confluence/Notion construite sur NestJS. Ce lab vous fait
parcourir l'intégralité du cycle de vie opérationnel du module **Docmost on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Docmost. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Accéder au service en cours d'exécution, le vérifier, et créer le premier espace de travail et le compte administrateur.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Comprendre le rôle de PostgreSQL, Redis et NFS dans une charge de travail d'édition collaborative.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Docmost (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Docmost_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot (port 3000,
   1–3 réplicas via HPA), provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses
   secrets Secret Manager (l'`APP_SECRET` généré automatiquement et le mot de passe de la
   base de données), Redis pour la collaboration en temps réel et les files de jobs (co-hébergé sur la
   VM du serveur NFS par défaut), un volume NFS monté sur `/app/data/storage` pour les
   pièces jointes téléversées, et un bucket de données GCS. Elle construit une image de conteneur personnalisée
   (qui encapsule `docmost/docmost:latest`) via Cloud Build et exécute un Job unique
   d'initialisation de la base de données. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud
   SQL en représente l'essentiel).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep docmost | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,hpa -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est en bonne santé. Le chemin de santé de Docmost est `/api/health`, qui
   renvoie HTTP 200 une fois que l'application a démarré et exécuté ses migrations de schéma (comptez
   jusqu'à ~2 minutes sur un nouveau déploiement — la sonde de démarrage utilise un délai initial de 60 secondes
   plus une fenêtre de nouvelles tentatives) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/health"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Docmost est livré **sans identifiants
   par défaut** — le premier visiteur remplit le formulaire de configuration et crée
   l'espace de travail initial et le compte administrateur. Faites-le rapidement après le déploiement afin
   que personne d'autre ne puisse s'approprier l'espace de travail. Les secrets générés automatiquement peuvent être
   consultés si nécessaire :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   kubectl get secret -n "$NS"
   ```

4. Définissez `APP_URL` sur l'adresse externe dès qu'elle est connue, afin que les liens absolus et
   le WebSocket de collaboration se résolvent correctement (le module injecte par défaut
   l'URL interne/prévue) :

   ```bash
   kubectl set env deploy/$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     -n "$NS" APP_URL="http://${EXTERNAL_IP}"
   ```

5. Vérifiez le câblage de la collaboration : créez une page et ouvrez-la dans deux onglets du navigateur —
   les modifications doivent apparaître en direct dans les deux (la synchronisation en temps réel passe par le point de terminaison
   WebSocket `APP_URL`, coordonné via Redis).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc un
   changement de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). `min_instance_count` vaut `1` par défaut (GKE ne prend pas
   en charge la mise à l'échelle jusqu'à zéro, contrairement à la variante Cloud Run) ; `max_instance_count`
   vaut `3` par défaut. Redis est activé par défaut, de sorte que plusieurs réplicas restent
   coordonnés pour l'édition en temps réel et les files d'arrière-plan. L'affinité de session
   (`ClientIP`) est définie par défaut pour maintenir le WebSocket de collaboration d'un client sur
   un même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et un déploiement
   progressif remplace les pods. Comme les pièces jointes résident sur le volume NFS
   partagé, le Deployment utilise la stratégie `Recreate` (et non la mise à jour progressive) pour
   éviter que deux pods écrivent le même état NFS/base de données pendant la transition. Docmost
   exécute automatiquement ses migrations de schéma au démarrage — il n'y a pas d'étape de
   migration distincte.

4. **Gérez les secrets, le stockage et les jobs.** Considérez `APP_SECRET` comme immuable —
   le faire tourner après le premier démarrage déconnecte tout le monde et rend irrécupérables les données chiffrées avec
   l'ancienne valeur :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   kubectl get pvc -n "$NS"
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. docmostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^docmost" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^docmost" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes ; les métriques Cloud SQL
   se trouvent sur la page SQL. Le module peut provisionner un **test de disponibilité** (uptime check) (lorsque
   le point de terminaison est accessible publiquement) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Docmost.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent `/api/health` ; un échec de connexion à PostgreSQL (via
  le sidecar Cloud SQL Auth Proxy sur `127.0.0.1`) empêchera le pod de
  devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15)
  est `RUNNABLE`, que le secret du mot de passe de la base de données a été matérialisé dans l'espace de noms et que le
  job `db-init` s'est terminé. Notez que le pod se connecte via le sidecar Auth Proxy
  en loopback non chiffré (`sslmode=disable`) — ce qui diffère de la variante Cloud Run,
  qui se connecte en TCP sur IP privée avec SSL.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Édition en temps réel cassée / les modifications ne se synchronisent pas :** vérifiez que Redis est joignable
  (`enable_redis = true` ; avec `redis_host` vide, la VM du serveur NFS co-héberge
  Redis — elle doit être `RUNNING`), et vérifiez que `APP_URL` dans le pod en cours d'exécution
  correspond à l'URL que les utilisateurs consultent réellement (une différence casse le WebSocket de
  collaboration et les liens absolus) :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'APP_URL|REDIS_URL'
  ```
- **Les pièces jointes disparaissent après un redémarrage :** vérifiez `enable_nfs = true` (la
  valeur par défaut) et que le volume NFS est monté sur `/app/data/storage` ; sans NFS,
  les téléversements atterrissent sur le disque éphémère du pod et sont perdus au redémarrage / non partagés
  entre les réplicas.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour
  détecter des problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une
  IP.
- **Erreurs de récupération d'image :** vérifiez que l'image construite sur mesure existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer. L'image est construite avec l'ARG de build
  `DOCMOST_VERSION` (ainsi, `application_version = "latest"` correspond à une
  version épinglée) ; les images reconstruites sont déployées avec `imagePullPolicy=Always` afin que les nœuds
  ne servent pas une couche obsolète en cache.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner `APP_SECRET` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager (y compris `APP_SECRET`),
les buckets GCS, le volume de pièces jointes sur NFS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), Redis, NFS, un bucket GCS, des secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; `/api/health` répond ; création du premier espace de travail et du compte administrateur ; vérification de l'édition en temps réel |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (coordination par Redis), mettre à jour la version (stratégie Recreate), gérer les secrets/le stockage, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de Redis/collaboration, de NFS, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
