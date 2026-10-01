---
title: "Elasticsearch sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Elasticsearch sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Elasticsearch_GKE.md @ 3055034 sha256:82027eb246a7 -->

# Elasticsearch sur GKE Autopilot — Guide de lab {#elasticsearch-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Elasticsearch est un moteur de recherche et d'analyse distribué open source, couramment utilisé pour
la recherche plein texte, la recherche vectorielle (k-NN), l'analyse de journaux et l'observabilité en temps réel. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Elasticsearch sur GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités du produit Elasticsearch. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer le StatefulSet et le PVC.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Elasticsearch (GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme copie l'image officielle d'Elasticsearch dans Artifact Registry, déploie un
   StatefulSet dans le cluster GKE Autopilot, provisionne un PersistentVolumeClaim (SSD) pour
   un stockage durable des index, et expose l'API HTTP via un Service LoadBalancer sur le port
   9200. Il n'y a ni base de données Cloud SQL ni job d'initialisation — Elasticsearch
   s'initialise lui-même au premier démarrage. Les premiers déploiements prennent généralement **10–20 minutes** (GKE
   Autopilot doit provisionner un nœud et attacher le PVC avant que le conteneur ne démarre).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep elasticsearch | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod du StatefulSet et le PVC sont en bonne santé, et récupérez l'IP externe :

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "Elasticsearch endpoint: http://${EXTERNAL_IP}:9200"
   ```

2. Vérifiez que le cluster est démarré et en bonne santé via l'API REST d'Elasticsearch (port 9200) :

   ```bash
   curl -s "http://${EXTERNAL_IP}:9200/_cluster/health?pretty"
   ```

   Une réponse `"status": "green"` ou `"status": "yellow"` confirme qu'Elasticsearch est
   en cours d'exécution. L'état jaune est normal pour un cluster à nœud unique dont les index ont des réplicas
   configurés (les réplicas ne peuvent pas être attribués sur un seul nœud).

3. Notez la sortie `elasticsearch_endpoint` dans l'onglet **Outputs** du déploiement —
   cette URL est la valeur à transmettre à la variable `elasticsearch_hosts` lors du déploiement de
   RAGFlow ou d'une autre application qui utilise ce cluster.

4. Si `enable_xpack_security = true`, le module génère automatiquement un mot de passe aléatoire pour
   le superutilisateur `elastic` et le stocke dans Secret Manager — aucune configuration manuelle n'est nécessaire.
   Récupérez le nom d'utilisateur et le mot de passe dans l'onglet **Outputs** du déploiement
   (`elasticsearch_username`, toujours `"elastic"`, et `elasticsearch_password_secret_id`),
   puis lisez la valeur du secret :

   ```bash
   gcloud secrets versions access latest \
     --secret="<elasticsearch_password_secret_id>" --project="$PROJECT"

   curl -s -u "elastic:<password>" "http://${EXTERNAL_IP}:9200/_cluster/health?pretty"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods, autoscaler horizontal (s'il est activé)
   et volume persistant :

   ```bash
   kubectl get statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification de la charge de travail : la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply). Notez
   qu'Elasticsearch est déployé en mode nœud unique ; consultez le Guide de configuration avant
   d'augmenter le nombre de réplicas.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; l'image est à nouveau copiée depuis le registre Elastic et une mise à jour progressive
   remplace le pod. Consultez le guide de migration d'Elasticsearch pour d'éventuelles étapes de compatibilité des index
   avant une mise à niveau de version majeure.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~elasticsearch"
   kubectl get jobs -n "$NS"     # any optional initialization jobs
   ```

5. **Inspectez le volume persistant** — toutes les données indexées résident dans ce PVC :

   ```bash
   kubectl describe pvc -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- df -h /usr/share/elasticsearch/data
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et l'utilisation du disque du PVC. Le module provisionne également un
   **test de disponibilité** (uptime check) lorsqu'il est activé ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Elasticsearch à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC non Bound / pod bloqué en Pending :** vérifiez que la StorageClass existe et qu'Autopilot
  a provisionné un nœud disposant de suffisamment de CPU et de mémoire pour les demandes de ressources du pod.
  ```bash
  kubectl describe pvc -n "$NS"
  kubectl get events -n "$NS" --sort-by='.lastTimestamp'
  ```
- **Échecs de la sonde de démarrage :** Elasticsearch a besoin d'un temps généreux sur un nœud à froid (initialisation de la JVM
  + récupération des shards). La sonde de démarrage autorise jusqu'à 60 tentatives. Si elle expire malgré tout,
  vérifiez que `es_java_heap` ne dépasse pas la moitié de `memory_limit` — un heap surdimensionné provoque
  des arrêts OOM avant que la sonde ne puisse réussir.
- **`/_cluster/health` renvoie 401 :** la sécurité X-Pack est activée (`enable_xpack_security =
  true`) et la requête ne contient pas d'identifiants — c'est attendu, et non un problème de sonde. Les
  sondes de santé/vivacité/démarrage du module sont toujours de type `TCP` (une vérification que le port 9200 est ouvert), et non
  des requêtes HTTP vers `/_cluster/health` ; la configuration des sondes n'a donc jamais besoin d'être modifiée ici,
  quel que soit l'état de X-Pack. Authentifiez plutôt la requête : récupérez le mot de passe `elastic`
  dans Secret Manager via la sortie `elasticsearch_password_secret_id` (voir
  la tâche 2, étape 4) et transmettez `-u elastic:<password>` à `curl`.
- **Données perdues après un redémarrage du pod :** le PVC n'était pas attaché (vérifiez `stateful_pvc_enabled =
  true`) ou `stateful_pvc_mount_path` ne correspond pas à `path.data`.
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou de
  quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP externe.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le StatefulSet Kubernetes et
son espace de noms, le PersistentVolumeClaim et son disque sous-jacent (toutes les données indexées sont
définitivement supprimées), les secrets Secret Manager et l'image copiée dans Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module copie l'image, déploie le StatefulSet GKE, provisionne le PVC et expose le port 9200 |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; vérifier la santé via `/_cluster/health` ; noter le point de terminaison pour RAGFlow |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet et le PVC, mettre à l'échelle, mettre à jour la version, gérer les secrets et les jobs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de sonde de démarrage, de X-Pack, de persistance des données et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris les données indexées |
