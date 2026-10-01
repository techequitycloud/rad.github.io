---
title: "AWS EKS rattaché à une Fleet Google Cloud"
description: "Référence de configuration pour déployer EKS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/EKS_GKE.md @ 3055034 sha256:247a28814190 -->

# AWS EKS rattaché à une Fleet Google Cloud {#aws-eks-attached-to-a-google-cloud-fleet}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EKS_GKE.png" alt="AWS EKS rattaché à une Fleet Google Cloud" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module provisionne un cluster Amazon Elastic Kubernetes Service (EKS) complet sur AWS et l'enregistre auprès de Google Cloud en tant que **GKE Attached Cluster** — un membre d'une Fleet Google Cloud. Une fois rattaché, le cluster EKS apparaît dans la console Google Cloud aux côtés des clusters GKE natifs du même projet et peut être exploité de manière centralisée : il est joignable avec `kubectl` via la passerelle Connect à l'aide d'une identité Google (sans identifiants AWS), ses journaux sont envoyés à Cloud Logging et ses métriques à Cloud Monitoring / Managed Service for Prometheus.

Il s'agit d'un **module autonome**. Il ne s'appuie pas sur un socle applicatif — il crée son propre réseau AWS, ses propres rôles IAM et son propre cluster EKS, ainsi que son propre enregistrement dans une Fleet Google Cloud. Comme il touche les deux clouds, son déploiement exige des **identifiants AWS** en plus d'un projet Google Cloud.

Ce guide se concentre sur les services cloud qu'utilise le module et sur la manière de les explorer et de les exploiter depuis la console Google Cloud, la console AWS et la ligne de commande.

---

## 1. Vue d'ensemble {#1-overview}

Le module crée deux ensembles de ressources — l'un sur Google Cloud, l'autre sur AWS — puis les relie. Le plan de contrôle EKS continue de s'exécuter entièrement sur AWS ; Google Cloud obtient un canal de gestion vers celui-ci grâce à un Connect Agent, en sortie uniquement, installé dans le cluster.

| Fonctionnalité | Service | Remarques |
|---|---|---|
| Gestion de clusters multicloud | GKE Attached Clusters (GKE Multi-Cloud) | Enregistre le cluster EKS avec la distribution `eks` ; il apparaît comme cluster **Attached** dans la console |
| Appartenance à la Fleet | GKE Hub / Fleet | Le cluster rejoint la Fleet du projet, ce qui débloque Policy Controller, Config Management, les services multiclusters et Cloud Service Mesh |
| Accès `kubectl` | Passerelle Connect + Connect Agent | Exécutez `kubectl` sur EKS avec votre identité Google — sans VPN, bastion ni clés AWS |
| Journalisation | Cloud Logging | Journaux `SYSTEM_COMPONENTS` et `WORKLOADS` transférés depuis EKS |
| Surveillance | Cloud Monitoring + Managed Service for Prometheus | Collecte Managed Prometheus activée sur le cluster rattaché |
| Calcul | Amazon EKS + groupe de nœuds géré | Plan de contrôle Kubernetes géré par AWS ; 2 à 5 nœuds de calcul EC2 |
| Réseau (AWS) | AWS VPC, sous-réseaux, IGW / NAT, tables de routage | VPC dédié réparti sur trois zones de disponibilité |
| Identité (AWS) | Rôles AWS IAM | Un rôle pour le plan de contrôle EKS, un pour les nœuds de calcul |

**À savoir d'emblée :**

