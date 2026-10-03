---
title: "Chroma sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployez Chroma sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Chroma_GKE.md @ 15fd4c7 sha256:1dccb546d04d -->

# Chroma sur GKE Autopilot — Guide de Lab {#chroma-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Chroma est une base de données vectorielle open source native de l'IA, conçue
spécifiquement pour les embeddings et la recherche de similarité. Elle alimente les
pipelines RAG, la recherche sémantique et les workflows LangChain/LlamaIndex. Ce lab
vous guide à travers le cycle de vie opérationnel complet du module **Chroma sur GKE
Autopilot** sur Google Cloud : déployez-le, accédez-y et vérifiez-le, exécutez-le au
quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Chroma. Pour la liste complète des
services provisionnés et de chaque entrée de configuration (organisée par groupe),
consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE)
— ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil
du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution.
- Effectuer des opérations de jour 2 — inspecter, mettre à l'échelle, mettre à jour
  et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry et
  les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de
  le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce n'est
  pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login`
  terminés.
- IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de
  dialogue de confirmation de déploiement vous demande de prouver que vous le
  contrôlez (**Obtenir le code de vérification**, exécutez les commandes affichées
  en tant que propriétaire du projet, puis **Vérifier**) et de donner le rôle
  **Owner** au compte de service de déploiement RAD. Un projet créé par RAD pour
  vous n'a besoin d'aucun des deux.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne
  demande que la première page d'entrées (et, dans un projet créé par RAD pour
  vous, guère plus que le nom du locataire et la région). Toutes les autres
  entrées du Guide de configuration — y compris les entrées de mise à l'échelle et
  de version dans les tâches de jour 2 — sont modifiées par la suite avec
  **Update** sur la page du déploiement après avoir coché **Enable advanced mode**,
  ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise
  à jour (les mises à jour n'entraînent jamais de frais de module). Dans un
  environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le
  projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation
   supérieure de la plateforme RAD, ouvrez **Chroma (GKE)** depuis la liste
   **Platform Modules** pour commencer la configuration, choisissez
   **Configuration Form** sous *How would you like to configure this deployment?*
   (le formulaire s'ouvre sur l'**Assistant Conversationnel** si vous détenez des
   crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id`, et examinez les entrées. Configurez uniquement ce dont vous avez
   besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chroma_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Deploy Module**, examinez le coût estimé dans la boîte de dialogue
   **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la
   boîte de dialogue ajoute ensuite une étape de confirmation, comme la
   vérification d'un projet que vous apportez, complétez-la et cliquez sur
   **Confirm**), ce qui ouvre la page d'état du déploiement avec les logs en temps
   réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne un PersistentVolumeClaim (la valeur par défaut, `stateful_pvc_enabled = true`) — ou
   un bucket Cloud Storage adossé à GCS FUSE si vous le définissez à
   `false` — comme backend de persistance de Chroma, construit l'image
   conteneur, et crée éventuellement un jeton d'authentification Secret Manager.
   `reserve_static_ip` et `enable_custom_domain` sont tous deux par défaut à `true`,
   donc une IP statique est réservée même si vous ne définissez jamais
   `application_domains`. Chroma ne nécessite pas de base de données ni de job
   d'initialisation — un grand groupe d'entrées de base de données/Redis sont
   déclarées uniquement pour la parité de convention et n'ont aucun effet (voir le
   Guide de configuration). Les premiers déploiements prennent environ **10 à 20
   minutes** (la construction de l'image domine).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chroma | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et localisez le
   service :

   ```bash
   kubectl get pods,svc -n "$NS"
   ```

   Le service est par défaut à `ClusterIP` (accès interne au cluster
   uniquement). Si `service_type = "LoadBalancer"` a été défini, récupérez l'IP externe :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez le heartbeat depuis le cluster (ou via l'IP du LoadBalancer s'il est
   exposé en externe). Chroma expose un seul endpoint de santé sur le port 8000 :

   ```bash
   # From outside the cluster via LoadBalancer
   curl -s "http://${EXTERNAL_IP}:8000/api/v2/heartbeat"   # expect {"nanosecond heartbeat": <timestamp>}

   # From inside the cluster via port-forward
   kubectl port-forward svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     8000:8000 -n "$NS" &
   curl -s "http://localhost:8000/api/v2/heartbeat"
   ```

