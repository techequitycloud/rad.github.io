---
title: "AWS EKS attaché à une flotte Google Cloud — Guide de lab"
description: "Lab pratique : attacher un cluster AWS EKS à une flotte Google Cloud — enregistrement multicloud, vérification, opérations et suppression."
---

<!-- translated-from: docs/labs/EKS_GKE.md @ 7d02aa0b sha256:af72c7755ee4 -->

# AWS EKS attaché à une flotte Google Cloud — Guide de lab {#aws-eks-attached-to-a-google-cloud-fleet--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Ce module provisionne un cluster Amazon EKS complet sur AWS et l'enregistre auprès de Google Cloud en tant que **cluster GKE attaché** — un membre d'une flotte Google Cloud. Une fois attaché, le cluster EKS apparaît dans la console Google Cloud à côté de tous les clusters GKE natifs, peut être atteint avec `kubectl` via la **passerelle Connect** en utilisant votre identité Google (pas de identifiants AWS), et diffuse ses logs et métriques dans Cloud Logging et Cloud Monitoring.

Ce lab parcourt le cycle de vie opérationnel complet du module : le déployer, y accéder et le vérifier, l'exécuter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer. Il se concentre sur l'exploitation du **module et des deux plateformes cloud** plutôt que sur Kubernetes lui-même. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE) — ce lab ne duplique délibérément pas ce détail afin qu'il reste précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser ce qu'il provisionne sur AWS et Google Cloud.
- Confirmer que le cluster EKS est enregistré dans la flotte et l'atteindre via la passerelle Connect.
- Effectuer des opérations de jour 2 — inspecter le cluster, faire évoluer le groupe de nœuds, mettre à niveau les versions et accorder l'accès.
- Observer le cluster EKS avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- Un **compte AWS** et un utilisateur/rôle IAM autorisé à créer des ressources VPC, EKS, EC2 et IAM. Ayez votre **ID de clé d'accès** et votre **clé d'accès secrète** prêts — les deux sont des entrées de module requises.
- **gcloud CLI**, **kubectl** et le **CLI `aws`** installés ; `gcloud auth login` et `gcloud auth application-default login` terminés.
- **Propriétaire du projet** (ou équivalent) IAM sur le projet Google Cloud.
- **Votre propre projet uniquement.** Ce module masque l'option **Projet GCP sur RAD** (`enable_rad_gcpproject = false`) car il active des API que les politiques de la couche gérée par RAD refusent et attache un cluster exécuté dans un autre cloud, il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'il affiche en tant que propriétaire du projet, puis **Vérifier**) et de donner au compte de service de déploiement RAD le rôle de **Propriétaire**.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées. Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées ultérieurement avec **Mettre à jour** sur la page du déploiement après avoir coché **Activer le mode avancé**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export GCP_REGION="us-central1"        # Fleet location (gcp_location)
export AWS_REGION="us-west-2"          # AWS region for EKS (aws_region)
export CLUSTER_NAME="aws-eks-cluster"  # equals cluster_name_prefix
gcloud config set project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **AWS EKS sur GKE Fleet (EKS_GKE)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes un partenaire ou un administrateur), et définissez les entrées requises :
   - `project_id` — votre projet Google Cloud
   - `aws_access_key` et `aws_secret_key` — vos identifiants AWS (stockés de manière sensible)
   - éventuellement `trusted_users` — e-mails Google pour accorder l'accès cluster-admin

   Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/EKS_GKE) documente chaque entrée par groupe, avec des valeurs par défaut. Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec des logs en temps réel.

2. La plateforme active les API Google Cloud requises, crée le VPC et les sous-réseaux AWS sur trois zones de disponibilité, les rôles IAM, le cluster EKS et son groupe de nœuds géré, installe l'agent Connect dans le cluster, et enfin l'enregistre en tant que cluster GKE attaché dans la flotte. Les déploiements prennent généralement **20 à 30 minutes** (la création du cluster EKS domine).

