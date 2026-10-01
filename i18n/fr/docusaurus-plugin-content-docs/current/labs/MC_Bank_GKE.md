---
title: "Bank of Anthos multicluster sur GKE — Guide de lab"
description: "Lab pratique : déployez Bank of Anthos multicluster sur GKE Autopilot dans votre propre projet Google Cloud — configuration, vérification, exploitation et démantèlement."
---

<!-- translated-from: docs/labs/MC_Bank_GKE.md @ 3055034 sha256:cc8182d713e5 -->

# Bank of Anthos multicluster sur GKE — Guide de lab {#multi-cluster-bank-of-anthos-on-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/MC_Bank_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 90 à 150 minutes (dont l'essentiel pour le déploiement multicluster initial)

Bank of Anthos est la démo bancaire open source de microservices de Google. Ce module la déploie
sur **plusieurs clusters GKE dans plusieurs régions**, réunis en une seule **GKE Fleet**, un
**Cloud Service Mesh multi-primaire** et une **passerelle multicluster / un équilibreur de charge global**, de sorte
qu'une seule adresse publique serve la région saine la plus proche. Ce lab vous fait parcourir tout le
cycle de vie opérationnel : le déployer, l'atteindre via l'équilibreur de charge global, l'exploiter à travers
plusieurs contextes de cluster, l'observer à l'échelle de la flotte, diagnostiquer les problèmes inter-clusters et le démanteler.

