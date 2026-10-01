---
title: "Ghost sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Ghost sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Ghost_GKE.md @ 3055034 sha256:b61cf6721124 -->

# Ghost sur GKE Autopilot — Guide de lab {#ghost-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Ghost est une plateforme de publication open source moderne pour les blogs, les newsletters et les sites d’adhésion. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Ghost sur GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Ghost. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d’exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Ghost (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager, un partage NFS Filestore
   pour le contenu partagé, un bucket GCS dédié `ghost-content`, construit l’image de
   conteneur et exécute un job ponctuel d’initialisation de la base de données. Un premier déploiement
   prend environ **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Connectez-vous au cluster et repérez l’espace de noms à l’aide de filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep ghost | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s’exécute et trouvez son adresse externe. L’affinité de session est
   définie sur `ClientIP` afin que les sessions d’administration et d’adhésion restent attachées à un même pod :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Le chemin de santé de Ghost est `/`, qui renvoie HTTP 200 une fois que Ghost a terminé d’exécuter
   les migrations de base de données et de compiler les thèmes au premier démarrage (comptez jusqu’à 90 secondes sur
   un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Ouvrez `http://${EXTERNAL_IP}/ghost` dans un navigateur pour accéder au panneau d’administration de Ghost. Au
   premier démarrage, Ghost présente un assistant de configuration interactif — saisissez le titre de votre site,
   le nom de l’administrateur, l’adresse e-mail et le mot de passe pour terminer la configuration. Le mot de passe de la base de données (le seul
   identifiant stocké dans Secret Manager) peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~ghost" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment, pods et (s’ils sont activés) l’autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mise à l’échelle** — il s’agit normalement d’une modification de configuration (le module possède la spécification de la charge de travail ; un
   `kubectl scale` manuel serait donc annulé lors du prochain apply), via les paramètres de nombre minimal/maximal d’instances et
   **Update** sur la page de détails du déploiement. **Bogue connu :** `Ghost_GKE/main.tf` impose actuellement en dur
   `min_instance_count = 1` et `max_instance_count = 5` dans la variable locale `ghost_module`,
   remplaçant silencieusement les valeurs de `min_instance_count`/`max_instance_count` que vous définissez (même schéma que
   `Ghost_CloudRun`, mais sans commentaire `TODO`) — modifier ces paramètres et cliquer sur Update
   n’a actuellement **aucun effet** sur les limites de mise à l’échelle de la charge de travail déployée tant que ce remplacement
   en dur n’a pas été retiré du code source du module. Le comportement semble correct avec les valeurs par défaut du module
   (`1`/`5`), puisque les nombres imposés en dur coïncident avec ces valeurs par défaut.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~ghost"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~ghost"
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ghostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ghost" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Le module provisionne aussi un
   **test de disponibilité** (uptime check) (lorsqu’il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Ghost à l’autre.

- **Pod non Ready / CrashLoopBackOff :** la sonde de démarrage de Ghost a un délai initial de 90 secondes
  pour laisser le temps aux migrations de base de données et à la compilation des thèmes au premier démarrage. Inspectez
  les événements et les journaux avant de conclure que le pod a échoué :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL (MySQL 8.0) est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l’espace de noms, et que le
  job `db-init` s’est terminé avec succès.
- **Le job d’initialisation a échoué :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Montage NFS / contenu non partagé entre les pods :** vérifiez que `enable_nfs = true`, que
  l’instance Filestore est `READY` et que le tag réseau `nfsserver` est présent sur les
  nœuds.
- **Pod en attente (Pending) / pas d’adresse IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d’une adresse IP attribuée.
- **Erreurs de récupération d’image (image pull) :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer. `container_image_source` doit valoir `custom` — l’image
  Ghost en amont ne comporte pas le point d’entrée qui fait correspondre les identifiants de base de données.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris le bucket
`ghost-content`), le partage NFS Filestore et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), NFS, un bucket GCS, des secrets, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; terminer l’assistant de configuration de l’administration Ghost |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l’échelle, mettre à jour la version, gérer secrets/stockage/jobs, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d’initialisation, de NFS, de planification et de récupération d’image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
