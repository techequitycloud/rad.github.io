---
title: "AWS EKS rattaché à une Fleet Google Cloud — Guide de lab"
description: "Lab pratique : rattachez un cluster AWS EKS à une Fleet Google Cloud — enregistrement multicloud, vérification, exploitation et démantèlement."
---

<!-- translated-from: docs/labs/EKS_GKE.md @ 3055034 sha256:a1760f08bba5 -->

# AWS EKS rattaché à une Fleet Google Cloud — Guide de lab {#aws-eks-attached-to-a-google-cloud-fleet--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Ce module provisionne un cluster Amazon EKS complet sur AWS et l'enregistre auprès de Google Cloud en tant que **GKE Attached Cluster** — un membre d'une Fleet Google Cloud. Une fois rattaché, le cluster EKS apparaît dans la console Google Cloud à côté des éventuels clusters GKE natifs, est accessible avec `kubectl` via la **Connect gateway** à l'aide de votre identité Google (sans identifiants AWS), et envoie ses journaux et métriques vers Cloud Logging et Cloud Monitoring.

Ce lab parcourt l'intégralité du cycle de vie opérationnel du module : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler. Il porte sur l'exploitation du **module et des deux plateformes cloud** plutôt que sur Kubernetes lui-même. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser ce qu'il provisionne sur AWS comme sur Google Cloud.
- Vérifier que le cluster EKS est enregistré dans la Fleet et y accéder via la Connect gateway.
- Effectuer les opérations du jour 2 (day-2) — inspecter le cluster, mettre à l'échelle le groupe de nœuds, mettre à niveau les versions et accorder des accès.
- Observer le cluster EKS avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- Un **compte AWS** et un utilisateur/rôle IAM autorisé à créer des ressources VPC, EKS, EC2 et IAM. Préparez son **Access Key ID** et sa **Secret Access Key** — tous deux sont des paramètres obligatoires du module.
- La **gcloud CLI**, **kubectl** et la **CLI `aws`** installés ; `gcloud auth login` et `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet Google Cloud.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export GCP_REGION="us-central1"        # Fleet location (gcp_location)
export AWS_REGION="us-west-2"          # AWS region for EKS (aws_region)
export CLUSTER_NAME="aws-eks-cluster"  # equals cluster_name_prefix
gcloud config set project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **AWS EKS on GKE Fleet (EKS_GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), puis définissez les paramètres obligatoires :
   - `project_id` — votre projet Google Cloud
   - `aws_access_key` et `aws_secret_key` — vos identifiants AWS (stockés comme données sensibles)
   - éventuellement `trusted_users` — les adresses e-mail Google auxquelles accorder le rôle cluster-admin

   Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE) documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme active les API Google Cloud nécessaires, crée le VPC AWS et ses sous-réseaux répartis sur trois zones de disponibilité, les rôles IAM, le cluster EKS et son groupe de nœuds géré, installe le Connect Agent dans le cluster, puis l'enregistre enfin en tant que GKE Attached Cluster dans la Fleet. Les déploiements prennent généralement **20–30 minutes** (la création du cluster EKS en représente l'essentiel).

3. Une fois l'opération terminée, configurez `kubectl` via la Connect gateway — aucun identifiant AWS n'est nécessaire :

   ```bash
   gcloud container attached clusters get-credentials "$CLUSTER_NAME" \
     --location "$GCP_REGION" --project "$PROJECT"
   kubectl get nodes -o wide
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Vérifiez l'enregistrement dans la Fleet** côté Google Cloud :

   ```bash
   gcloud container attached clusters list --location=- --project "$PROJECT"
   gcloud container fleet memberships list --project "$PROJECT"
   ```

   Dans la console, Kubernetes Engine → Clusters affiche le cluster avec **Type = Attached** et la distribution **EKS**.

2. **Accédez au cluster via la Connect gateway** et vérifiez vos droits d'administration :

   ```bash
   kubectl cluster-info        # control plane URL is connectgateway.googleapis.com/...
   kubectl get pods -A
   kubectl auth can-i '*' '*' --all-namespaces   # expect: yes
   ```

3. **Contrôlez le côté EKS dans AWS :**

   ```bash
   aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" \
     --query 'cluster.{name:name,status:status,version:version}' --output table
   ```

4. **Vérifiez que le Connect Agent est connecté** (canal sortant en bonne santé) :

   ```bash
   kubectl get pods -n gke-connect
   ```

---

## Tâche 3 — Exploiter (jour 2) [Manuel] {#task-3--operate-day-2-manual}

1. **Inspectez le cluster et le groupe de nœuds :**

   ```bash
   kubectl get nodes --label-columns topology.kubernetes.io/zone
   aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" \
     --nodegroup-name "${CLUSTER_NAME}-node-group" --region "$AWS_REGION" \
     --query 'nodegroup.scalingConfig'
   ```

