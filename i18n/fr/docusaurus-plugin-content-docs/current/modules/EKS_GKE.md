---
title: "EKS AWS attaché à une flotte Google Cloud"
description: "Référence de configuration pour le déploiement d'EKS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/EKS_GKE.md @ e69407af sha256:910329c6b222 -->

# EKS AWS attaché à une flotte Google Cloud {#aws-eks-attached-to-a-google-cloud-fleet}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EKS_GKE.png" alt="EKS AWS attaché à une flotte Google Cloud" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module provisionne un cluster Amazon Elastic Kubernetes Service (EKS) complet sur AWS et l'enregistre auprès de Google Cloud en tant que **cluster GKE attaché** — un membre d'une flotte Google Cloud. Une fois attaché, le cluster EKS apparaît dans la console Google Cloud à côté de tous les clusters GKE natifs du même projet et peut être opéré de manière centralisée : accessible avec `kubectl` via la passerelle Connect en utilisant une identité Google (pas de justificatifs AWS), avec ses logs acheminés vers Cloud Logging et ses métriques vers Cloud Monitoring / Managed Service for Prometheus.

Il s'agit d'un **module autonome**. Il ne s'appuie pas sur une base d'application — il crée son propre réseau AWS, IAM et cluster EKS, ainsi que sa propre inscription à la flotte Google Cloud. Parce qu'il touche les deux clouds, son déploiement nécessite des **justificatifs AWS** en plus d'un projet Google Cloud.

Ce guide se concentre sur les services cloud que le module utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud, la console AWS et la ligne de commande.

---

## Coût d'EKS sur RAD et comparaison {#what-eks-costs-on-rad-and-how-that-compares}

**Côté Google Cloud, l'attachement d'un cluster EKS à une flotte coûte environ 24 US$ par mois, et
RAD ne facture aucun frais de module pour cela.** L'empreinte GCP de ce module est un petit agent Connect
et le réseau qui l'entoure — le coût propre du cluster EKS (le plan de contrôle AWS et ses
nœuds de travail) vous est facturé par **AWS, séparément**, et n'est pas couvert ici ni modifié par
quoi que ce soit ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | Aucun | Aucun |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud (Agent Connect + Flotte) | Facturé par Google à votre propre compte de facturation, environ **24,04 US$ par mois** (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **43 crédits par jour**, environ 1 290 par mois (environ 129 US$ au prix de la recharge) |
| Coût d'exécution AWS (le cluster EKS lui-même) | Facturé par **Amazon**, à votre compte AWS, séparément — non couvert par ce tableau | Idem — RAD ne mesure ni ne revend les dépenses AWS |
| Qui possède quoi | Vous possédez le projet GCP et sa facturation ; RAD déploie et met à jour l'enregistrement de la flotte | RAD possède le projet GCP, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google, côté GCP uniquement) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 Gio (l'Agent Connect) | 18,04 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (côté GCP)** | **environ 24,04 US$** |

Ceci n'inclut **pas** le cluster AWS EKS lui-même — les coûts de son plan de contrôle et de ses nœuds de travail
sont fixés par la propre tarification d'AWS et facturés directement à votre compte AWS.

### Comparaison {#how-it-compares}

- Il n'existe pas de produit commercial "attacher EKS à GKE" à comparer — il s'agit d'une fonctionnalité de la console Google Cloud
  (Clusters GKE attachés / Flotte) pour gérer un cluster que vous exécutez déjà sur AWS,
  pas une application hébergée avec un prix SaaS concurrent. L'alternative est d'atteindre le même cluster EKS
  comme vous le feriez sans ce module : vos propres justificatifs AWS et configuration `kubectl`,
  sans vue console unifiée, sans intégration Cloud Logging/Monitoring, et sans chiffre mensuel distinct
  à citer — le coût est alors le temps d'ingénierie, pas une ligne de dépense.