Le lab porte sur l'exploitation de la **plateforme GKE multicluster et des services Google Cloud
qui l'entourent**, et non sur les fonctionnalités bancaires. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/MC_Bank_GKE) — ce lab
ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les clusters, la flotte, le mesh et l'équilibreur de charge global qu'il provisionne.
- Atteindre l'application via la passerelle multicluster et confirmer que les charges de travail s'exécutent sur chaque cluster.
- Exploiter le déploiement à travers plusieurs contextes de cluster (inspecter, mettre à l'échelle, mettre à jour).
- Observer la charge de travail à l'échelle de la flotte avec Cloud Logging, Cloud Monitoring, le tableau de bord Service Mesh et Cloud Trace.
- Diagnostiquer les modes de défaillance inter-clusters que vous rencontrerez le plus probablement.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée** et un quota régional suffisant pour plusieurs clusters GKE.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Votre propre projet uniquement.** Ce module masque l'option **GCP Project on RAD** (`enable_rad_gcpproject = false`) car il active des API que les politiques des paliers gérés par RAD refusent ; il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Ce module est **autonome** — il construit son propre VPC, ses clusters, sa flotte, son mesh et son équilibreur de charge ;
il ne nécessite donc pas que Services_GCP ni aucun autre module soit déployé au préalable.

Définissez une fois ces variables shell. Notez que ce déploiement comporte **plus d'un cluster** : vous
configurerez donc un contexte par cluster et basculerez de l'un à l'autre tout au long du lab :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION1="us-west1"     # available_regions[0] — primary / config cluster
export REGION2="us-east1"     # available_regions[1]
export NS="bank-of-anthos"    # application namespace on every cluster

gcloud config set project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Multi-Cluster Bank of Anthos (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/MC_Bank_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Les choix clés sont `available_regions`, `cluster_size`,
   `create_autopilot_cluster` et `enable_cloud_service_mesh`. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme crée le VPC partagé et `cluster_size` clusters GKE (2 par défaut) répartis sur
   `available_regions` à tour de rôle, enregistre chaque cluster dans
   une GKE Fleet, active un Cloud Service Mesh multi-primaire à l'échelle de la flotte, déploie Bank of Anthos sur
   tous les clusters et provisionne un équilibreur de charge externe global avec un certificat géré par Google.
   Les premiers déploiements prennent environ **40 à 60 minutes** — le provisionnement multicluster, de la flotte, du mesh géré et de
   l'équilibreur de charge global est intrinsèquement lent.

3. Connectez-vous à chaque cluster et configurez un contexte par cluster (avec les valeurs par défaut, il y en a deux,
   `gke-cluster-1` et `gke-cluster-2`) :

   ```bash
   gcloud container clusters get-credentials gke-cluster-1 --region "$REGION1" --project "$PROJECT"
   gcloud container clusters get-credentials gke-cluster-2 --region "$REGION2" --project "$PROJECT"

   kubectl config rename-context "gke_${PROJECT}_${REGION1}_gke-cluster-1" cluster1
   kubectl config rename-context "gke_${PROJECT}_${REGION2}_gke-cluster-2" cluster2
   kubectl config get-contexts

   kubectl --context cluster1 get nodes
   kubectl --context cluster2 get nodes
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Confirmez la flotte et la charge de travail sur chaque cluster.** Les pods du namespace `bank-of-anthos`
   doivent être prêts à `2/2` (conteneur de l'application + sidecar Envoy) sur chaque cluster :

   ```bash
   gcloud container fleet memberships list --project "$PROJECT"
   kubectl --context cluster1 get pods -n "$NS"
   kubectl --context cluster2 get pods -n "$NS"
   ```

   Notez que les StatefulSets `accounts-db` et `ledger-db` n'apparaissent **que sur le cluster principal**
   (`cluster1`) — c'est voulu ; les clusters non principaux utilisent les bases de données du cluster principal.

2. **Atteignez l'application via la passerelle multicluster.** Trouvez l'adresse IP globale, puis ouvrez
   l'URL `sslip.io` :

   ```bash
   GLOBAL_IP=$(gcloud compute addresses list --global --project "$PROJECT" \
     --filter="name~bank" --format="value(address)")
   echo "App: https://boa.${GLOBAL_IP}.sslip.io"
   curl -sk "https://boa.${GLOBAL_IP}.sslip.io" | grep -i "<title>"
   ```

   Le certificat géré par Google peut mettre **10 à 60 minutes** à devenir `Active` après le premier
   déploiement — d'ici là, HTTPS peut afficher un avertissement ou échouer. Vérifiez son état avec :

   ```bash
   kubectl --context cluster1 get managedcertificate -n "$NS" \
     -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.certificateStatus}{"\n"}{end}'
   ```

   Connectez-vous avec les identifiants de démonstration affichés sur la page de connexion de Bank of Anthos.

3. **Confirmez que le mesh couvre les deux clusters** et que l'équilibreur de charge global dispose de backends sains dans
   chaque région :

   ```bash
   gcloud container fleet mesh describe --project "$PROJECT"
   BACKEND=$(gcloud compute backend-services list --global --project "$PROJECT" \
     --filter="name~bank-of-anthos" --format="value(name)" | head -1)
   gcloud compute backend-services get-health "$BACKEND" --global --project "$PROJECT"
   ```

   Vous devriez voir un Network Endpoint Group par cluster, chacun signalant des backends sains.

---

## Tâche 3 — Exploiter (jour 2) [Manuel] {#task-3--operate-day-2-manual}

Ici, le travail du jour 2 consiste à opérer à travers **plusieurs contextes de cluster**.

1. **Inspectez la charge de travail sur chaque cluster :**

   ```bash
   kubectl --context cluster1 get deploy,pods,svc -n "$NS"
   kubectl --context cluster2 get deploy,pods,svc -n "$NS"
   ```

2. **Redimensionnez ou remodelez la plateforme** en modifiant les paramètres (`cluster_size`, `available_regions`,
   `release_channel`, activation ou non du mesh) et en cliquant sur **Update** sur la page de détails du déploiement. Le
   module possède l'ensemble des clusters, la flotte, le mesh et l'entrée — ajouter ou retirer des clusters est une
   modification de configuration, et non une opération manuelle `gcloud`/`kubectl` (les modifications manuelles seraient
   annulées lors du prochain apply). Considérez le cluster principal (`cluster1`) comme le niveau de données
   lorsque vous planifiez des modifications.

3. **Inspectez l'entrée et les services multiclusters** depuis le cluster de configuration :

   ```bash
   kubectl --context cluster1 get multiclusteringress,multiclusterservice -n "$NS"
   kubectl --context cluster1 describe multiclusterservice bank-of-anthos-mcs -n "$NS"
   ```

4. **Appliquez une politique de trafic du mesh** (facultatif) — comme le mesh s'étend à toute la flotte, des ressources Istio
   telles que `VirtualService`, `DestinationRule`, `PeerAuthentication` et `AuthorizationPolicy`
   peuvent être appliquées par cluster pour façonner ou sécuriser le trafic. Appliquez la même ressource sur chaque cluster
   où vous souhaitez qu'elle prenne effet.

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Journaux sur l'ensemble des clusters** — Cloud Logging associe à chaque entrée son cluster ; vous pouvez donc comparer
   les régions en une seule requête :

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="bank-of-anthos"' \
     --project "$PROJECT" --limit 20 \
     --format="table(timestamp,resource.labels.cluster_name,resource.labels.location)"
   ```

   Ou directement par cluster :

   ```bash
   kubectl --context cluster1 logs -n "$NS" -l app=frontend --tail=50
   kubectl --context cluster2 logs -n "$NS" -l app=frontend --tail=50
   ```

2. **Tableau de bord Service Mesh** — ouvrez Kubernetes Engine → Service Mesh pour voir la topologie combinée
   des services en direct, les signaux clés (latence, trafic, erreurs, saturation) et l'état mTLS sur
   tous les clusters. Le générateur de charge continu maintient ces données alimentées.

3. **Surveillance et Prometheus** — examinez les tableaux de bord GKE (Monitoring → Dashboards → GKE) pour
   l'utilisation des nœuds et des pods par cluster, et comparez la consommation des ressources côte à côte :

   ```bash
   kubectl --context cluster1 top pods -n "$NS"
   kubectl --context cluster2 top pods -n "$NS"
   ```

4. **Cloud Trace** — ouvrez Trace → Trace List pour suivre une requête à travers les microservices ; chaque
   requête entrante génère une trace couvrant chaque saut en aval.

---

## Tâche 5 — Dépanner [Manuel] {#task-5--troubleshoot-manual}

Des techniques durables pour les modes de défaillance inter-clusters que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de l'application.

- **Pods non `2/2` (pas de sidecar) :** confirmez le libellé d'injection du namespace et l'état du mesh :
  ```bash
  kubectl --context cluster1 get ns "$NS" --show-labels      # expect istio.io/rev=asm-managed
  gcloud container fleet mesh describe --project "$PROJECT"   # control/data plane ACTIVE per membership
  ```
- **Une région répond, l'autre non :** vérifiez la santé du NEG de backend et les pods de ce cluster. L'équilibreur
  de charge global cesse automatiquement d'acheminer le trafic vers un cluster dont les backends ne sont pas sains :
  ```bash
  kubectl --context cluster2 get pods -n "$NS"
  gcloud compute backend-services get-health "$BACKEND" --global --project "$PROJECT"
  ```
- **Application joignable mais opérations sur les données en échec sur un cluster non principal :** rappelez-vous que les bases de données
  ne résident que sur le cluster principal (`cluster1`). Confirmez que les pods de base de données y sont sains, et que le
  cluster principal et sa région sont opérationnels :
  ```bash
  kubectl --context cluster1 get statefulset,pods -n "$NS" -l 'app in (accounts-db,ledger-db)'
  ```
- **Avertissements HTTPS / pas de certificat :** le certificat géré est encore en cours de provisionnement (10 à 60 min).
  Vérifiez `status.certificateStatus` sur le `ManagedCertificate` ; `Provisioning` est normal au début.
- **Adhésion à la flotte non `READY` / mesh qui ne se configure pas :** inspectez l'état des adhésions et des fonctionnalités :
  ```bash
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet features list --project "$PROJECT"
  ```
- **Problèmes d'authentification du mesh entre clusters :** tous les clusters doivent partager le même domaine de confiance
  (`<project>.svc.id.goog`) ; confirmez-le via `gcloud container fleet mesh describe`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Le démantèlement supprime tout ce que le module a créé sur chaque cluster — les charges de travail et namespaces Bank of
Anthos, les ressources Multi-Cluster Ingress/Service et l'équilibreur de charge
global, les adhésions à la flotte et la fonctionnalité de mesh, tous les clusters GKE, ainsi que le VPC partagé et sa
mise en réseau. La destruction exécute un nettoyage ordonné afin que l'entrée multicluster, le mesh et l'état de la flotte soient
supprimés avant les clusters et le VPC, ce qui évite les ressources cloud orphelines.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications
manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement
des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement).
Après une purge, les clusters, adhésions à la flotte, équilibreur de charge et VPC restent dans le projet et
doivent être nettoyés manuellement.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le VPC, plusieurs clusters GKE, la flotte, le mesh multi-primaire, Bank of Anthos et l'équilibreur de charge global |
| 2 — Accéder et vérifier | Manuel | Atteindre l'application via la passerelle multicluster ; confirmer les pods sur chaque cluster, le service MCS et les points de terminaison du mesh sur toute la flotte |
| 3 — Exploiter | Manuel | Inspecter et remodeler la plateforme à travers plusieurs contextes de cluster |
| 4 — Observer | Manuel | Agréger Cloud Logging ; examiner le tableau de bord Service Mesh, Monitoring/Prometheus et Cloud Trace |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de sidecar, de backend par région, de niveau de données du cluster principal, de certificat et de flotte/mesh |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module sur chaque cluster ; Purge retire l'enregistrement de RAD sans détruire les ressources |
