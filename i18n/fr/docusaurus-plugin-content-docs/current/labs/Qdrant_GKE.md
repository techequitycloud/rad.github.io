---
title: "Qdrant sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Qdrant sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Qdrant_GKE.md @ 15fd4c7 sha256:fece63f55bb9 -->

# Qdrant sur GKE Autopilot — Guide de lab {#qdrant-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Qdrant est une base de données vectorielle et un moteur de recherche de similarité
haute performance conçus pour les charges de travail d'IA — pipelines RAG,
systèmes de recommandation, recherche sémantique et stockage d'embeddings. Ce
lab vous guide à travers le cycle de vie opérationnel complet du module
**Qdrant sur GKE Autopilot** sur Google Cloud : déployez-le, accédez-y et
vérifiez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes
courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Qdrant. Pour la liste
complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE) — ce lab ne
duplique délibérément pas ces détails afin qu'ils restent précis dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à
  jour et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont ce module dépend). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et le provisionne avant
  ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login`
  terminés.
- IAM **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes affichées en tant que Propriétaire du projet, puis **Vérifier**) et
  de donner le rôle **Propriétaire** au compte de service de déploiement RAD. Un
  projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Mettre à jour** sur la page du déploiement après avoir
  coché **Activer le mode avancé**, ce qui nécessite un solde de crédits
  couvrant le coût de build estimé de la mise à jour (les mises à jour n'ont
  jamais de frais de module). Dans un environnement de lab, seul un
  administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la
   navigation supérieure de la plateforme RAD, ouvrez **Qdrant (GKE)** depuis la
   liste **Modules de plateforme** pour commencer la configuration, choisissez
   **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce
   déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si
   vous détenez des crédits achetés ou si vous êtes un partenaire ou un
   administrateur), définissez `project_id` et examinez les entrées.
   Configurez uniquement ce dont vous avez besoin — le [Guide de
   configuration](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec les logs en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne le stockage persistant (un PVC StatefulSet par défaut,
   `stateful_pvc_enabled = true` ; la vérification de démarrage de Qdrant rejette
   l'alternative GCS FUSE), construit l'image conteneur et stocke une clé API
   dans Secret Manager lorsque `enable_api_key = true`. Qdrant n'a pas de base de
   données SQL et pas de job d'initialisation. Les premiers déploiements
   prennent généralement **10 à 20 minutes** (la construction de l'image et le
   provisionnement des nœuds dominent).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep qdrant | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution. Qdrant expose
   deux points de terminaison de santé distincts — `/readyz` (signale
   prêt une fois toutes les collections chargées) et `/livez` (répond
   toujours tant que le processus est actif). Redirigez le port du service pour
   les atteindre depuis votre shell :

   ```bash
   kubectl get pods,svc -n "$NS"
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward "svc/$SVC" 6333:6333 -n "$NS" &
   sleep 3
   curl -s http://localhost:6333/readyz    # expect {"result":true,"status":"ok",...}
   curl -s http://localhost:6333/livez     # expect {"result":true,"status":"ok",...}
   ```

   Si le type de service est `LoadBalancer`, utilisez directement l'IP
   externe à la place :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:6333/readyz"
   ```

2. Si `enable_api_key = true`, récupérez la clé API de Secret Manager avant de
   faire des requêtes authentifiées :

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~qdrant AND name~api-key" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT"
   ```

   Passez la valeur récupérée comme en-tête `api-key` sur tous les
   appels REST Qdrant.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — pods, HPA et (si activés) volumes
   persistants :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les entrées d'instances min/max dans la
   plateforme RAD et en l'appliquant via **Mettre à jour** — le module possède
   la spécification de la charge de travail, donc la mise à l'échelle est un
   changement de configuration, pas un `kubectl scale` manuel (une édition
   manuelle serait annulée lors du prochain apply). Gardez `max_instance_count = 1` ;
   Qdrant est un stockage à écrivain unique et plusieurs pods partageant le même
   PVC (RWO) ou bucket GCS corrompent les collections.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version dans l'interface utilisateur RAD et en l'appliquant via **Mettre à
   jour** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~qdrant"
   kubectl get jobs,cronjobs -n "$NS"      # any scheduled snapshot or maintenance jobs
   ```

5. **Inspectez le stockage** — confirmez que le PVC est lié ou que le bucket
   GCS existe :

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls /qdrant/storage
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, les nombres de redémarrages
   et les métriques de requêtes. Le module provisionne également un **test de
   disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Tests de
   disponibilité et Alerting → Stratégies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et
ils ne changent pas avec les versions de Qdrant.

- **Pod non Prêt / CrashLoopBackOff :** inspectez les événements et les logs :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Démarrage lent / `/readyz` renvoie 503 :** Qdrant charge toutes
  les collections du disque en mémoire au démarrage. Les grandes collections
  peuvent prendre des dizaines de secondes à plusieurs minutes. La sonde de
  démarrage attend `/readyz` ; accordez un temps supplémentaire avant
  de déclarer le pod malsain.
- **PVC non lié / erreurs de stockage :** confirmez que le PVC a été
  provisionné avec succès et que le fsGroup est correctement défini pour l'accès
  en écriture :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Erreurs de clé API (401/403) :** confirmez que `enable_api_key = true` a été
  défini au moment du déploiement, que le secret s'est matérialisé dans
  l'espace de noms et que l'en-tête `api-key` est présent sur les
  requêtes.
- **Pod en attente / pas d'IP externe :** vérifiez les événements
  `kubectl describe pod` pour les problèmes de ressources ou de quotas, et
  confirmez que le service LoadBalancer a une IP attribuée.
- **Erreurs de pull d'image :** confirmez que l'image existe dans Artifact
  Registry et que le compte de service du nœud peut la pull.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez **Purger** à la place (depuis la même boîte de dialogue
**Supprimer**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — la charge de travail et
l'espace de noms Kubernetes, le PVC et le disque persistant sous-jacent (si
utilisé), le bucket Cloud Storage (si utilisé), les secrets Secret Manager et
les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le stockage persistant et le secret de clé API facultatif |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; les vérifications de santé passent sur `/readyz` et `/livez` ; clé API récupérée si activée |
| 3 — Opérer | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/stockage/jobs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de stockage, de clé API, de planification et de pull d'image |
| 6 — Supprimer | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
