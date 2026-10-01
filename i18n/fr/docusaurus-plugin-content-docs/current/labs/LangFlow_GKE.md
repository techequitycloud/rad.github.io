---
title: "LangFlow sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer LangFlow sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/LangFlow_GKE.md @ 3055034 sha256:fd50dc7db2e1 -->

# LangFlow sur GKE Autopilot — Guide de lab {#langflow-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

LangFlow est un outil visuel open source et low-code de création d'agents et de workflows d'IA,
construit sur LangChain — vous assemblez des chaînes de modèles de langage, des pipelines RAG et des agents en
faisant glisser et en reliant des composants sur un canevas, puis vous les exposez sous forme d'API. Ce lab vous fait
parcourir l'intégralité du cycle de vie opérationnel du module **LangFlow on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit LangFlow. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **LangFlow (GKE)** depuis
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LangFlow_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` et le mot de passe de la base de données),
   un bucket Cloud Storage `data`, construit l'image du conteneur et exécute une tâche ponctuelle
   d'initialisation de la base de données qui crée le rôle applicatif, la base de données et les
   droits. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel), et le premier démarrage du pod exécute également les migrations Alembic propres à LangFlow
   ainsi que le chargement des composants avant qu'il devienne Ready.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep langflow | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. LangFlow expose un point de terminaison de liveness public qui
   renvoie `200` dès que le serveur est entièrement démarré (après le chargement des composants et les migrations
   Alembic) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Récupérez le mot de passe administrateur généré automatiquement depuis Secret Manager, puis ouvrez
   `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous en tant que `admin` (ou avec la valeur que vous avez définie
   pour `langflow_username`) avec ce mot de passe — l'authentification de LangFlow est activée
   par défaut (`LANGFLOW_AUTO_LOGIN = "false"`), il n'y a donc pas d'étape d'inscription ouverte :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~langflow AND name~superuser" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Conservez `max_instance_count = 1` : LangFlow conserve
   en mémoire de processus l'état des sessions et de l'éditeur de flux, si bien qu'exécuter plusieurs réplicas fragmente
   cet état et produit un comportement incohérent. GKE ne descend pas à zéro, donc
   `min_instance_count = 1` est à la fois la valeur par défaut et le minimum. L'affinité de session (`ClientIP`)
   est définie par défaut pour maintenir l'éditeur de flux attaché à un seul pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods. Épinglez `application_version` explicitement plutôt que de le laisser à
   `latest` pour tout usage dépassant le cadre d'un lab.

4. **Gérez les secrets, le stockage et les tâches :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~langflow"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   Ne renouvelez jamais `LANGFLOW_SECRET_KEY` après le premier démarrage — elle chiffre chaque
   identifiant stocké intégré à un flux, et la renouveler les rend définitivement
   indéchiffrables.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~langflow" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. langflowdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^langflow" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (uptime check) (désactivé par défaut) ; activez-le pour un usage en production, puis consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LangFlow.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de liveness et
  de démarrage ciblent `/health` ; au premier démarrage, prévoyez le temps nécessaire au chargement des composants et aux
  migrations Alembic avant que le pod devienne Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que la tâche `db-init`
  s'est terminée. LangFlow se connecte via le **conteneur annexe (sidecar) Cloud SQL Auth Proxy** sur
  `127.0.0.1`, en composant `LANGFLOW_DATABASE_URL` avec `sslmode=disable` (le proxy
  termine le TLS) — ne définissez pas le DSN manuellement.
- **Échec de la tâche `db-init` :** inspectez la tâche et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Connexion impossible / mot de passe administrateur perdu :** récupérez à nouveau `LANGFLOW_SUPERUSER_PASSWORD`
  depuis Secret Manager (tâche 2, étape 3) ; il n'est affiché nulle part ailleurs.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais renouveler `LANGFLOW_SECRET_KEY` après
le premier démarrage, et pourquoi `max_instance_count` doit rester à `1`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, un bucket de stockage `data`, et exécute l'initialisation de la base |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; se connecter avec le mot de passe administrateur généré automatiquement depuis Secret Manager |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (conserver max=1), mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
