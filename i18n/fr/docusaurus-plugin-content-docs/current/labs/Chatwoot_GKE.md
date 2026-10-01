---
title: "Chatwoot sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Chatwoot sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Chatwoot_GKE.md @ 3055034 sha256:37862c26cb43 -->

# Chatwoot sur GKE Autopilot — Guide de lab {#chatwoot-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Chatwoot est une plateforme open source et multicanal de support client et d'engagement
client (boîtes de réception e-mail, chat en direct, réseaux sociaux et messageries, suivi des SLA et
rapports) — une alternative conforme au RGPD à Zendesk ou Intercom. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Chatwoot on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Chatwoot. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail (et son worker Sidekiq colocalisé) avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  NFS/Redis, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Chatwoot (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur Chatwoot personnalisée (`chatwoot/chatwoot`
   enveloppée dans un point d'entrée cloud), déploie la charge de travail dans le cluster GKE
   Autopilot derrière un LoadBalancer externe, provisionne une base de données Cloud SQL
   (PostgreSQL 15, avec `pgvector`) avec ses secrets Secret Manager
   (`SECRET_KEY_BASE` et le mot de passe de la base), un bucket Cloud Storage, un
   montage NFS Filestore pour les pièces jointes, et Redis. Elle exécute ensuite deux
   jobs d'initialisation **chaînés** — `db-init` (crée la base de données, le rôle
   et les droits, y compris `cloudsqlsuperuser`) suivi de `chatwoot-prepare`
   (`rails db:chatwoot_prepare`, qui utilise l'image applicative construite, pour créer le
   schéma). Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   et le build de l'image personnalisée représentent l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chatwoot | head -1 | cut -d/ -f2)
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
   ```

2. Vérifiez que les deux jobs d'initialisation chaînés se sont terminés avec succès avant
   de considérer que le schéma est prêt :

   ```bash
   kubectl get jobs -n "$NS"
   kubectl logs -n "$NS" job/<db-init-job-name>
   kubectl logs -n "$NS" job/<chatwoot-prepare-job-name>
   ```

3. Vérifiez que le service est sain. La page de connexion/d'accueil de Chatwoot répond
   avec HTTP 200 et ne requiert aucune authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, l'interface
   d'accueil de Chatwoot vous invite à créer le compte administrateur initial
   de manière interactive — aucun identifiant administrateur pré-provisionné n'existe dans Secret Manager.
   Renseignez votre nom, votre e-mail et un mot de passe pour terminer l'accueil.
   `ENABLE_ACCOUNT_SIGNUP` vaut `"false"` par défaut, si bien qu'ensuite seuls les utilisateurs
   invités peuvent rejoindre la plateforme ; basculez-le temporairement via `environment_variables` si vous
   avez besoin d'une inscription publique en libre-service.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et le disruption budget :

   ```bash
   kubectl get deploy,pods,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle
   est une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Le worker Sidekiq de Chatwoot (exécution des jobs
   en arrière-plan, notifications, rapports) et ActionCable (mises à jour de l'interface en temps réel)
   s'exécutent dans le même pod, donc **conservez `min_instance_count >= 1`** — la
   charge de travail ne doit pas être réduite à zéro en production. L'affinité de session
   (`ClientIP`) est définie par défaut pour maintenir les requêtes d'un client sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (le tag de l'image `chatwoot/chatwoot`) dans la plateforme RAD et en l'appliquant
   via **Update** ; une nouvelle image est construite et les pods sont recréés (il ne s'agit pas d'une
   mise à jour progressive — `enable_nfs = true` par défaut, et `App_GKE` déploie
   les applications adossées au NFS avec la stratégie `Recreate`, afin que deux pods ne se disputent jamais
   le même volume NFS de pièces jointes et la base de données partagée pendant une mise à jour).
   Prévoyez une brève interruption pendant que l'ancien pod s'arrête et que le nouveau démarre.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chatwoot"
   kubectl get jobs -n "$NS"          # db-init + chatwoot-prepare
   kubectl get pvc -n "$NS"
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. chatwootdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^chatwoot" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez la persistance des pièces jointes** — les fichiers téléversés résident sur le NFS Filestore dans
   `/opt/chatwoot/storage`, et non dans le bucket GCS provisionné automatiquement dont le nom se termine
   par `storage` :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Le processus web Rails
   et le worker Sidekiq colocalisé écrivent tous deux sur les mêmes stdout/stderr du pod :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Chatwoot.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde
  de vivacité cible `GET /` ; elle accorde un délai initial de 60 secondes et jusqu'à 30
  nouvelles tentatives à une période de 15 secondes, dimensionnée pour absorber la fin de `chatwoot-prepare`
  avant le conteneur de l'application.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Échec d'un job d'initialisation :** `chatwoot-prepare` exige que `db-init`
  se termine d'abord ; si la préparation du schéma échoue avec `must be superuser` sur `CREATE
  EXTENSION`, le droit `cloudsqlsuperuser` dans `db-init` n'a pas été appliqué. Examinez
  le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que les
  jobs d'initialisation se sont terminés. Sur GKE, les pods atteignent Postgres via un sidecar
  `cloud-sql-proxy` sur `127.0.0.1:5432` — un mécanisme différent du socket Unix de la variante
  CloudRun.
- **Les jobs en arrière-plan/notifications ne sont pas délivrés alors que l'interface se charge correctement :**
  Sidekiq ne s'exécute que tant que le pod est actif. Vérifiez que `min_instance_count >= 1`
  — réduire la charge de travail à zéro arrête complètement le traitement en arrière-plan.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu
  attribuer une IP (`reserve_static_ip = true` la maintient stable entre les redéploiements).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer. Un tag `application_version` inexistant
  (par exemple une valeur par défaut héritée d'une autre application) fait échouer le build avec
  `MANIFEST_UNKNOWN` — vérifiez que le tag existe sur Docker Hub pour
  `chatwoot/chatwoot`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment les règles essentielles : ne jamais renouveler
`SECRET_KEY_BASE` après le premier démarrage, et ne jamais désactiver `enable_redis`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, les pièces jointes
hébergées sur le NFS et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE, le Cloud SQL partagé, NFS/Redis, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image Chatwoot personnalisée, déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15 + pgvector), les secrets, le stockage, le NFS et Redis, puis exécute les jobs chaînés `db-init` → `chatwoot-prepare` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; les jobs d'initialisation ont réussi ; le contrôle d'état (`GET /`) réussit ; créer le compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (conserver `min >= 1`), mettre à jour la version, gérer les secrets/le stockage, accéder à la base, vérifier la persistance des pièces jointes |
| 4 — Observer | Manuel | Interroger Cloud Logging (web + Sidekiq) ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de job d'initialisation, de base de données, de traitement en arrière-plan, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
