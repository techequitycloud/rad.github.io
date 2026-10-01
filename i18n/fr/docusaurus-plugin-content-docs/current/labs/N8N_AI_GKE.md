---
title: "N8N_AI sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer N8N_AI sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/N8N_AI_GKE.md @ 3055034 sha256:c39654450ebe -->

# N8N_AI sur GKE Autopilot — Guide de lab {#n8n_ai-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

n8n AI est une plateforme open source d'automatisation de workflows enrichie de capacités d'IA intégrées.
En plus de la charge de travail n8n principale, elle déploie deux Deployments Kubernetes compagnons — **Qdrant** (une
base de données vectorielle pour les embeddings et la recherche sémantique) et **Ollama** (un serveur d'inférence
LLM local) — qui s'exécutent tous dans le même espace de noms avec des services ClusterIP uniquement, ce qui permet d'exécuter des
workflows d'agents IA, des pipelines RAG et des chatbots intelligents sur votre propre infrastructure, sans dépendance à une
API d'IA externe. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **N8N_AI
on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités
du produit n8n. Pour la liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder aux charges de travail n8n, Qdrant et Ollama en cours d'exécution.
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

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **N8N AI (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Ne configurez
   que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie n8n, Qdrant et Ollama sous forme de Deployments Kubernetes dans le cluster GKE
   Autopilot, provisionne une base de données Cloud SQL (PostgreSQL) avec ses secrets Secret Manager,
   un NFS Filestore, un bucket GCS pour la persistance des données d'IA, et exécute un job ponctuel
   d'initialisation de la base de données. Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep n8nai | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que toutes les charges de travail s'exécutent et trouvez l'adresse externe :

   ```bash
   kubectl get pods,svc,deploy -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que n8n est en bonne santé (la sonde de démarrage cible `GET /` sur le port 5678) :

   ```bash
   curl -s "http://${EXTERNAL_IP}:5678/"
   ```

   Une redirection ou la page de connexion de n8n indique un service en bonne santé.

3. Vérifiez que les services Qdrant et Ollama internes au cluster sont prêts :

   ```bash
   # Qdrant should have a ClusterIP on port 6333; Ollama on port 11434
   kubectl get svc -n "$NS" | grep -E "qdrant|ollama"
   kubectl get pods -n "$NS" | grep -E "qdrant|ollama"
   ```

4. Ouvrez `http://${EXTERNAL_IP}:5678` dans un navigateur. Au premier lancement, n8n vous invite à
   créer un compte propriétaire. La clé de chiffrement de n8n est générée automatiquement et stockée dans Secret
   Manager — sauvegardez-la avant de détruire le module, car tous les identifiants enregistrés sont
   chiffrés avec elle.

   ```bash
   ENC_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~n8nai AND name~encryption" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ENC_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — les déploiements Kubernetes, les pods, le HPA (n8n) et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

   Qdrant et Ollama s'exécutent comme des Deployments fixes à réplica unique aux côtés de n8n, qui est
   régi par le HPA.

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page de détails du déploiement — le
   module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~n8nai"
   kubectl get jobs,cronjobs -n "$NS"   # db-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. n8naidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^n8nai" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^n8nai" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   # n8n workload logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -l app=n8nai -o jsonpath='{.items[0].metadata.name}')" --tail=50

   # Qdrant logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" | grep qdrant | awk '{print $1}')" --tail=30

   # Ollama logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" | grep ollama | awk '{print $1}')" --tail=30
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les événements de mise à l'échelle HPA de n8n. Le module provisionne un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de n8n.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux des trois charges de travail :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret
  du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le job `db-init` s'est terminé.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Qdrant ou Ollama injoignable depuis n8n :** vérifiez que les pods compagnons sont en état Running et
  que `QDRANT_URL` / `OLLAMA_HOST` sont injectées dans les pods n8n.
  ```bash
  kubectl describe pod -n "$NS" -l app=n8nai | grep -E "QDRANT_URL|OLLAMA_HOST"
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou
  de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre,
notamment les remarques essentielles sur `N8N_ENCRYPTION_KEY` et `enable_redis`.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — les charges de travail Kubernetes et
l'espace de noms (n8n, Qdrant, Ollama), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS,
le NFS Filestore et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie les charges de travail GKE n8n, Qdrant et Ollama, Cloud SQL, les secrets, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; tous les pods s'exécutent ; compte n8n créé ; clé de chiffrement sauvegardée |
| 3 — Exploiter | Manuel | Inspecter les charges de travail, le HPA, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de compagnons IA, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
