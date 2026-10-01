---
title: "Dify sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Dify sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Dify_GKE.md @ 3055034 sha256:5f6d52cbe18d -->

# Dify sur GKE Autopilot — Guide de lab {#dify-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

Dify est une plateforme open source de développement d’applications LLM permettant de construire
des applications d’IA de niveau production, avec un concepteur visuel de workflows, un pipeline RAG,
un framework d’agents et une gestion multi-modèles. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Dify on GKE Autopilot** sur Google Cloud :
le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes
courants et le démanteler.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Dify. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder aux charges de travail en cours d’exécution, y compris le frontend web.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry, le NFS Filestore et les comptes de service partagés dont dépend ce module).
  Vous n’avez pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s’il existe déjà dans le projet cible et, sinon, le provisionne
  avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu’elle affiche en tant qu’Owner du projet, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n’exige ni l’un ni l’autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Dify (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Dify_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute alors une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie deux charges de travail dans le cluster GKE Autopilot (le pod API+Celery
   et le frontend web Next.js), provisionne une base de données Cloud SQL (PostgreSQL 15 avec
   pgvector) avec ses secrets Secret Manager, un bucket de stockage GCS dédié
   et Redis via le serveur NFS, construit l’image de conteneur et exécute un job ponctuel
   d’initialisation de la base de données. Les premiers déploiements prennent environ **25–40 minutes** (la création de Cloud SQL
   en représente l’essentiel).

3. Connectez-vous au cluster et découvrez l’espace de noms à l’aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dify | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que les charges de travail s’exécutent et trouvez l’adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' \
     | awk '{print $1}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}/health"   # expect {"status":"ok"}
   ```

2. Dify ne stocke pas de mot de passe administrateur pré-généré dans Secret Manager. Lors de la première
   visite, l’application affiche un **assistant de configuration** (setup wizard) dans lequel vous créez le compte administrateur.
   Le frontend web est un Service LoadBalancer distinct, `<service>-web`, doté de sa propre
   IP externe. Ouvrez-le dans un navigateur et terminez la configuration :

   ```bash
   WEB_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.metadata.labels.component=="web")].status.loadBalancer.ingress[0].ip}')
   echo "http://${WEB_IP}"
   ```

   Saisissez votre adresse e-mail d’administrateur et un mot de passe lorsque vous y êtes invité. Une fois la configuration terminée, la console
   Dify s’ouvre. La documentation produit de Dify couvre le concepteur de workflows, le pipeline
   RAG et la configuration des fournisseurs de LLM.

3. Vérifiez que les deux Deployments sont présents et que la `SECRET_KEY` est stockée dans Secret Manager :

   ```bash
   kubectl get deployments -n "$NS"

   gcloud secrets list --project="$PROJECT" --filter="name~dify AND name~secret-key"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiements, pods et (si activés) l’autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur la page de détails du déploiement —
   c’est le module qui gère la spécification de la charge de travail ; la mise à l’échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply). Maintenez
   `min_instance_count` à 1 ou plus afin que le worker Celery intégré conserve sa
   connexion au broker Redis.

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une mise à jour progressive remplace les pods des deux
   Deployments.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~dify"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dify"
   kubectl get jobs -n "$NS"          # DB-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --filter="name~dify" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. difydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^dify" --limit=1)
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

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur et de la mémoire
   des pods, le nombre de redémarrages et les événements de mise à l’échelle du HPA. Le module provisionne un
   **test de disponibilité** (uptime check) facultatif ciblant `/health` ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Dify à l’autre.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Le conteneur d’API exécute
  les migrations de base de données au démarrage ; laissez donc s’écouler le délai configuré de la sonde de démarrage avant
  de vous attendre à ce que le pod soit prêt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`, que le secret du
  mot de passe de la base de données a été matérialisé dans l’espace de noms et que le job db-init s’est terminé.
  Sans le sidecar Cloud SQL Auth Proxy (`enable_cloudsql_volume = true`), le pod
  ne peut pas du tout atteindre la base de données.
- **Tâches Celery non exécutées / échecs asynchrones :** Redis est requis pour tout le traitement
  en arrière-plan. Vérifiez que NFS est activé et que le volume NFS est correctement monté dans le
  pod (`kubectl describe pod` affiche les événements de montage).
- **Échec du job d’initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente (Pending) / pas d’IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer a une IP attribuée.
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.
- **La page se charge, mais chaque appel du navigateur échoue avec `net::ERR_NAME_NOT_RESOLVED` :** ce problème est
  invisible pour les contrôles d’état `kubectl` — le pod est `Ready`, le Service a une IP externe
  et le frontend s’affiche normalement, mais chaque appel à l’API depuis le navigateur (ouvrez les DevTools →
  Network/Console) échoue à résoudre un nom d’hôte. Cause : les `CONSOLE_API_URL`/
  `APP_API_URL` du frontend web sont résolus via la sentinelle `$(GKE_SERVICE_URL)`, qui se rabat sur le
  nom DNS interne `*.svc.cluster.local`, injoignable, lorsque `reserve_static_ip = false` ou que
  `service_type` a été modifié pour ne plus valoir `LoadBalancer`. Correctif : vérifiez
  `reserve_static_ip = true` et `service_type = LoadBalancer` dans `deploy.tfvars`, puis
  redéployez afin que le frontend soit construit avec la véritable IP externe.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — les charges de travail et
l’espace de noms Kubernetes, la base de données Cloud SQL, le bucket de stockage GCS, les secrets Secret Manager et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le NFS
Filestore, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie deux charges de travail GKE, Cloud SQL (PostgreSQL + pgvector), les secrets et le bucket GCS, puis exécute l’initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle d’état réussit ; terminer l’assistant de configuration administrateur |
| 3 — Exploiter | Manuel | Inspecter les charges de travail, mettre à l’échelle, mettre à jour la version, gérer les secrets/le stockage/les jobs, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de Celery/Redis, de job d’initialisation, de planification et de récupération d’image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