3. Si `enable_auth_token = true` a été défini au moment du déploiement, récupérez le
   jeton d'authentification de Secret Manager avant d'effectuer d'autres appels
   API :

   ```bash
   AUTH_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~chroma AND name~auth-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$AUTH_SECRET" --project="$PROJECT"
   ```

   Passez le jeton comme `Authorization: Bearer <token>` sur chaque requête API.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — pods, HPA et (lorsqu'il est adossé à un PVC)
   les volumes persistants :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS" 2>/dev/null || kubectl describe statefulset -n "$NS"
   ```

2. **Mettre à l'échelle** en modifiant les entrées min/max d'instances et en cliquant
   sur **Update** sur la page des détails du déploiement — le module possède la
   spécification de la charge de travail, donc la mise à l'échelle est un
   changement de configuration, pas un `kubectl scale` manuel (une édition manuelle
   serait annulée lors du prochain apply). Gardez `max_instance_count = 1` : plusieurs pods
   Chroma partageant le même PVC ou chemin GCS n'ont pas de verrou d'écriture
   distribué et corrompront les collections.

3. **Mettre à jour la version de l'application** en modifiant l'entrée de version via
   **Update** sur la page des détails du déploiement ; une nouvelle image est
   construite et une mise à jour progressive remplace les pods.

4. **Gérer les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chroma"
   kubectl get pvc -n "$NS"          # PVC status when stateful_pvc_enabled = true
   ```

5. **Lister les jobs planifiés :**

   ```bash
   kubectl get jobs,cronjobs -n "$NS"
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   kubectl logs -n "$NS" "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et le
   comportement du HPA. Le module provisionne également un **test de
   disponibilité** (lorsqu'il est activé) ciblant `/api/v2/heartbeat` ; examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme qui
ne changent pas avec les versions de Chroma.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les logs. Chroma
  charge les index HNSW depuis son backend de stockage au démarrage — laissez le
  temps à la sonde `/api/v2/heartbeat` de passer.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC non lié :** confirmez que `stateful_pvc_enabled = true` est défini et que la classe de
  stockage existe dans le cluster (`kubectl get storageclass`).
- **Erreurs de montage GCS FUSE (lorsque le PVC n'est pas utilisé) :** vérifiez que
  le bucket GCS existe et que le compte de service de la charge de travail a
  `storage.objectAdmin` sur le bucket.
- **Erreurs de jeton d'authentification (401) :** confirmez que `enable_auth_token = true` a
  été défini, que le secret existe et que l'en-tête `Authorization: Bearer <token>` est inclus
  dans chaque requête.
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod`
  pour les problèmes de ressources ou de quota, et confirmez que le service
  LoadBalancer a une IP attribuée.
- **Erreurs de pull d'image :** confirmez que l'image existe dans Artifact Registry
  et que le compte de service du nœud peut la pull.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible
(l'enregistrement du déploiement est conservé pour l'historique). Si un
déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez **Purge** à la place (depuis la même boîte de dialogue
**Delete**) — cela supprime le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela
supprime tout ce que le module a créé — la charge de travail et l'espace de noms
Kubernetes, le PVC et toutes les collections stockées, le bucket de données GCS,
les secrets Secret Manager et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le bucket de données PVC ou GCS, et le jeton d'authentification optionnel |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle du heartbeat passe ; le jeton d'authentification est récupéré si activé |
| 3 — Opérer | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de pod, de montage PVC/GCS, de jeton d'authentification, de planification et de pull d'image |
| 6 — Suppression | Automatisé | La suppression (Trash) supprime toutes les ressources du module |
