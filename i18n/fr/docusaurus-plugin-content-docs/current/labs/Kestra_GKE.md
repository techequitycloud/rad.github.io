---
title: "Kestra sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Kestra sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Kestra_GKE.md @ 3055034 sha256:727d5be33bf5 -->

# Kestra sur GKE Autopilot — Guide de lab {#kestra-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kestra_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Kestra est une plateforme open source d'orchestration de données et de planification
de workflows qui s'appuie sur des définitions de flux déclaratives en YAML et sur un
riche écosystème de plugins pour les pipelines ETL/ELT, les traitements par lots et
l'automatisation d'API. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **Kestra on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants
et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et
non sur les fonctionnalités du produit Kestra. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kestra_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable : la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Kestra (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kestra_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager, un
   bucket de stockage GCS dédié, construit l'image de conteneur et exécute un job
   ponctuel d'initialisation de la base de données. Un premier déploiement prend
   environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel ; le
   démarrage de la JVM de Kestra ajoute du temps au premier lancement pendant
   l'application des migrations de la base de données).

3. Connectez-vous au cluster et repérez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kestra | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:8080/health"   # expect {"status":"UP"}
   ```

   > Kestra utilise une JVM Java dont le premier démarrage est lent. Si le pod n'est pas
   > encore `Running`, il est peut-être encore en train d'effectuer la migration de sa
   > base de données. La sonde de démarrage (startup probe) accorde jusqu'à ~14 minutes —
   > patientez quelques minutes et réessayez.

2. Récupérez le mot de passe administrateur dans Secret Manager et connectez-vous à
   l'interface de Kestra sur `http://${EXTERNAL_IP}:8080` :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~kestra AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Le nom d'utilisateur administrateur est `admin`. La documentation produit de Kestra
   couvre l'interface, l'éditeur de flux et l'écosystème de plugins.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et (s'ils sont activés)
   l'autoscaler horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement — le
   module gère la spécification de la charge de travail ; la mise à l'échelle est donc
   une modification de configuration, et non une modification manuelle via
   `kubectl scale` (une modification manuelle serait annulée lors de l'application
   suivante). Notez que le mode autonome (standalone) de Kestra exige
   `max_instance_count = 1` pour éviter les conflits de verrouillage de la file d'attente.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods, les migrations
   de schéma étant appliquées automatiquement.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~kestra"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. kestrademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^kestra" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et l'état du
   HPA. Le module peut provisionner un **test de disponibilité** (uptime check)
   facultatif ciblant le point de terminaison `/health` ; s'il est activé, examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Kestra à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Démarrage lent / pod non Ready au premier lancement :** Kestra effectue des
  migrations de base de données Flyway au démarrage. La sonde de démarrage accorde
  jusqu'à ~14 minutes. Consultez les journaux pour suivre la progression de la migration
  avant de conclure à une panne.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données a bien été matérialisé
  dans l'espace de noms et que le job `db-init` s'est terminé.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente / pas d'adresse IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quotas, et
  vérifiez que le Service LoadBalancer dispose d'une adresse IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le
cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), le bucket GCS, les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit (`{"status":"UP"}`) ; connexion à l'interface de Kestra |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de démarrage de la JVM, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