- Ce que vous obtenez pour environ 24 US$ par mois, c'est l'Agent Connect, l'adhésion à la flotte et la
  vue console unifiée (logs dans Cloud Logging, métriques dans Cloud Monitoring / Managed Service for
  Prometheus, accès `kubectl` via une identité Google sans justificatifs AWS nécessaires au quotidien).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si le côté GCP de ce module s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet
délie d'abord sa facturation, puis demande à Google de le supprimer — récupérable pendant 30 jours, sans
rien facturer côté GCP pendant l'attente. La restauration (par le propriétaire du projet, dans les 30 jours)
annule la suppression du projet, rattache la facturation, et une **Mise à jour** sur le déploiement
reconfirme l'enregistrement de la flotte — une vérification, pas une reconstruction, pour **une poignée de crédits (moins de 1 US$)**.

- **Ceci ne touche pas à AWS.** La suppression du projet GCP ne supprime **pas**, n'arrête pas, ni ne met en pause le
  cluster EKS lui-même, et n'empêche **pas** AWS de vous le facturer. La seule chose mise en pause est
  le petit Agent Connect côté GCP et l'enregistrement de la flotte. Si vous voulez arrêter de payer AWS aussi,
  vous devez supprimer ou réduire le cluster EKS côté AWS également — ce module ne le fait pas
  pour vous.
- **Ce que cela nécessite.** Vous devez posséder le projet GCP et le restaurer vous-même dans les 30 jours.
  Votre solde de crédits achetés doit toujours dépasser le seuil du niveau sandbox (100 crédits) lors de la
  restauration, comme pour tout autre projet géré par RAD.
- **Pas de véritable lacune de sauvegarde ici.** Ce module ne conserve aucune donnée d'application propre côté GCP
  — les charges de travail du cluster EKS et leurs données vivent sur AWS, intactes par tout ce qui est décrit ci-dessus.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Puisqu'il n'y a pas de frais de module, redéployer ce module à partir de zéro coûte déjà presque
rien — environ **4 à 5 crédits** (moins de 1 US$) et environ une heure, car il n'y a pas de frais de module à
payer à nouveau, seulement le build. Cela fait de l'option "Mettre en pause gratuitement" ci-dessus principalement une commodité
(rien à reconfigurer) plutôt qu'une grande économie côté GCP spécifiquement — l'argent réel en jeu
est presque toujours le cluster AWS EKS, que ni l'une ni l'autre option ne modifie.

- **Supprimez ce que ce module utilise.** L'Agent Connect côté GCP et l'enregistrement de la flotte s'arrêtent
  immédiatement ; le cluster AWS EKS n'est pas touché dans les deux cas, et son propre coût continue de courir sur AWS
  jusqu'à ce que vous agissiez de ce côté séparément.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous, et rattacher un
  cluster réexécute le provisionnement côté AWS pour le rôle IAM de l'Agent Connect ; gardez une note de
  nom et de la région de votre cluster EKS.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  son propre déploiement de ce module dans un projet Google Cloud pendant 15 minutes à 24 heures,
  dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant
  paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés retournent au
  formateur. **Les coûts AWS pour le cluster EKS lui-même ne font pas partie de cette allocation** et restent
  la responsabilité de la personne qui détient le compte AWS sur lequel le cluster s'exécute.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute ce module pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client, côté GCP. Si le
  portefeuille est faible, la facturation est mise en pause et les données sont conservées, afin que personne ne reçoive de frais inattendus.
  À la fin, le partenaire transfère le projet et le déploiement devient la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration. Les coûts AWS EKS et réseau sont fixés par la propre
tarification d'Amazon, non reproduite ici.

## 1. Vue d'ensemble {#1-overview}

Le module crée deux ensembles de ressources — un sur Google Cloud, un sur AWS — puis les connecte. Le plan de contrôle EKS continue de fonctionner entièrement sur AWS ; Google Cloud obtient un canal de gestion vers celui-ci via un Agent Connect sortant installé à l'intérieur du cluster.

