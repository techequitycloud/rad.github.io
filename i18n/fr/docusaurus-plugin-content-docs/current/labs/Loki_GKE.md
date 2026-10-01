---
title: "Loki sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Loki sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Loki_GKE.md @ 3055034 sha256:1ce2c39e5fbe -->

# Loki sur GKE Autopilot — Guide de lab {#loki-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 45 minutes

Grafana Loki est un système d'agrégation de journaux évolutif horizontalement (« Prometheus pour
les journaux ») qui n'indexe qu'un petit ensemble de libellés par flux de journaux plutôt que le texte
complet des journaux, ce qui maintient des coûts de stockage faibles. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Loki on GKE Autopilot** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Loki n'a ni base de données ni interface web intégrée, ce lab est donc plus court et plus simple que
la plupart de ceux de ce catalogue — il n'y a pas de compte administrateur à créer au premier démarrage, ni de migration
de schéma à attendre. Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur le langage de requête de Loki ni sur son intégration avec Grafana. Pour la
liste complète des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et exécuter une première requête
  LogQL.
- Effectuer les opérations du jour 2 — inspecter, comprendre la contrainte de mise à l'échelle, mettre à jour et
  inspecter l'utilisation du stockage GCS.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Facultatif mais utile : **`logcli`** (la CLI officielle de Grafana pour Loki) installé localement
  pour la tâche 2.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, ouvrez **Loki (GKE)** dans la
   liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot (sous forme de
   `Deployment` et non de `StatefulSet` — l'état durable de Loki est dans GCS, pas sur un disque local),
   provisionne un bucket Cloud Storage dédié (`storage`) que Loki utilise comme backend pour ses
   chunks et son index, construit l'image de conteneur personnalisée (un wrapper basé sur distroless
   autour de `grafana/loki` — voir la section Pitfalls du Guide de configuration)
   et accorde au compte de service Workload Identity de GKE le rôle `roles/storage.objectAdmin` sur le
   bucket. Il n'y a **ni base de données ni job d'initialisation**, c'est donc l'un des premiers
   déploiements les plus rapides du catalogue — comptez environ **10 à 15 minutes**, principalement consacrées à
   la construction du conteneur et au provisionnement de l'IP du LoadBalancer.

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep loki | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Loki expose un point de terminaison de disponibilité non authentifié
   qui renvoie HTTP 200 dès que le serveur écoute — généralement quelques
   secondes après le démarrage, puisqu'il n'y a pas d'étape de migration :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:3100/ready"   # expect 200
   ```

3. **Loki n'a pas d'interface web propre.** Il est normalement utilisé comme source de données derrière
   **Grafana**, ou interrogé directement avec **`logcli`** ou en HTTP simple via son
   API de requête. Exécutez une première requête (un résultat vide est attendu si rien n'a encore
   envoyé de journaux — l'essentiel est que l'API réponde au lieu de
   renvoyer une erreur) :

   ```bash
   # Direct HTTP:
   curl -s "http://${EXTERNAL_IP}:3100/loki/api/v1/labels" | jq .

   # Or with logcli:
   export LOKI_ADDR="http://${EXTERNAL_IP}:3100"
   logcli labels
   ```

4. Envoyez une petite ligne de journal de test pour confirmer l'ingestion de bout en bout (ajustez
   l'horodatage à l'epoch Unix actuel en nanosecondes) :

   ```bash
   NOW_NS=$(date +%s%N)
   curl -s -X POST "http://${EXTERNAL_IP}:3100/loki/api/v1/push" \
     -H "Content-Type: application/json" \
     -d '{"streams":[{"stream":{"job":"lab-test"},"values":[["'"$NOW_NS"'","hello from the lab"]]}]}'
   # Then query it back (may take a few seconds to become queryable):
   curl -s "http://${EXTERNAL_IP}:3100/loki/api/v1/query?query=%7Bjob%3D%22lab-test%22%7D" | jq .
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail :**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mise en garde sur la mise à l'échelle — ne dépassez pas 1 réplica.** Contrairement à la plupart des modules de ce
   catalogue, `max_instance_count` est **forcé à `1`** par le module, quelle que soit
   la valeur définie sur le déploiement — la configuration intégrée de Loki utilise un anneau en mémoire
   (`replication_factor: 1`) et un compacteur singleton qui ne peut pas coordonner la
   rétention et la suppression entre des réplicas concurrents. Si vous avez besoin de plus de débit, augmentez
   `container_resources.cpu_limit`/`memory_limit` sur le réplica unique plutôt que de
   compter sur une mise à l'échelle horizontale.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (en régénérant la
   même configuration à partir du modèle) et une mise à jour progressive remplace le pod.

4. **Inspectez l'utilisation du stockage GCS** — le principal élément à surveiller au jour 2, puisque tout
   l'état durable de Loki réside ici :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage du -s gs://<storage-bucket>/
   gcloud storage ls gs://<storage-bucket>/index_*/     # TSDB index shards
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — les journaux du processus Loki lui-même (et non les journaux qu'il ingère, qui sont des
   données applicatives dans Loki, et non des entrées Cloud Logging) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un **test de
   disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de disponibilité
  cible `/ready` — un échec à ce niveau signifie presque toujours que l'étape de génération de la configuration
  dans le point d'entrée a échoué (vérifiez que `LOKI_GCS_BUCKET` s'est résolu en un véritable nom
  de bucket) plutôt qu'une lente migration au premier démarrage (il n'y en a pas).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs d'autorisation GCS** (`403` / échecs d'écriture) : confirmez que le compte de service Workload
  Identity de GKE dispose de `roles/storage.objectAdmin` sur le bucket `storage` :
  ```bash
  gcloud storage buckets get-iam-policy gs://<storage-bucket>
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec. Si
  vous (ou un futur mainteneur) avez modifié le Dockerfile et obtenu `exec: /bin/sh: no
  such file or directory` ou `exec /bin/busybox: no such file or directory`, il s'agit du
  problème d'image de base distroless documenté dans la section Pitfalls du Guide de configuration
  — l'image officielle `grafana/loki` n'a ni shell ni éditeur de liens dynamique.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour détecter des problèmes de ressources
  ou de quota, et confirmez que le Service `LoadBalancer` dispose d'une IP externe
  attribuée (`kubectl get svc -n "$NS"`).
- **La requête renvoie un résultat vide alors que l'envoi a réussi :** confirmez que le sélecteur de libellés de la requête
  correspond à ce que vous avez envoyé, et laissez quelques secondes au chemin d'écriture pour se vider.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris l'histoire complète de l'image distroless et la raison pour laquelle `max_instance_count` est
figé).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
le namespace, le bucket GCS `storage` (et toutes les données de journaux ingérées qu'il contient), les entrées
Secret Manager (si certaines ont été ajoutées) et les images Artifact Registry. Les ressources appartenant
à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE (sous forme de `Deployment`), le bucket GCS `storage`, et construit l'image personnalisée basée sur distroless (ni base de données, ni job d'initialisation) |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; `/ready` renvoie 200 ; une ligne de journal de test envoyée puis relue avec succès |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, comprendre la contrainte de mise à l'échelle à réplica unique, mettre à jour la version, surveiller l'utilisation de GCS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de santé du pod, d'IAM GCS, de build de l'image, de planification et de requêtes |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime la charge de travail, le bucket de stockage (et ses données de journaux) et les images |