3. Une fois terminé, configurez `kubectl` via la passerelle Connect — aucun identifiant AWS n'est nécessaire :

   ```bash
   gcloud container attached clusters get-credentials "$CLUSTER_NAME" \
     --location "$GCP_REGION" --project "$PROJECT"
   kubectl get nodes -o wide
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Confirmer l'enregistrement de la flotte** côté Google Cloud :

   ```bash
   gcloud container attached clusters list --location=- --project "$PROJECT"
   gcloud container fleet memberships list --project "$PROJECT"
   ```

   Dans la console, Kubernetes Engine → Clusters affiche le cluster avec **Type = Attached** et distribution **EKS**.

2. **Atteindre le cluster via la passerelle Connect** et confirmer votre accès administrateur :

   ```bash
   kubectl cluster-info        # control plane URL is connectgateway.googleapis.com/...
   kubectl get pods -A
   kubectl auth can-i '*' '*' --all-namespaces   # expect: yes
   ```

3. **Vérifier le côté EKS dans AWS :**

   ```bash
   aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION" \
     --query 'cluster.{name:name,status:status,version:version}' --output table
   ```

4. **Confirmer que l'agent Connect est connecté** (canal sortant sain) :

   ```bash
   kubectl get pods -n gke-connect
   ```

---

## Tâche 3 — Opérer (Jour 2) [Manuel] {#task-3--operate-day-2-manual}

1. **Inspecter le cluster et le groupe de nœuds :**

   ```bash
   kubectl get nodes --label-columns topology.kubernetes.io/zone
   aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" \
     --nodegroup-name "${CLUSTER_NAME}-node-group" --region "$AWS_REGION" \
     --query 'nodegroup.scalingConfig'
   ```

2. **Mettre à l'échelle le groupe de nœuds** en modifiant les entrées min/désiré/max d'instances et en cliquant sur **Mettre à jour** sur la page des détails du déploiement — le module possède la spécification du groupe de nœuds, donc la mise à l'échelle est une modification de configuration, pas une modification AWS manuelle (une modification manuelle serait annulée lors du prochain apply). Notez que la mise à l'échelle au-delà du nombre désiré nécessite un autoscaler de cluster, que ce module n'installe pas.

3. **Mettre à niveau la version de Kubernetes** en modifiant **à la fois** `k8s_version` et `platform_version` pour qu'ils correspondent aux valeurs dans la même **Mise à jour** — Google Cloud rejette une non-concordance lors de l'enregistrement.

4. **Accorder l'accès à un collègue** (deux couches — Google Cloud IAM pour la traversée de la passerelle, plus Kubernetes RBAC pour ce qu'il peut faire) :

   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member="user:colleague@example.com" --role="roles/gkehub.gatewayReader"
   kubectl create clusterrolebinding colleague-view \
     --clusterrole=view --user="colleague@example.com"
   ```

   Pour l'accès cluster-admin, ajoutez le collègue à `trusted_users` et **Mettez à jour** à la place.

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Logs** — les logs des composants système et des charges de travail sont acheminés vers Cloud Logging via l'agent Connect :

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" resource.labels.cluster_name="'"$CLUSTER_NAME"'"' \
     --project "$PROJECT" --limit 20
   ```

   Ou ouvrez Logging → Explorateur de logs et sélectionnez la ressource **Cluster Kubernetes** → votre cluster.

2. **Métriques** — la collecte Managed Prometheus est activée sur le cluster attaché. Ouvrez Monitoring → Tableaux de bord → **GKE** et sélectionnez le cluster, ou exécutez `kubectl top nodes` via la passerelle. Les mêmes tableaux de bord compatibles Kubernetes utilisés pour GKE natif s'appliquent au cluster EKS attaché.

---

## Tâche 5 — Dépannage [Manuel] {#task-5--troubleshoot-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions des modules.

- **Cluster créé sur AWS mais pas dans la flotte :** presque toujours une non-concordance `k8s_version` / `platform_version`. Vérifiez `gcloud container attached get-server-config --location "$GCP_REGION"` pour les versions de plateforme valides et redéployez avec des mineurs correspondants.
- **Agent Connect non connecté / `kubectl` via la passerelle échoue :** confirmez que les pods de l'agent sont en cours d'exécution et que le cluster a une sortie sortante vers Google Cloud :
  ```bash
  kubectl get pods -n gke-connect
  ```
  En mode sous-réseau privé, cela dépend de la passerelle NAT ; en mode sous-réseau public, de la passerelle Internet.
- **Verrouillé via la passerelle :** confirmez que votre e-mail est dans la liste d'administration du cluster (le déployeur est toujours ajouté ; les autres ont besoin de `trusted_users` ou d'une liaison RBAC) et que vous détenez un rôle IAM `roles/gkehub.gateway*`.
- **Erreurs d'API non activée pendant le déploiement :** la propagation des API Google Cloud requises peut prendre du temps ; réappliquez après une courte attente.
- **Erreurs de création de sous-réseau/VPC :** vérifiez que le nombre `subnet_availability_zones` correspond aux listes CIDR et que les AZ appartiennent à `aws_region`.
- **Auditer qui a accédé au cluster :**
  ```bash
  gcloud logging read \
    'protoPayload.serviceName="connectgateway.googleapis.com"' \
    --project "$PROJECT" --limit 20
  ```

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes spécifiques aux paramètres.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). La suppression désinstalle l'agent Connect d'EKS, supprime l'enregistrement de la flotte, puis supprime le groupe de nœuds et le cluster EKS, ainsi que le VPC et les rôles IAM AWS. Les API Google Cloud activées par le module sont intentionnellement laissées en place afin que les autres charges de travail ne soient pas perturbées.

> La suppression nécessite le même chemin réseau vers le serveur d'API EKS que celui du déploiement (pour désinstaller l'agent Connect). Si le cluster n'est plus accessible, la destruction peut bloquer.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état), utilisez plutôt **Purger** (à partir de la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Après une purge, vous devez nettoyer vous-même les ressources AWS et Google Cloud.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le VPC AWS, IAM, le cluster EKS + groupe de nœuds, et l'enregistre dans la flotte Google Cloud |
| 2 — Accéder et vérifier | Manuel | Cluster enregistré comme attaché ; accessible via la passerelle Connect avec cluster-admin |
| 3 — Opérer | Manuel | Inspecter le cluster, mettre à l'échelle le groupe de nœuds, mettre à niveau les versions, accorder l'accès |
| 4 — Observer | Manuel | Interroger les logs EKS dans Cloud Logging ; examiner les métriques dans Cloud Monitoring / Managed Prometheus |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de non-concordance de version, d'agent Connect, d'accès, de propagation d'API et de sous-réseau |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) détruit toutes les ressources du module ; Purger supprime de RAD sans détruire |