| Capacité | Service | Notes |
|---|---|---|
| Gestion de cluster multi-cloud | Clusters GKE attachés (GKE Multi-Cloud) | Enregistre le cluster EKS avec la distribution `eks` ; il apparaît comme un cluster **attaché** dans la console |
| Adhésion à la flotte | GKE Hub / Flotte | Le cluster s'inscrit dans la flotte du projet, débloquant Policy Controller, Config Management, les services multi-clusters et Cloud Service Mesh |
| Accès `kubectl` | Passerelle Connect + Agent Connect | Exécutez `kubectl` contre EKS en utilisant votre identité Google — pas de VPN, de bastion ou de clés AWS |
| Journalisation | Cloud Logging | Logs `SYSTEM_COMPONENTS` et `WORKLOADS` transférés depuis EKS |
| Surveillance | Cloud Monitoring + Managed Service for Prometheus | Collecte Prometheus gérée activée sur le cluster attaché |
| Calcul | Amazon EKS + groupe de nœuds géré | Plan de contrôle Kubernetes géré par AWS ; 2 à 5 nœuds de travail EC2 |
| Réseau (AWS) | AWS VPC, sous-réseaux, IGW / NAT, tables de routage | VPC dédié sur trois zones de disponibilité |
| Identité (AWS) | Rôles IAM AWS | Un rôle pour le plan de contrôle EKS, un pour les nœuds de travail |

**À savoir d'emblée :**