- **Des identifiants AWS sont requis.** Vous devez fournir `aws_access_key` et `aws_secret_key` pour un principal AWS IAM capable de créer des ressources VPC, EKS et IAM. Les deux sont stockés de manière sensible et n'apparaissent jamais dans les journaux.
- **Deux clouds, deux factures.** AWS facture le plan de contrôle EKS, les nœuds de calcul EC2 et (en mode sous-réseaux privés) la NAT Gateway. Des frais Google Cloud s'appliquent à l'utilisation de Fleet, de la journalisation et de la surveillance.
- **Le cluster EKS reste sur AWS.** Le rattachement (« Attached ») est additif — Google Cloud n'exécute pas le plan de contrôle et ne déplace pas les charges de travail. Il ajoute un plan de gestion au-dessus du cluster EKS existant.
- **Connectivité en sortie uniquement.** Le Connect Agent établit une connexion sortante vers Google Cloud sur le port 443 ; aucune règle de pare-feu AWS entrante n'est nécessaire. Cela fonctionne avec les topologies de sous-réseaux publics comme privés.
- **La personne qui déploie est toujours administrateur du cluster.** L'identité Google qui exécute le déploiement reçoit automatiquement le rôle Kubernetes `cluster-admin`, en plus de toutes les personnes listées dans `trusted_users`.
- **Les versions de Kubernetes et de la plateforme doivent correspondre.** `k8s_version` (la version mineure d'EKS) et `platform_version` (la version de GKE Attached Clusters) doivent concorder — Google Cloud le vérifie lors de l'enregistrement.
- **Les noms proviennent directement de `cluster_name_prefix`.** Les ressources AWS, l'enregistrement du cluster rattaché et l'appartenance à la Fleet utilisent tous le préfixe tel quel, sans suffixe aléatoire — deux déploiements partageant un préfixe dans le même projet entrent donc en collision côté Google Cloud.
- **Aucune base de données, aucun stockage ni aucun secret gérés.** Contrairement aux modules applicatifs, ce module provisionne uniquement le cluster, son réseau et son enregistrement dans la Fleet.

---

## 2. Services cloud et comment les explorer {#2-cloud-services--how-to-explore-them}

Les commandes Google Cloud supposent que `PROJECT`, `GCP_REGION` (l'emplacement de la Fleet) et `CLUSTER_NAME` sont définis (`CLUSTER_NAME` est la valeur de `cluster_name_prefix`). Les commandes AWS supposent que `AWS_REGION` est défini et que la CLI `aws` est configurée avec des identifiants pour le même compte.

Pour obtenir un contexte `kubectl` via la passerelle Connect (aucun identifiant AWS nécessaire) :

```bash
gcloud container attached clusters get-credentials "$CLUSTER_NAME" \
  --location "$GCP_REGION" --project "$PROJECT"
```

### A. GKE Attached Clusters (enregistrement multicloud) {#a-gke-attached-clusters-multi-cloud-registration}

L'enregistrement est le cœur du module — il communique à Google Cloud l'émetteur OIDC du cluster EKS, le projet de la Fleet, la configuration de journalisation et de surveillance, ainsi que les utilisateurs administrateurs.

- **Console :** Kubernetes Engine → Clusters. Le cluster EKS apparaît avec **Type = Attached** et la distribution **EKS** ; sa page de détails indique la version de la plateforme, l'appartenance à la Fleet et l'état de l'enregistrement.
- **CLI :**
  ```bash
  gcloud container attached clusters list --location=- --project "$PROJECT"
  gcloud container attached clusters describe "$CLUSTER_NAME" \
    --location "$GCP_REGION" --project "$PROJECT"
  # List platform versions valid for a region (use this when upgrading):
  gcloud container attached get-server-config --location "$GCP_REGION" --project "$PROJECT"
  ```

### B. Fleet (GKE Hub) et la passerelle Connect {#b-fleet-gke-hub--the-connect-gateway}

Le cluster est inscrit comme membre de la Fleet, ce qui est le prérequis des fonctionnalités à l'échelle de la Fleet et de l'accès `kubectl` via la passerelle Connect.

- **Console :** Kubernetes Engine → Fleet pour l'appartenance ; Feature Manager pour activer Policy Controller, Config Management, etc.
- **CLI :**
  ```bash
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet memberships describe "$CLUSTER_NAME" --project "$PROJECT"
  gcloud container fleet features list --project "$PROJECT"
  # After get-credentials, standard kubectl works through the gateway:
  kubectl get nodes -o wide
  kubectl get pods -A
  ```

### C. Cloud Logging {#c-cloud-logging}

Le cluster rattaché transfère les journaux des composants système Kubernetes et les journaux des charges de travail (conteneurs) vers Cloud Logging via le Connect Agent — aucun agent de journalisation à exploiter sur AWS.

- **Console :** Logging → Logs Explorer (ressource **Kubernetes Cluster** → votre cluster), ou Kubernetes Engine → Clusters → votre cluster → Logs.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_cluster" resource.labels.cluster_name="'"$CLUSTER_NAME"'"' \
    --project "$PROJECT" --limit 20
  gcloud logging read \
    'resource.type="k8s_container" resource.labels.cluster_name="'"$CLUSTER_NAME"'"' \
    --project "$PROJECT" --limit 20
  ```

### D. Cloud Monitoring et Managed Service for Prometheus {#d-cloud-monitoring--managed-service-for-prometheus}

La collecte Managed Prometheus est activée sur le cluster rattaché ; les métriques arrivent dans Cloud Monitoring avec les mêmes tableaux de bord adaptés à Kubernetes que pour GKE natif.

- **Console :** Monitoring → Dashboards → **GKE** ; Monitoring → Metrics Explorer (mode PromQL).
- **CLI :**
  ```bash
  kubectl top nodes      # via the Connect gateway
  gcloud monitoring metrics list \
    --filter='metric.type:kubernetes.io/node' --project "$PROJECT" | head
  ```

### E. Amazon EKS (plan de contrôle et groupe de nœuds) {#e-amazon-eks-control-plane--node-group}

AWS exécute le plan de contrôle Kubernetes géré ; le module ajoute un groupe de nœuds géré de nœuds de calcul EC2 (2 par défaut, 5 au maximum) répartis sur les zones de disponibilité configurées.

- **Console (AWS) :** Amazon EKS → Clusters → votre cluster ; EC2 → Instances pour les nœuds de calcul.
- **CLI :**
  ```bash
  aws eks list-clusters --region "$AWS_REGION"
  aws eks describe-cluster --name "$CLUSTER_NAME" --region "$AWS_REGION"
  aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" \
    --nodegroup-name "${CLUSTER_NAME}-node-group" --region "$AWS_REGION"
  # eksctl is an alternative interface:
  eksctl get cluster --region "$AWS_REGION"
  ```

### F. AWS VPC et réseau {#f-aws-vpc--networking}

Un VPC dédié (`10.0.0.0/16` par défaut) est créé avec des sous-réseaux répartis sur trois zones de disponibilité. Avec `enable_public_subnets = true` (valeur par défaut), les nœuds se trouvent dans des sous-réseaux publics derrière une Internet Gateway ; avec `false`, les nœuds se trouvent dans des sous-réseaux privés et sortent via une NAT Gateway.

- **Console (AWS) :** VPC → Your VPCs / Subnets / NAT Gateways / Route Tables.
- **CLI :**
  ```bash
  aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=${CLUSTER_NAME}*-vpc" --region "$AWS_REGION"
  aws ec2 describe-subnets \
    --filters "Name=tag:kubernetes.io/cluster/${CLUSTER_NAME},Values=shared" \
    --region "$AWS_REGION"
  ```

### G. Rôles AWS IAM {#g-aws-iam-roles}

Deux rôles respectant le moindre privilège sont créés : l'un assumé par le service EKS (plan de contrôle), l'autre assumé par les nœuds de calcul EC2 (portant les stratégies gérées worker, CNI et ECR en lecture seule).

- **Console (AWS) :** IAM → Roles → recherchez `${CLUSTER_NAME}`.
- **CLI :**
  ```bash
  aws iam list-attached-role-policies --role-name "${CLUSTER_NAME}-eks-role"
  aws iam list-attached-role-policies --role-name "${CLUSTER_NAME}-node-group-role"
  ```

---

## 3. Comportement {#3-behaviour}

**Lors de l'apply, le module :**

1. Active les API Google Cloud requises sur le projet cible (GKE Multi-Cloud, GKE Connect, Connect Gateway, GKE Hub, Anthos, Cloud Resource Manager, Logging, Monitoring, Ops Config Monitoring, Kubernetes Metadata).
2. Crée le VPC AWS, les sous-réseaux, le routage et — selon la topologie — l'Internet Gateway ou la NAT Gateway (avec une Elastic IP).
3. Crée les deux rôles AWS IAM et y associe les stratégies gérées requises par EKS.
4. Crée le cluster EKS et son groupe de nœuds géré, en s'assurant au préalable que les rôles IAM existent.
5. Installe le Connect Agent dans le cluster (livré sous forme de manifeste d'installation géré par Helm, récupéré depuis Google Cloud) afin qu'il puisse établir le canal de gestion sortant.
6. Enregistre le cluster en tant que GKE Attached Cluster — en transmettant l'URL de l'émetteur OIDC d'EKS, le projet de la Fleet, la journalisation système et des charges de travail, Managed Prometheus et la liste des utilisateurs administrateurs.

**Modèle d'accès via la passerelle Connect.** Les identités Google autorisées (la personne qui déploie, plus toutes celles listées dans `trusted_users`) reçoivent le rôle Kubernetes `cluster-admin` sur le cluster EKS. Elles y accèdent via la passerelle Connect : Google Cloud authentifie l'identité, la compare à la liste des administrateurs du cluster et relaie la requête via le Connect Agent jusqu'au serveur d'API EKS. Aucun identifiant AWS, VPN ni bastion n'intervient. Accorder l'accès à d'autres personnes passe par deux niveaux — un rôle Google Cloud IAM pour traverser la passerelle (par exemple `roles/gkehub.gatewayReader` / `gatewayEditor`) et une liaison RBAC Kubernetes pour ce qu'elles peuvent faire une fois la passerelle franchie.

**Confiance OIDC.** Chaque cluster EKS exécute son propre fournisseur OIDC. Le module enregistre l'URL de cet émetteur auprès de Google Cloud afin que les jetons émis par EKS puissent être vérifiés par Google Cloud sans qu'aucune clé statique ne transite d'un cloud à l'autre — le même modèle de confiance que Workload Identity sur GKE natif.

**Suivi manuel.** Le module enregistre et observe le cluster, mais ne déploie pas vos applications, n'installe pas d'autoscaler de cluster et n'active pas les fonctionnalités de la Fleet. Après le déploiement, vous devez généralement : configurer `kubectl` via la passerelle, déployer les charges de travail et, si vous le souhaitez, activer Policy Controller, Config Management ou Cloud Service Mesh depuis le Feature Manager de la Fleet. Un assistant Anthos Service Mesh existe sous forme de sous-composant distinct et ne fait **pas** partie de l'apply principal.

**Remarques sur l'exécution.**

- La valeur `node_group_max_size` du groupe de nœuds n'est qu'un plafond — une montée en charge effective au-delà du nombre souhaité nécessite un autoscaler de cluster, que ce module n'installe pas.
- Mettre à niveau Kubernetes implique d'augmenter **à la fois** `k8s_version` et `platform_version` vers des versions concordantes dans le même déploiement.
- La montée en charge des nœuds de calcul et les mises à jour d'AMI lors des montées de version sont gérées par le groupe de nœuds géré EKS.
- Les API Google Cloud activées ne sont volontairement **pas** désactivées lors de la suppression, afin de ne pas perturber les autres charges de travail du projet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud de destination dans lequel le cluster est enregistré comme membre de la Fleet. Doit déjà exister. |
| `gcp_location` | `us-central1` | Région Google Cloud dans laquelle le cluster rattaché est enregistré et apparaît dans la console. Doit prendre en charge GKE Attached Clusters. |
| `aws_region` | `us-west-2` | Région AWS du cluster EKS, du VPC et des ressources associées. `subnet_availability_zones` doit contenir des zones de disponibilité valides de cette région. |
| `aws_access_key` | _(obligatoire, sensible)_ | Access Key ID AWS du principal IAM qui provisionne les ressources EKS. Stockée de manière sensible. |
| `aws_secret_key` | _(obligatoire, sensible)_ | Secret Access Key AWS associée à `aws_access_key`. Stockée de manière sensible ; récupérez-la au moment de la création de la clé (elle n'est plus récupérable ensuite). |
| `trusted_users` | _(obligatoire)_ | Adresses e-mail de comptes Google recevant le rôle Kubernetes `cluster-admin` via la passerelle Connect. Il n'y a pas de valeur par défaut — fournissez une liste vide `[]` pour n'accorder cluster-admin qu'à la personne qui déploie (elle est toujours incluse automatiquement). Les entrées doivent être non vides et uniques. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `vpc_cidr_block` | `10.0.0.0/16` | CIDR IPv4 du VPC AWS. Évitez tout chevauchement avec les VPC que vous pourriez appairer. |
| `public_subnet_cidr_blocks` | `10.0.101.0/24`, `10.0.102.0/24`, `10.0.103.0/24` | CIDR des sous-réseaux publics, un par zone de disponibilité. Utilisés lorsque `enable_public_subnets = true`. Doivent être des sous-ensembles de `vpc_cidr_block`. |
| `private_subnet_cidr_blocks` | `10.0.1.0/24`, `10.0.2.0/24`, `10.0.3.0/24` | CIDR des sous-réseaux privés, un par zone de disponibilité. Utilisés lorsque `enable_public_subnets = false`. Doivent être des sous-ensembles de `vpc_cidr_block`. |
| `subnet_availability_zones` | `us-west-2a`, `us-west-2b`, `us-west-2c` | Zones de disponibilité AWS dans lesquelles créer les sous-réseaux. Leur nombre doit correspondre aux deux listes de CIDR, et elles doivent appartenir à `aws_region`. |
| `enable_public_subnets` | `true` | `true` : nœuds dans des sous-réseaux publics derrière une Internet Gateway (plus simple, moins cher — adapté aux labs). `false` (sous-réseaux privés avec sortie via NAT Gateway) n'est **actuellement pas utilisable** : la NAT Gateway est placée dans un sous-réseau public, mais aucun sous-réseau public n'est créé lorsque ce flag vaut `false`, si bien que l'apply échoue. Laissez-le à `true`. |

### Groupe 3 — Plateforme {#group-3--platform}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cluster_name_prefix` | `aws-eks-cluster` | Préfixe des noms générés ; également utilisé tel quel comme nom du cluster rattaché et de l'appartenance à la Fleet. Lettres minuscules, chiffres et traits d'union uniquement. |
| `platform_version` | `1.35.0-gke.1` | Version de la plateforme GKE Attached Clusters (qui régit le Connect Agent). Doit correspondre à la version mineure de `k8s_version`. |
| `k8s_version` | `1.35` | Version mineure de Kubernetes sur EKS. Doit être prise en charge par EKS dans `aws_region` ; le niveau de correctif est géré par EKS. |
| `node_group_desired_size` | `2` | Nombre de nœuds de calcul au moment du déploiement. Doit être compris entre le minimum et le maximum. |
| `node_group_max_size` | `5` | Plafond de mise à l'échelle automatique du groupe de nœuds (nécessite un autoscaler de cluster pour monter réellement en charge). |
| `node_group_min_size` | `2` | Plancher du groupe de nœuds ; 2 est recommandé pour la haute disponibilité. |

---

## 5. Sorties {#5-outputs}

Les sorties Terraform du module sont `deployment_id` (l'ID de déploiement résolu — la valeur que vous avez fournie, ou un identifiant hexadécimal généré automatiquement si aucun n'a été fourni) et `project_id` (le projet Google Cloud dans lequel le cluster est enregistré). Aucune ne permet de localiser le cluster lui-même ; notez donc les identifiants suivants après un déploiement réussi afin de pouvoir le localiser et l'exploiter :

| Identifiant | Comment l'obtenir |
|---|---|
| Nom du cluster rattaché | `gcloud container attached clusters list --location=- --project "$PROJECT"` (égal à `cluster_name_prefix`) |
| Nom de l'appartenance à la Fleet | `gcloud container fleet memberships list --project "$PROJECT"` |
| kubeconfig de la passerelle Connect | `gcloud container attached clusters get-credentials <name> --location "$GCP_REGION" --project "$PROJECT"` |
| URL de l'émetteur OIDC | `gcloud container attached clusters describe <name> --location "$GCP_REGION" --format="value(oidcConfig.issuerUrl)"` |
| Point de terminaison / état du cluster EKS | `aws eks describe-cluster --name <name> --region "$AWS_REGION"` |
| ID du VPC / des sous-réseaux | `aws ec2 describe-vpcs` / `describe-subnets` filtrés par les tags `${CLUSTER_NAME}` |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `aws_access_key` / `aws_secret_key` | clés valides avec des droits EKS + VPC + IAM | Critical | Des identifiants manquants ou aux privilèges insuffisants font échouer l'apply en cours de route, ce qui peut laisser des ressources AWS partielles à nettoyer à la main. |
| `k8s_version` + `platform_version` | versions mineures concordantes (`1.35` / `1.35.0-gke.1`) | Critical | Une discordance est rejetée lors de l'enregistrement ; le cluster EKS est créé sur AWS mais n'est jamais rattaché à la Fleet. |
| `cluster_name_prefix` (unicité) | unique par projet | Critical | L'appartenance à la Fleet utilise le préfixe tel quel — deux déploiements partageant un préfixe dans le même projet entrent en collision côté Google Cloud. |
| `deployment_id` / `cluster_name_prefix` | définis une seule fois | Critical | Les modifier après le premier déploiement force la recréation des ressources nommées — le cluster est détruit puis reconstruit. |
| `trusted_users` | adresses e-mail Google réelles | High | Une liste erronée ou vide signifie que seule la personne qui déploie peut accéder au cluster via la passerelle ; les autres sont bloqués jusqu'à l'ajout manuel d'un RBAC. |
| `subnet_availability_zones` par rapport aux listes de CIDR | longueurs égales, zones dans `aws_region` | High | Des nombres discordants ou des zones hors région font échouer la création des sous-réseaux et bloquent le cluster EKS. |
| `enable_public_subnets` | `true` (seule valeur prise en charge aujourd'hui) | High | Les sous-réseaux publics donnent des IP publiques aux nœuds de calcul — une surface d'attaque plus large. `false` est la topologie la plus sûre, mais elle est actuellement cassée : la NAT Gateway est placée dans un sous-réseau public qui n'est pas créé dans ce mode, si bien que l'apply échoue. |
| `vpc_cidr_block` | `/16` sans chevauchement | High | Un chevauchement avec un VPC appairé casse le routage si un appairage est ajouté ultérieurement. |
| Chemin réseau lors de la suppression | même chemin que pour le déploiement | High | La destruction doit atteindre le serveur d'API EKS pour désinstaller le Connect Agent ; si le cluster est injoignable, la suppression reste bloquée. |
| `node_group_min_size` | `2`+ | Medium | Un seul nœud supprime la haute disponibilité ; une maintenance de nœud peut mettre hors ligne toute la capacité du cluster. |
| `node_group_max_size` | dimensionné pour les pics | Medium | Le plafond n'a aucun effet sans autoscaler de cluster installé ; l'augmenter seul ne change rien. |
| NAT Gateway (mode privé) | à budgéter | Medium | Le mode sous-réseaux privés ajoute sur AWS des frais horaires de NAT Gateway et des frais de transfert de données. |

---

Pour une présentation conceptuelle plus approfondie — fédération OIDC, fonctionnalités de la Fleet (Policy Controller, Config Management, services multiclusters), Managed Prometheus et le module complémentaire facultatif Anthos Service Mesh — consultez la [documentation GKE Attached Clusters](https://cloud.google.com/kubernetes-engine/multi-cloud/docs/attached/eks/create-cluster).