2. **Mettez à l'échelle le groupe de nœuds** en modifiant les paramètres de nombre minimal/souhaité/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement — le module est propriétaire de la spécification du groupe de nœuds : la mise à l'échelle est donc une modification de configuration, et non une modification manuelle dans AWS (une modification manuelle serait annulée lors de l'application suivante). Notez qu'une montée en charge au-delà du nombre souhaité nécessite un cluster autoscaler, que ce module n'installe pas.

3. **Mettez à niveau la version de Kubernetes** en modifiant **à la fois** `k8s_version` et `platform_version` avec des valeurs concordantes dans le même **Update** — Google Cloud rejette toute incohérence lors de l'enregistrement.

4. **Accordez un accès à un collègue** (deux niveaux — IAM Google Cloud pour traverser la gateway, plus le RBAC Kubernetes pour définir ce qu'il peut faire) :

   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member="user:colleague@example.com" --role="roles/gkehub.gatewayReader"
   kubectl create clusterrolebinding colleague-view \
     --clusterrole=view --user="colleague@example.com"
   ```

   Pour un accès cluster-admin, ajoutez plutôt le collègue à `trusted_users` puis faites un **Update**.

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Journaux** — les journaux des composants système et des charges de travail sont envoyés vers Cloud Logging via le Connect Agent :

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" resource.labels.cluster_name="'"$CLUSTER_NAME"'"' \
     --project "$PROJECT" --limit 20
   ```

   Vous pouvez aussi ouvrir Logging → Logs Explorer et sélectionner la ressource **Kubernetes Cluster** → votre cluster.

2. **Métriques** — la collecte Managed Prometheus est activée sur le cluster rattaché. Ouvrez Monitoring → Dashboards → **GKE** et sélectionnez le cluster, ou exécutez `kubectl top nodes` via la gateway. Les mêmes tableaux de bord adaptés à Kubernetes que pour GKE natif s'appliquent au cluster EKS rattaché.

---

## Tâche 5 — Dépanner [Manuel] {#task-5--troubleshoot-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas d'une version du module à l'autre.

- **Cluster créé sur AWS mais absent de la Fleet :** il s'agit presque toujours d'une incohérence entre `k8s_version` et `platform_version`. Consultez `gcloud container attached get-server-config --location "$GCP_REGION"` pour connaître les versions de plateforme valides et redéployez avec des versions mineures concordantes.
- **Connect Agent non connecté / `kubectl` via la gateway échoue :** vérifiez que les pods de l'agent sont en cours d'exécution et que le cluster dispose d'un accès sortant vers Google Cloud :
  ```bash
  kubectl get pods -n gke-connect
  ```
  En mode sous-réseau privé, cela dépend de la NAT Gateway ; en mode sous-réseau public, de l'Internet Gateway.
- **Accès bloqué via la gateway :** vérifiez que votre adresse e-mail figure dans la liste des administrateurs du cluster (la personne qui déploie est toujours ajoutée ; les autres ont besoin de `trusted_users` ou d'une liaison RBAC) et que vous détenez un rôle IAM `roles/gkehub.gateway*`.
- **Erreurs d'API non activée pendant le déploiement :** la propagation des API Google Cloud nécessaires peut prendre du temps ; relancez l'application après une courte attente.
- **Erreurs de création de sous-réseau/VPC :** vérifiez que le nombre de `subnet_availability_zones` correspond aux listes de CIDR et que les zones de disponibilité appartiennent à `aws_region`.
- **Auditer qui a accédé au cluster :**
  ```bash
  gcloud logging read \
    'protoPayload.serviceName="connectgateway.googleapis.com"' \
    --project "$PROJECT" --limit 20
  ```

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Le démantèlement désinstalle le Connect Agent d'EKS, supprime l'enregistrement dans la Fleet, puis supprime le groupe de nœuds et le cluster EKS ainsi que le VPC et les rôles IAM AWS. Les API Google Cloud activées par le module sont volontairement laissées en place afin de ne pas perturber d'autres charges de travail.

> Le démantèlement a besoin du même chemin réseau vers le serveur d'API EKS que le déploiement (pour désinstaller le Connect Agent). Si le cluster n'est plus joignable, la destruction peut rester bloquée.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Après un Purge, vous devez nettoyer vous-même les ressources AWS et Google Cloud.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le VPC AWS, IAM, le cluster EKS et son groupe de nœuds, et l'enregistre dans la Fleet Google Cloud |
| 2 — Accéder et vérifier | Manuel | Cluster enregistré comme Attached ; accessible via la Connect gateway avec le rôle cluster-admin |
| 3 — Exploiter | Manuel | Inspecter le cluster, mettre à l'échelle le groupe de nœuds, mettre à niveau les versions, accorder des accès |
| 4 — Observer | Manuel | Interroger les journaux EKS dans Cloud Logging ; examiner les métriques dans Cloud Monitoring / Managed Prometheus |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'incohérence de versions, de Connect Agent, d'accès, de propagation des API et de sous-réseaux |
| 6 — Démanteler | Automatisé | La suppression (Trash) détruit toutes les ressources du module ; Purge les retire de RAD sans les détruire |