- **Des justificatifs AWS sont requis.** Vous devez fournir `aws_access_key` et `aws_secret_key` pour un principal AWS IAM capable de créer des ressources VPC, EKS et IAM. Les deux sont stockés de manière sensible et ne sont jamais affichés dans les logs.
- **Deux clouds, deux factures.** AWS facture le plan de contrôle EKS, les nœuds de travail EC2 et (en mode sous-réseau privé) la passerelle NAT. Les frais Google Cloud s'appliquent à l'utilisation de la flotte, de la journalisation et de la surveillance.
- **Le cluster EKS reste sur AWS.** "Attaché" est additif — Google Cloud n'exécute pas le plan de contrôle ni ne déplace les charges de travail. Il ajoute un plan de gestion au-dessus du cluster EKS existant.
- **Connectivité sortante uniquement.** L'Agent Connect se connecte à Google Cloud sur le port 443 ; aucune règle de pare-feu AWS entrante n'est requise. Cela fonctionne dans les topologies de sous-réseaux publics et privés.
- **Le déployeur est toujours un administrateur de cluster.** L'identité Google exécutant le déploiement se voit automatiquement accorder `cluster-admin` Kubernetes, en plus de toute personne listée dans `trusted_users`.
- **Les versions de Kubernetes et de la plateforme doivent correspondre.** `k8s_version` (la version mineure d'EKS) et `platform_version` (la version des clusters GKE attachés) doivent correspondre — Google Cloud valide cela lors de l'enregistrement.
- **Les noms proviennent directement de `cluster_name_prefix`.** Les ressources AWS et l'enregistrement du cluster attaché ainsi que l'adhésion à la flotte utilisent le préfixe tel quel, sans suffixe aléatoire — donc deux déploiements partageant un préfixe dans le même projet entreront en collision côté Google Cloud.
- **Pas de base de données, de stockage ou de secrets gérés.** Contrairement aux modules d'application, ce module ne provisionne que le cluster, son réseau et son enregistrement de flotte.

---

## 2. Services Cloud et comment les explorer {#2-cloud-services--how-to-explore-them}

Les commandes Google Cloud supposent que `PROJECT`, `GCP_REGION` (l'emplacement de la flotte) et `CLUSTER_NAME` sont définis (`CLUSTER_NAME` est la valeur de `cluster_name_prefix`). Les commandes AWS supposent que `AWS_REGION` est défini et que la CLI `aws` est configurée avec des justificatifs pour le même compte.

Pour obtenir un contexte `kubectl` via la passerelle Connect (aucun justificatif AWS nécessaire) :

```bash
gcloud container attached clusters get-credentials "$CLUSTER_NAME" \
  --location "$GCP_REGION" --project "$PROJECT"
```

### A. Clusters GKE attachés (enregistrement multi-cloud) {#a-gke-attached-clusters-multi-cloud-registration}

L'enregistrement est le cœur du module — il indique à Google Cloud l'émetteur OIDC du cluster EKS, le projet de la flotte, la configuration de la journalisation/surveillance et les utilisateurs administrateurs.

- **Console :** Kubernetes Engine → Clusters. Le cluster EKS apparaît avec **Type = Attached** et distribution **EKS** ; sa page de détails affiche la version de la plateforme, l'adhésion à la flotte et l'état de l'enregistrement.
- **CLI :**
  ```bash
  gcloud container attached clusters list --location=- --project "$PROJECT"
  gcloud container attached clusters describe "$CLUSTER_NAME" \
    --location "$GCP_REGION" --project "$PROJECT"
  # List platform versions valid for a region (use this when upgrading):
  gcloud container attached get-server-config --location "$GCP_REGION" --project "$PROJECT"
  ```

### B. Flotte (GKE Hub) et la passerelle Connect {#b-fleet-gke-hub--the-connect-gateway}

Le cluster est inscrit en tant que membre de la flotte, ce qui est le prérequis pour les fonctionnalités à l'échelle de la flotte et pour l'accès `kubectl` via la passerelle Connect.

- **Console :** Kubernetes Engine → Flotte pour l'adhésion ; Feature Manager pour activer Policy Controller, Config Management, etc.
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

Le cluster attaché transfère les logs des composants système Kubernetes et les logs des charges de travail (conteneurs) vers Cloud Logging via l'Agent Connect — aucun agent de log à opérer sur AWS.

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

La collecte Prometheus gérée est activée sur le cluster attaché ; les métriques atterrissent dans Cloud Monitoring avec les mêmes tableaux de bord Kubernetes-aware utilisés pour GKE natif.

- **Console :** Monitoring → Tableaux de bord → **GKE** ; Monitoring → Metrics Explorer (mode PromQL).
- **CLI :**
  ```bash
  kubectl top nodes      # via the Connect gateway
  gcloud monitoring metrics list \
    --filter='metric.type:kubernetes.io/node' --project "$PROJECT" | head
  ```

### E. Amazon EKS (plan de contrôle et groupe de nœuds) {#e-amazon-eks-control-plane--node-group}

AWS exécute le plan de contrôle Kubernetes géré ; le module ajoute un groupe de nœuds géré de travailleurs EC2 (2 par défaut, 5 max) répartis sur les zones de disponibilité configurées.

- **Console (AWS) :** Amazon EKS → Clusters → votre cluster ; EC2 → Instances pour les nœuds de travail.
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

Un VPC dédié (par défaut `10.0.0.0/16`) est créé avec des sous-réseaux sur trois AZ. Avec `enable_public_subnets = true` (par défaut), les nœuds se trouvent dans des sous-réseaux publics derrière une passerelle Internet ; avec `false`, les nœuds se trouvent dans des sous-réseaux privés et sortent via une passerelle NAT.

- **Console (AWS) :** VPC → Vos VPC / Sous-réseaux / Passerelles NAT / Tables de routage.
- **CLI :**
  ```bash
  aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=${CLUSTER_NAME}*-vpc" --region "$AWS_REGION"
  aws ec2 describe-subnets \
    --filters "Name=tag:kubernetes.io/cluster/${CLUSTER_NAME},Values=shared" \
    --region "$AWS_REGION"
  ```

### G. Rôles IAM AWS {#g-aws-iam-roles}

Deux rôles à moindre privilège sont créés : l'un assumé par le service EKS (plan de contrôle), l'autre assumé par les nœuds de travail EC2 (portant les politiques gérées de travailleur, CNI et ECR en lecture seule).

- **Console (AWS) :** IAM → Rôles → rechercher `${CLUSTER_NAME}`.
- **CLI :**
  ```bash
  aws iam list-attached-role-policies --role-name "${CLUSTER_NAME}-eks-role"
  aws iam list-attached-role-policies --role-name "${CLUSTER_NAME}-node-group-role"
  ```

---

## 3. Comportement {#3-behaviour}

**Lors de l'apply, le module :**

1. Active les API Google Cloud requises sur le projet cible (GKE Multi-Cloud, GKE Connect, Connect Gateway, GKE Hub, Anthos, Cloud Resource Manager, Logging, Monitoring, Ops Config Monitoring, Kubernetes Metadata).
2. Crée le VPC AWS, les sous-réseaux, le routage et — selon la topologie — la passerelle Internet ou la passerelle NAT (avec une adresse IP élastique).
3. Crée les deux rôles IAM AWS et attache les politiques gérées requises par EKS.
4. Crée le cluster EKS et son groupe de nœuds géré, en s'assurant que les rôles IAM existent d'abord.
5. Installe l'Agent Connect dans le cluster (livré sous forme de manifeste d'installation géré par Helm récupéré depuis Google Cloud) afin qu'il puisse établir le canal de gestion sortant.
6. Enregistre le cluster en tant que cluster GKE attaché — en transmettant l'URL de l'émetteur OIDC EKS, le projet de la flotte, la journalisation système + charge de travail, Managed Prometheus et la liste des utilisateurs administrateurs.

**Modèle d'accès à la passerelle Connect.** Les identités Google autorisées (le déployeur, plus toutes les personnes figurant dans `trusted_users`) se voient accorder `cluster-admin` Kubernetes sur le cluster EKS. Elles y accèdent via la passerelle Connect : Google Cloud authentifie l'identité, la vérifie par rapport à la liste d'administrateurs du cluster et transmet la requête via l'Agent Connect au serveur d'API EKS. Aucun justificatif AWS, VPN ou bastion n'est impliqué. L'octroi d'accès à des personnes supplémentaires nécessite deux couches — un rôle IAM Google Cloud pour la traversée de la passerelle (par exemple `roles/gkehub.gatewayReader` / `gatewayEditor`) et une liaison RBAC Kubernetes pour ce qu'elles peuvent faire une fois passées.

**Confiance OIDC.** Chaque cluster EKS exécute son propre fournisseur OIDC. Le module enregistre cette URL d'émetteur auprès de Google Cloud afin que les jetons émis par EKS puissent être vérifiés par Google Cloud sans que des clés statiques ne traversent les clouds — le même modèle de confiance que l'identité de charge de travail GKE native.

**Suivi manuel.** Le module enregistre et observe le cluster mais ne déploie pas vos applications, n'installe pas d'autoscaler de cluster ni n'active les fonctionnalités de la flotte. Après le déploiement, vous configurez généralement `kubectl` via la passerelle, déployez les charges de travail et activez éventuellement Policy Controller, Config Management ou Cloud Service Mesh à partir du gestionnaire de fonctionnalités de la flotte. Un assistant Anthos Service Mesh existe en tant que sous-composant séparé et ne fait **pas** partie de l'apply principal.

**Notes d'exécution.**

- Le `node_group_max_size` du groupe de nœuds n'est qu'un plafond — la mise à l'échelle réelle au-delà du nombre souhaité nécessite un autoscaler de cluster, que ce module n'installe pas.
- La mise à niveau de Kubernetes signifie l'augmentation des versions correspondantes de `k8s_version` et `platform_version` dans le même déploiement.
- La mise à l'échelle des nœuds de travail et les mises à jour d'AMI lors des mises à niveau de version sont gérées par le groupe de nœuds géré par EKS.
- Les API Google Cloud activées ne sont intentionnellement **pas** désactivées lors de la suppression, afin d'éviter de perturber d'autres charges de travail dans le projet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud de destination où le cluster est enregistré en tant que membre de la flotte. Doit déjà exister. |
| `gcp_location` | `us-central1` | Région Google Cloud où le cluster attaché est enregistré et apparaît dans la console. Doit prendre en charge les clusters GKE attachés. |
| `aws_region` | `us-west-2` | Région AWS pour le cluster EKS, le VPC et les ressources de support. `subnet_availability_zones` doit être des AZ valides dans cette région. |
| `aws_access_key` | _(requis, sensible)_ | ID de clé d'accès AWS pour le principal IAM qui provisionne les ressources EKS. Stocké de manière sensible. |
| `aws_secret_key` | _(requis, sensible)_ | Clé d'accès secrète AWS associée à `aws_access_key`. Stockée de manière sensible ; l'obtenir au moment de la création de la clé (elle n'est pas récupérable par la suite). |
| `trusted_users` | _(requis)_ | Adresses e-mail des comptes Google auxquelles `cluster-admin` Kubernetes est accordé via la passerelle Connect. Il n'y a pas de valeur par défaut — fournissez une liste vide `[]` pour accorder l'administrateur de cluster uniquement au déployeur (le déployeur est toujours inclus automatiquement). Les entrées doivent être non vides et uniques. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `vpc_cidr_block` | `10.0.0.0/16` | CIDR IPv4 pour le VPC AWS. Évitez les chevauchements avec les VPC avec lesquels vous pourriez vous appairer. |
| `public_subnet_cidr_blocks` | `10.0.101.0/24`, `10.0.102.0/24`, `10.0.103.0/24` | CIDR pour les sous-réseaux publics, un par AZ. Utilisé lorsque `enable_public_subnets = true`. Doit être des sous-ensembles de `vpc_cidr_block`. |
| `private_subnet_cidr_blocks` | `10.0.1.0/24`, `10.0.2.0/24`, `10.0.3.0/24` | CIDR pour les sous-réseaux privés, un par AZ. Utilisé lorsque `enable_public_subnets = false`. Doit être des sous-ensembles de `vpc_cidr_block`. |
| `subnet_availability_zones` | `us-west-2a`, `us-west-2b`, `us-west-2c` | Zones de disponibilité AWS dans lesquelles créer des sous-réseaux. Le nombre doit correspondre aux deux listes CIDR, et les AZ doivent appartenir à `aws_region`. |
| `enable_public_subnets` | `true` | `true` : les nœuds dans des sous-réseaux publics derrière une passerelle Internet (plus simple, moins cher — bon pour les labs). `false` (sous-réseaux privés avec sortie via passerelle NAT) n'est **pas utilisable actuellement** : la passerelle NAT est placée dans un sous-réseau public, mais aucun sous-réseau public n'est créé lorsque ce drapeau est `false`, donc l'apply échoue. Laissez-le à `true`. |

### Groupe 3 — Plateforme {#group-3--platform}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cluster_name_prefix` | `aws-eks-cluster` | Préfixe pour les noms générés ; également utilisé tel quel comme nom du cluster attaché et de l'adhésion à la flotte. Lettres minuscules, chiffres et tirets uniquement. |
| `platform_version` | `1.35.0-gke.1` | Version de la plateforme GKE Attached Clusters (gouverne l'Agent Connect). Doit correspondre à la version mineure `k8s_version`. |
| `k8s_version` | `1.35` | Version mineure de Kubernetes sur EKS. Doit être prise en charge par EKS dans `aws_region` ; le niveau de patch est géré par EKS. |
| `node_group_desired_size` | `2` | Nœuds de travail au moment du déploiement. Doit être compris entre min/max. |
| `node_group_max_size` | `5` | Plafond d'autoscaling pour le groupe de nœuds (nécessite un autoscaler de cluster pour réellement mettre à l'échelle). |
| `node_group_min_size` | `2` | Plancher pour le groupe de nœuds ; 2 est recommandé pour la haute disponibilité. |

---

## 5. Sorties {#5-outputs}

Les sorties Terraform du module sont `deployment_id` (l'ID de déploiement résolu — la valeur que vous avez fournie, ou un hexadécimal auto-généré si aucune n'a été donnée) et `project_id` (le projet Google Cloud dans lequel le cluster est enregistré). Aucune ne localise le cluster lui-même, alors enregistrez les identifiants suivants après un déploiement réussi afin de pouvoir le localiser et l'opérer :

| Identifiant | Comment l'obtenir |
|---|---|
| Nom du cluster attaché | `gcloud container attached clusters list --location=- --project "$PROJECT"` (égal à `cluster_name_prefix`) |
| Nom de l'adhésion à la flotte | `gcloud container fleet memberships list --project "$PROJECT"` |
| Kubeconfig de la passerelle Connect | `gcloud container attached clusters get-credentials <name> --location "$GCP_REGION" --project "$PROJECT"` |
| URL de l'émetteur OIDC | `gcloud container attached clusters describe <name> --location "$GCP_REGION" --format="value(oidcConfig.issuerUrl)"` |
| Point de terminaison / état du cluster EKS | `aws eks describe-cluster --name <name> --region "$AWS_REGION"` |
| ID de VPC / sous-réseau | `aws ec2 describe-vpcs` / `describe-subnets` filtrés par les balises `${CLUSTER_NAME}` |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `aws_access_key` / `aws_secret_key` | clés valides avec droits EKS + VPC + IAM | Critique | Des justificatifs manquants ou sous-privilégiés font échouer l'apply à mi-parcours, laissant potentiellement des ressources AWS partielles à nettoyer manuellement. |
| `k8s_version` + `platform_version` | versions mineures correspondantes (`1.35` / `1.35.0-gke.1`) | Critique | Une non-concordance est rejetée lors de l'enregistrement ; le cluster EKS est créé sur AWS mais ne s'attache jamais à la flotte. |
| `cluster_name_prefix` (unicité) | unique par projet | Critique | L'adhésion à la flotte utilise le préfixe tel quel — deux déploiements partageant un préfixe dans le même projet entrent en collision côté Google Cloud. |
| `deployment_id` / `cluster_name_prefix` | défini une seule fois | Critique | La modification après le premier déploiement force la recréation des ressources nommées — le cluster est détruit et reconstruit. |
| `trusted_users` | vraies adresses e-mail Google | Élevé | Une liste erronée ou vide signifie que seul le déployeur peut atteindre le cluster via la passerelle ; les autres sont bloqués jusqu'à ce que le RBAC soit ajouté manuellement. |
| `subnet_availability_zones` vs listes CIDR | longueurs égales, AZ dans `aws_region` | Élevé | Des comptes non concordants ou des AZ hors région font échouer la création de sous-réseaux et bloquent le cluster EKS. |
| `enable_public_subnets` | `true` (seule valeur prise en charge aujourd'hui) | Élevé | Les sous-réseaux publics donnent aux nœuds de travail des adresses IP publiques — une surface d'attaque plus grande. `false` est la topologie la plus sûre mais est actuellement défectueuse : la passerelle NAT est placée dans un sous-réseau public qui n'est pas créé dans ce mode, donc l'apply échoue. |
| `vpc_cidr_block` | `/16` non chevauchants | Élevé | Un chevauchement avec un VPC appairé rompt le routage si l'appairage est introduit ultérieurement. |
| Chemin réseau de suppression | même chemin que le déploiement | Élevé | La suppression doit atteindre le serveur d'API EKS pour désinstaller l'Agent Connect ; si le cluster est inaccessible, la suppression est bloquée. |
| `node_group_min_size` | `2`+ | Moyen | Un seul nœud supprime la haute disponibilité ; la maintenance des nœuds peut mettre hors ligne la capacité de l'ensemble du cluster. |
| `node_group_max_size` | dimensionné pour les pics | Moyen | Le plafond n'a pas de sens sans un autoscaler de cluster installé ; l'augmenter seul ne fait rien. |
| Passerelle NAT (mode privé) | budget pour cela | Moyen | Le mode sous-réseau privé ajoute des frais horaires de passerelle NAT + de transfert de données sur AWS. |

---

Pour une présentation conceptuelle plus approfondie — fédération OIDC, fonctionnalités de la flotte (Policy Controller, Config Management, services multi-clusters), Managed Prometheus et le module complémentaire Anthos Service Mesh facultatif — consultez la [documentation des clusters GKE attachés](https://cloud.google.com/kubernetes-engine/multi-cloud/docs/attached/eks/create-cluster).
