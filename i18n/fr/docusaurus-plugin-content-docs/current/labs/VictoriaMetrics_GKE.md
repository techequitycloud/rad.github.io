---
title: "VictoriaMetrics sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez VictoriaMetrics sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/VictoriaMetrics_GKE.md @ 3055034 sha256:ce43c912c95e -->

# VictoriaMetrics sur GKE Autopilot — Guide de lab {#victoriametrics-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 20–30 minutes

VictoriaMetrics est une base de données de séries temporelles rapide, économique et compatible avec Prometheus
— le backend auto-hébergé de référence pour le stockage de métriques à associer au
module Grafana de ce catalogue. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **VictoriaMetrics on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

C'est l'un des labs les plus simples de l'ensemble des modules applicatifs de ce catalogue —
VictoriaMetrics n'a aucune dépendance à une base de données externe (c'est lui-même une
base de données), aucun job d'initialisation et aucun secret à gérer ; la plupart des
étapes de dépannage habituelles d'un premier déploiement liées à ces éléments ne s'appliquent donc pas ici.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit VictoriaMetrics. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)
— ce lab ne reprend volontairement pas ce détail afin de rester exact
dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et atteindre le service uniquement interne (`ClusterIP`) via `kubectl port-forward`.
- Vérifier l'ingestion et interroger l'API compatible PromQL.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour la version et connecter un collecteur (scraper) ou une source de données Grafana.
- Observer l'utilisation des ressources et le comportement d'ingestion de VictoriaMetrics lui-même avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

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
- **Un accès kubectl au cluster.** Comme VictoriaMetrics utilise par défaut
  `service_type = "ClusterIP"` (uniquement interne, par conception — il est destiné à être
  collecté et interrogé depuis l'intérieur du cluster, et non exposé publiquement), ce
  lab l'atteint via `kubectl port-forward` plutôt que par une URL publique. Il n'est
  pas possible de vérifier ce module uniquement depuis un navigateur avec la
  configuration par défaut.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **VictoriaMetrics (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous forme de
   StatefulSet, provisionne un PersistentVolumeClaim bloc (classe de stockage `standard`/HDD,
   `20Gi` par défaut) monté sur `/victoria-metrics-data`, et
   construit l'image de conteneur personnalisée. Il n'y a ni base de données SQL, ni Redis, ni
   secret Secret Manager, ni job d'initialisation à attendre — VictoriaMetrics
   est un binaire autonome, sans notion de schéma ni de migration. C'est donc
   l'un des modules de ce catalogue qui atteignent le plus rapidement un état sain ;
   les premiers déploiements prennent généralement **8 à 15 minutes** (le build de l'image et le provisionnement des nœuds
   Autopilot représentent l'essentiel — aucune phase d'amorçage de base de données ne s'y ajoute).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep victoriametrics | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

VictoriaMetrics utilise par défaut `service_type = "ClusterIP"` — il n'y a aucun point de terminaison
public, par conception. Atteignez-le via `kubectl port-forward` ou `kubectl exec`.

1. Confirmez que le pod s'exécute et que le PVC du StatefulSet est lié :

   ```bash
   kubectl get pods,svc,pvc -n "$NS"
   kubectl describe pvc -n "$NS"
   ```

2. Vérifiez l'état de santé directement dans le pod (aucune mise en réseau nécessaire — la
   vérification la plus rapide) :

   ```bash
   POD=$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- wget -qO- http://127.0.0.1:8428/health
   # expect: OK
   ```

3. Redirigez le port du service pour l'atteindre depuis votre shell, et confirmez que
   l'API de requête répond :

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward "svc/$SVC" 8428:8428 -n "$NS" &
   sleep 3
   curl -s http://localhost:8428/health              # expect: OK
   curl -s 'http://localhost:8428/api/v1/query?query=up' | head -c 300
   ```

4. Envoyez une métrique d'exemple via le point de terminaison d'import compatible avec le `remote_write` de Prometheus
   et interrogez-la en retour, afin de confirmer de bout en bout le chemin ingestion → stockage → requête :

   ```bash
   # Simple ingestion via the InfluxDB line-protocol-style import endpoint
   curl -s -X POST 'http://localhost:8428/api/v1/import/prometheus' \
     --data-binary 'lab_smoke_test{source="lab-guide"} 1'

   sleep 2
   curl -s 'http://localhost:8428/api/v1/query?query=lab_smoke_test' | head -c 400
   ```

   Si le type de service est `LoadBalancer` (un remplacement délibéré — consultez le
   tableau des pièges du Guide de configuration avant de le faire), utilisez directement l'IP
   externe au lieu de la redirection de port :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:8428/health"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — l'état du pod et du StatefulSet :

   ```bash
   kubectl get statefulset,pods -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mise à l'échelle — il n'y en a pas.** Contrairement à la plupart des modules avec état de ce
   catalogue, ne portez **pas** `min_instance_count`/`max_instance_count` au-delà de
   `1`. Le mode nœud unique de VictoriaMetrics n'offre ni clustering ni
   réplication intégrés — un second pod écrivant sur le même PVC corrompt les fichiers de données.
   Si vous avez besoin de plus de capacité, redimensionnez plutôt `cpu_limit`/`memory_limit` du pod et
   `stateful_pvc_size` (mise à l'échelle verticale) via le flux **Update**
   de la plateforme RAD.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans l'interface RAD et en l'appliquant via **Update** ; une nouvelle image est construite et
   le StatefulSet redéploie l'unique pod. `latest` correspond à une version figée dans
   l'argument de build du Dockerfile (actuellement `v1.148.0`), et non à un tag flottant ; les
   changements de version sont donc toujours explicites et reproductibles.

4. **Connectez un véritable collecteur ou Grafana.** Depuis l'intérieur du cluster (par exemple depuis
   un pod Grafana ou un collecteur au format Prometheus tel que `vmagent`), atteignez
   VictoriaMetrics via son nom DNS interne au cluster, indiqué dans `service_url` parmi
   les sorties du déploiement :

   ```bash
   kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}{"\n"}'
   # In Grafana: add a Prometheus-type datasource pointed at
   # http://<service-name>.<namespace>.svc.cluster.local:8428
   ```

   Pour un émetteur `remote_write` Prometheus ou Grafana Alloy, faites pointer l'URL
   `remote_write` vers `http://<service>.<namespace>.svc.cluster.local:8428/api/v1/write`.

5. **Inspectez le PVC et les fichiers de données sur disque :**

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls -la /victoria-metrics-data
   ```

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

VictoriaMetrics *est* le backend d'observabilité ; « l'observer » recouvre donc deux
choses différentes : la vue du pod par la plateforme (Cloud Logging/Monitoring
standard, comme pour toute charge de travail) et les métriques d'ingestion et de ressources
que VictoriaMetrics rapporte sur lui-même.

1. **Journaux et métriques au niveau de la plateforme** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   Ouvrez les tableaux de bord GKE / Kubernetes dans Cloud Monitoring et examinez l'utilisation du CPU,
   de la mémoire et du disque du pod au regard des valeurs `cpu_limit`/`memory_limit` et
   `stateful_pvc_size` que vous avez configurées.

2. **Les métriques de VictoriaMetrics sur lui-même.** VictoriaMetrics expose un
   point de terminaison `/metrics` standard au format Prometheus décrivant son propre
   débit d'ingestion, le nombre de séries temporelles actives, l'utilisation du disque et la latence des requêtes —
   utile pour bien dimensionner `stateful_pvc_size` et `memory_limit` avant
   de connecter une véritable charge de travail :

   ```bash
   curl -s http://localhost:8428/metrics | grep -E '^vm_(rows|data_size_bytes|free_disk_space_bytes)' | head -20
   ```

   Dans un déploiement réel, collectez ce point de terminaison avec Grafana/vmagent/Prometheus
   comme vous le feriez pour toute autre cible — VictoriaMetrics peut
   se superviser lui-même en utilisant son propre chemin d'ingestion.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de
VictoriaMetrics. Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC non lié / erreurs de stockage :** confirmez que le PVC a été provisionné
  avec succès et que le fsGroup est correctement défini pour l'accès en écriture :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
  N'oubliez pas qu'il n'existe pas de solution de repli GCS FUSE pour ce module — si le PVC ne peut
  pas être lié (par exemple quota `SSD_TOTAL_GB`/`DISKS_TOTAL_GB` épuisé), le pod ne peut
  pas démarrer du tout.
- **`/health` inaccessible via port-forward alors que le pod est Running :** confirmez
  que vous redirigez le bon service/port (`8428`) et qu'aucun autre processus
  `kubectl port-forward` n'occupe déjà le port local ; rabattez-vous
  sur `kubectl exec ... -- wget -qO- http://127.0.0.1:8428/health` pour distinguer
  un problème de couche réseau d'un problème de couche applicative.
- **Les données ingérées n'apparaissent pas dans les requêtes :** confirmez que l'horodatage de votre
  écriture de test se trouve dans la fenêtre de rétention (12 mois par défaut — peu probable
  pour une écriture récente, mais à écarter si vous chargez d'anciennes
  données) et que vous avez interrogé le bon nom de métrique et les bons labels.
- **Tentative de mise à l'échelle horizontale entraînant une corruption ou des erreurs d'écriture :**
  ce module déploie VictoriaMetrics en mode nœud unique par conception ;
  `max_instance_count` doit rester à `1`. Il n'existe aucun moyen pris en charge d'ajouter
  des réplicas sur le même PVC.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail
Kubernetes et l'espace de noms, le PersistentVolumeClaim et le Persistent Disk
sous-jacent, ainsi que les images Artifact Registry. Il n'y a ni bucket GCS, ni instance Cloud SQL,
ni secret Secret Manager à nettoyer pour ce module — VictoriaMetrics
n'en crée aucun.

Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre partagé)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et déploie le StatefulSet GKE + PVC ; aucune phase de base de données, de secret ou de job d'initialisation à attendre |
| 2 — Accéder et vérifier | Manuel | Atteindre le service uniquement interne via `kubectl port-forward` ou `exec` ; confirmer `/health` et un véritable aller-retour ingestion→requête |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet, mettre à jour la version, connecter un véritable collecteur/Grafana — pas de mise à l'échelle horizontale |
| 4 — Observer | Manuel | Journaux/métriques de la plateforme pour le pod, ainsi que les métriques d'ingestion/stockage rapportées par VictoriaMetrics lui-même |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de connectivité et de fenêtre de rétention |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module — aucune base de données externe ni aucun secret à nettoyer séparément |
