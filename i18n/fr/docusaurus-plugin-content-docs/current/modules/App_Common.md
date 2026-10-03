---
title: "App Common — Guide de configuration"
description: "Référence de configuration partagée pour le module App — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/App_Common.md @ 15fd4c7 sha256:53f7d90edf40 -->

# App Common — Guide de configuration {#app-common--configuration-guide}

## Vue d'ensemble {#overview}

App Common est la bibliothèque de capacités partagées qui sous-tend chaque déploiement d'application sur cette plateforme. Elle **n'est pas déployée directement par les utilisateurs**. Au lieu de cela, elle est consommée en interne par les deux moteurs de déploiement de base — [App CloudRun](App_CloudRun.md) et [App GKE](App_GKE.md) — qui l'appellent automatiquement lorsque vous déployez un module d'application (tel que Django CloudRun ou Odoo GKE).

Considérez App Common comme la "boîte à outils d'infrastructure standard" de la plateforme. Chaque fois qu'une application est déployée, App Common est responsable de la découverte de l'environnement GCP déjà en place, de la connexion de l'application à celui-ci et du provisionnement des services de support dont l'application a besoin — bases de données, buckets de stockage, secrets, surveillance, contrôles de sécurité et pipelines CI/CD.

Étant donné qu'App Common s'exécute dans le cadre de chaque déploiement, les améliorations et les corrections qui lui sont apportées bénéficient automatiquement à toutes les applications sans aucune modification des modules d'application individuels.

Ce guide est organisé par **capacité** plutôt que par groupe de configuration : App Common est une bibliothèque partagée et n'expose aucune variable déployable via l'interface utilisateur ni aucune sortie de haut niveau qui lui soit propre. Pour les variables d'entrée et les sorties de déploiement d'un déploiement réel, consultez le [Guide de configuration d'App GKE](App_GKE.md) et le [Guide de configuration d'App CloudRun](App_CloudRun.md).

## Services GCP déployés {#deployed-gcp-services}

App Common ne se déploie pas de manière indépendante. Pour chaque déploiement d'application, il provisionne et configure les services GCP suivants. Chaque capacité correspond à un ou plusieurs services Google Cloud, décrits en détail dans les sections ci-dessous.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Réseau | Compute Engine (VPC, sous-réseaux, pare-feu) | Découvre le VPC partagé et les tags de pare-feu |
| Base de données | Cloud SQL | Provisionne les bases de données et les utilisateurs d'applications sur l'instance partagée |
| Stockage | Cloud Storage (GCS) | Buckets de données d'application et buckets de sauvegarde |
| Stockage de fichiers | Cloud Filestore / VM NFS Compute Engine | Découvre le NFS partagé pour le partage de fichiers multi-instances |
| Images de conteneurs | Artifact Registry, Cloud Build | Découverte du registre d'images et builds d'images Kaniko |
| IAM | IAM (liaisons de rôles de compte de service) | Liaisons de charge de travail et Cloud Build à moindre privilège |
| Secrets | Secret Manager, Pub/Sub | Génération, validation et notifications de rotation de mots de passe |
| Surveillance | Cloud Monitoring | Règles d'alerte, canaux de notification, tests de disponibilité et tableaux de bord |
| CI/CD *(facultatif)* | Cloud Build (v2 GitHub), Cloud Deploy | Connexions GitHub et pipelines de livraison multi-étapes |
| Sécurité *(facultatif)* | Binary Authorization, Container Analysis, VPC Service Controls | Attestation d'image et périmètres d'API |
| Chiffrement *(facultatif)* | Cloud KMS | Trousseau de clés CMEK et CryptoKeys pour GCS et Artifact Registry |
| Rotation de mot de passe *(facultatif)* | Cloud Run Jobs, Eventarc | `pw-rotator` job et `rot-dispatch` dispatcher |

---

## Réseau {#networking}

### Découverte du réseau VPC {#vpc-network-discovery}

App Common découvre automatiquement le réseau VPC et les sous-réseaux qui ont été provisionnés par Services GCP. Il identifie les sous-réseaux existants dans chaque région, mappe les régions à leurs sous-réseaux et collecte les tags de pare-feu réseau utilisés pour acheminer le trafic correctement. Cela signifie que les charges de travail des applications sont connectées au bon réseau privé sans aucune configuration manuelle — les services Cloud Run avec sortie VPC directe et les pods GKE reçoivent tous deux automatiquement le bon placement réseau et les bonnes attributions de tags de pare-feu.

### Exploration dans GCP {#exploring-in-gcp}

Console : **Réseau VPC** → **Réseaux VPC** → sélectionnez le réseau → onglet **Sous-réseaux** pour voir les sous-réseaux par région ; onglet **Pare-feu** pour voir les règles et leurs tags cibles.

```bash
# List VPC networks in the project
gcloud compute networks list --project=PROJECT_ID

# List subnets with their regions and CIDRs
gcloud compute networks subnets list \
  --network=NETWORK_NAME \
  --project=PROJECT_ID \
  --format="table(name,region,ipCidrRange)"

# Show firewall rules and their target tags
gcloud compute firewall-rules list \
  --filter="network:NETWORK_NAME" \
  --format="table(name,targetTags.list(),allowed[].map().firewall_rule().list())" \
  --project=PROJECT_ID
```

---

## Base de données {#database}

### Intégration Cloud SQL {#cloud-sql-integration}

App Common découvre l'instance Cloud SQL que Services GCP a provisionnée pour le projet. Il lit le nom de connexion de l'instance, l'adresse IP interne et la version du moteur de base de données, puis génère un mot de passe de base de données aléatoire sécurisé et le stocke dans Secret Manager. Il provisionne également la base de données et l'utilisateur de base de données spécifiques à l'application sur l'instance partagée, de sorte que chaque application dispose de ses propres identifiants isolés tout en partageant l'infrastructure Cloud SQL sous-jacente.

Le secret du mot de passe de la base de données suit la convention de nommage `secret-INSTANCE_NAME-SERVICE_NAME`, où `SERVICE_NAME` est l'identifiant de l'application `{application_name}{tenant_id}{hash}` — ainsi chaque application sur un locataire obtient son propre secret distinct. Les charges de travail des applications récupèrent ce secret au moment de l'exécution via Secret Manager plutôt que de le recevoir comme une variable d'environnement en clair.

### Exploration dans GCP {#exploring-in-gcp-1}

Console : **SQL** → sélectionnez l'instance → onglet **Bases de données** pour voir les bases de données provisionnées ; onglet **Utilisateurs** pour voir les utilisateurs provisionnés.

```bash
# List Cloud SQL instances
gcloud sql instances list --project=PROJECT_ID

# Describe a specific instance (connection name, IP addresses, version)
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(connectionName,ipAddresses,databaseVersion,region)"

# List databases on an instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List users on an instance
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID
```

---

## Stockage {#storage}

### Buckets Cloud Storage {#cloud-storage-buckets}

App Common provisionne un ou plusieurs buckets GCS pour l'utilisation des applications. Les buckets sont créés avec la gestion des versions, un accès uniforme au niveau du bucket et la prévention de l'accès public activés par défaut. Des règles de cycle de vie sont appliquées pour transférer ou supprimer automatiquement les objets en fonction de l'âge et des conditions de version, ce qui permet de maintenir les coûts de stockage prévisibles. Un bucket de sauvegarde dédié est également créé pour chaque application avec une période de rétention configurable.

Lorsque le chiffrement CMEK est activé (voir la section CMEK ci-dessous), tous les buckets sont chiffrés avec une clé KMS gérée par le client.

### Exploration dans GCP {#exploring-in-gcp-2}

Console : **Cloud Storage** → **Buckets** — filtrez par le préfixe de ressource de l'application pour trouver ses buckets.

```bash
# List buckets belonging to an application (replace PREFIX with the app's resource prefix)
gcloud storage buckets list \
  --filter="name:PREFIX*" \
  --project=PROJECT_ID

# Show bucket details including versioning, lifecycle, and encryption
gcloud storage buckets describe gs://BUCKET_NAME

# List lifecycle rules on a bucket
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="json(lifecycle)"
```

---

## Stockage de fichiers {#file-storage}

### Cloud Filestore et découverte NFS {#cloud-filestore-and-nfs-discovery}

Pour les applications qui ont besoin d'un stockage de fichiers partagé (par exemple, un CMS avec des médias téléchargés par les utilisateurs partagés entre plusieurs instances), App Common découvre l'infrastructure NFS que Services GCP a mise à disposition. Il prend en charge deux types : les instances Cloud Filestore gérées et les serveurs NFS basés sur GCE. Lorsque les deux sont présents, l'instance Filestore a la priorité. Le point de terminaison NFS découvert est mis à la disposition de la charge de travail de l'application afin qu'elle puisse monter le système de fichiers partagé au démarrage.

### Exploration dans GCP {#exploring-in-gcp-3}

Console : **Filestore** → **Instances** pour voir les instances NFS gérées et leurs adresses IP.

```bash
# List Filestore instances in the project
gcloud filestore instances list --project=PROJECT_ID

# Describe a specific Filestore instance (IP address, capacity, tier)
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID \
  --format="yaml(networks,fileShares,tier)"
```

---

## Images de conteneurs {#container-images}

### Artifact Registry {#artifact-registry}

App Common découvre le dépôt Artifact Registry partagé provisionné par Services GCP. Ce dépôt stocke toutes les images de conteneurs d'applications et les images d'utilitaires de base de données. L'emplacement et l'ID du dépôt découverts sont utilisés à la fois par le processus de build de conteneur et par les déclencheurs de pipeline CI/CD pour garantir que les images sont poussées et tirées du bon registre.

### Exploration dans GCP {#exploring-in-gcp-4}

Console : **Artifact Registry** → **Dépôts** → sélectionnez le dépôt → parcourez les images et les tags.

```bash
# List Artifact Registry repositories in the project
gcloud artifacts repositories list --project=PROJECT_ID

# List images in a repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags

# Show details of a specific image including its digest
gcloud artifacts docker images describe \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/IMAGE_NAME:TAG
```

### Création d'images de conteneurs {#container-image-building}

Lorsqu'un module d'application inclut un build de conteneur personnalisé, App Common utilise **Cloud Build** avec Kaniko pour créer l'image à partir de la source et la pousser vers Artifact Registry. Le build est déclenché automatiquement pendant le déploiement et redéclenché chaque fois que le Dockerfile, le contexte de build ou les arguments de build changent. Les journaux de build sont disponibles dans l'historique de Cloud Build.

### Exploration dans GCP {#exploring-in-gcp-5}

Console : **Cloud Build** → **Historique** — filtrez par déclencheur ou nom d'image pour trouver les exécutions de build pour une application spécifique.

```bash
# List recent Cloud Build builds (most recent first)
gcloud builds list \
  --project=PROJECT_ID \
  --limit=20

# Stream logs for a specific build
gcloud builds log BUILD_ID --project=PROJECT_ID

# List builds filtered by a specific image tag
gcloud builds list \
  --filter="images:IMAGE_NAME" \
  --project=PROJECT_ID
```

---

## IAM {#iam}

### Identité de charge de travail et liaisons de rôles {#workload-identity-and-role-bindings}

App Common configure les liaisons IAM nécessaires au compte de service de chaque application pour fonctionner avec un accès à moindre privilège. Plus précisément, il accorde au compte de service de la charge de travail :

- **Secret Manager** — `roles/secretmanager.secretAccessor` sur le secret du mot de passe de la base de données et tout secret supplémentaire déclaré par l'application. Les secrets que la charge de travail elle-même réécrit (par exemple, un hook post-installation qui stocke une valeur générée) reçoivent en plus `roles/secretmanager.secretVersionManager`.
- **Cloud Storage** — `roles/storage.objectAdmin` et `roles/storage.legacyBucketReader` sur chacun des buckets GCS de l'application.

Lorsque le CI/CD est activé, App Common accorde également au compte de service Cloud Build le rôle de déploiement approprié (`roles/run.developer` ou `roles/container.developer`) et la capacité d'agir en tant que compte de service de la charge de travail.

### Exploration dans GCP {#exploring-in-gcp-6}

Console : **IAM et administration** → **IAM** — filtrez par l'adresse e-mail du compte de service de l'application pour voir ses liaisons. Pour les liaisons par ressource (secrets, buckets), vérifiez l'onglet **Autorisations** sur la ressource individuelle.

```bash
# Show IAM bindings for the project (filter by service account)
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:SA_EMAIL" \
  --format="table(bindings.role)"

# Show IAM policy on a specific GCS bucket
gcloud storage buckets get-iam-policy gs://BUCKET_NAME

# Show IAM policy on a specific Secret Manager secret
gcloud secrets get-iam-policy SECRET_NAME --project=PROJECT_ID
```

---

## Secrets {#secrets}

### Secret Manager {#secret-manager}

App Common gère le cycle de vie complet des secrets d'application dans Secret Manager. Pour chaque déploiement, il :

- Génère un mot de passe de base de données aléatoire et le stocke en tant que secret versionné.
- Valide que tout secret supplémentaire déclaré par le module d'application (clés API, identifiants tiers, etc.) existe déjà dans Secret Manager avant que le déploiement ne se poursuive.
- Crée un sujet Pub/Sub pour recevoir les notifications de rotation de secrets à un intervalle de rotation configurable.

Les secrets sont référencés par les charges de travail des applications au moment de l'exécution — les services Cloud Run les résolvent en tant que variables d'environnement au démarrage, tandis que les charges de travail GKE les reçoivent en tant que secrets Kubernetes.

### Exploration dans GCP {#exploring-in-gcp-7}

Console : **Secret Manager** — filtrez par le préfixe de ressource de l'application pour trouver ses secrets. Cliquez sur un secret pour voir ses versions, son calendrier de rotation et ses journaux d'audit d'accès.

```bash
# List secrets in the project (filter by prefix)
gcloud secrets list \
  --filter="name:PREFIX" \
  --project=PROJECT_ID

# Show details of a secret including rotation schedule
gcloud secrets describe SECRET_NAME --project=PROJECT_ID

# List versions of a secret
gcloud secrets versions list SECRET_NAME --project=PROJECT_ID

# Access a secret's current value (requires secretmanager.versions.access permission)
gcloud secrets versions access latest \
  --secret=SECRET_NAME \
  --project=PROJECT_ID
```

### Rotation automatique des mots de passe {#automatic-password-rotation}

Lorsque la rotation automatique des mots de passe est activée pour une application, App Common déploie une architecture de rotation basée sur trois composants :

1. **Cloud Run Job** (`SERVICE_NAME-pw-rotator`) — exécute la rotation : génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL, ajoute la nouvelle version du secret, attend la propagation, puis désactive l'ancienne version. Cette approche sans interruption garantit que les charges de travail en cours d'exécution ne sont jamais perturbées.
2. **Cloud Run Service** (`SERVICE_NAME-rot-dispatch`) — un répartiteur léger qui se met à l'échelle à zéro et qui relie le déclencheur Eventarc au job de rotation.
3. **Déclencheur Eventarc** (`SERVICE_NAME-pw-rot-trigger`) — déclenche le répartiteur chaque fois que Secret Manager émet une notification de rotation sur le sujet Pub/Sub.

Les trois ressources sont spécifiques à l'application : elles sont préfixées par `SERVICE_NAME` du déploiement, de sorte que chaque application sur un locataire fait pivoter ses propres identifiants indépendamment.

### Exploration dans GCP {#exploring-in-gcp-8}

Console : **Cloud Run** — recherchez `SERVICE_NAME-pw-rotator` (Job) et `SERVICE_NAME-rot-dispatch` (Service) dans la région de l'application. **Eventarc** → **Déclencheurs** pour voir le déclencheur de rotation.

```bash
# List Cloud Run Jobs in the project
gcloud run jobs list --project=PROJECT_ID --region=REGION

# Show details of the rotation job
gcloud run jobs describe SERVICE_NAME-pw-rotator \
  --project=PROJECT_ID \
  --region=REGION

# List Eventarc triggers
gcloud eventarc triggers list \
  --project=PROJECT_ID \
  --location=REGION
```

---

## Surveillance {#monitoring}

### Règles d'alerte et canaux de notification {#alert-policies-and-notification-channels}

App Common crée des règles d'alerte Cloud Monitoring pour chaque application. Par défaut, il provisionne :

- Une **alerte d'utilisation du CPU** — se déclenche lorsque l'utilisation du CPU dépasse 90 % pendant 60 secondes.
- Une **alerte d'utilisation de la mémoire** — se déclenche lorsque l'utilisation de la mémoire dépasse 90 % pendant 60 secondes.
- Une **alerte de taux d'erreur 5xx** (`SERVICE_NAME-5xx-error-rate-alert`) — se déclenche lorsqu'un service Cloud Run renvoie plus de 5 erreurs de serveur en 5 minutes. Les alertes d'utilisation ne peuvent pas voir un service qui est en panne (un conteneur cassé ne consomme pas de CPU), mais les nombres de requêtes sont émis par requête, donc un conteneur répondant 503 est détecté. Un service qui ne reçoit aucun trafic ne déclenche rien. Il surveille les métriques de requêtes Cloud Run ; définissez `error_rate_alert_enabled = false` pour le supprimer lorsque des réponses 5xx sont attendues.

Les trois alertes notifient les adresses e-mail désignées comme utilisateurs de support pour le déploiement et re-notifient toutes les 30 minutes tant que la condition persiste. Les applications peuvent également définir des règles d'alerte personnalisées supplémentaires avec leurs propres filtres, seuils et périodes d'agrégation.

### Tests de disponibilité {#uptime-checks}

Lorsque le point de terminaison de l'application est accessible publiquement, App Common provisionne également un **test de disponibilité** Cloud Monitoring (`SERVICE_NAME-uptime-check`) qui sonde le chemin configuré via HTTP(S) à partir de plusieurs emplacements mondiaux, ainsi qu'une **alerte de défaillance de test correspondante (créée uniquement lorsque `support_users` n'est pas vide)** (`SERVICE_NAME-uptime-check-alert`) qui se déclenche lorsque le point de terminaison est inaccessible pendant 5 minutes. Le chemin, le délai d'expiration et l'intervalle du test sont configurables ; le module de base décide si le point de terminaison est accessible publiquement et ignore le test s'il ne l'est pas.

### Exploration dans GCP {#exploring-in-gcp-9}

Console : **Surveillance** → **Alertes** → **Règles** — filtrez par le nom de l'application pour trouver ses alertes. **Alertes** → **Canaux de notification** pour voir les canaux de messagerie.

```bash
# List alert policies in the project
gcloud alpha monitoring policies list --project=PROJECT_ID

# List notification channels
gcloud alpha monitoring channels list --project=PROJECT_ID
```

### Tableaux de bord Cloud Monitoring {#cloud-monitoring-dashboards}

App Common crée un tableau de bord Cloud Monitoring pré-construit adapté à la plateforme de déploiement :

- **Cloud Run** — affiche le nombre de requêtes, la latence des requêtes p95, le nombre d'instances de conteneurs et l'utilisation du CPU, filtrés par nom de service.
- **GKE** — affiche l'utilisation du CPU, l'utilisation de la mémoire, le nombre de redémarrages de pods et la sortie réseau, filtrés par espace de noms Kubernetes.

### Exploration dans GCP {#exploring-in-gcp-10}

Console : **Surveillance** → **Tableaux de bord** — trouvez le tableau de bord nommé d'après l'application ou le service.

```bash
# List custom dashboards in the project
gcloud monitoring dashboards list --project=PROJECT_ID
```

---

## CI/CD {#cicd}

### Intégration Cloud Build v2 GitHub {#cloud-build-v2-github-integration}

Lorsque le CI/CD est activé pour une application, App Common établit une connexion Cloud Build v2 à GitHub à l'aide d'un jeton OAuth et d'une installation d'application GitHub. Il crée ensuite une ressource de dépôt Cloud Build v2 liée au dépôt GitHub de l'application. Cette connexion permet aux déclencheurs Cloud Build de répondre aux événements de push et à l'activité des requêtes pull dans GitHub.

### Exploration dans GCP {#exploring-in-gcp-11}

Console : **Cloud Build** → **Dépôts (2e génération)** — trouvez la connexion et le dépôt lié pour l'application.

```bash
# List Cloud Build v2 connections
gcloud builds connections list \
  --project=PROJECT_ID \
  --region=REGION

# List Cloud Build v2 repositories linked to a connection
gcloud builds repositories list \
  --connection=CONNECTION_NAME \
  --project=PROJECT_ID \
  --region=REGION
```

### Pipelines de livraison Cloud Deploy {#cloud-deploy-delivery-pipelines}

Pour les applications utilisant la livraison multi-étapes, App Common provisionne un pipeline de livraison **Cloud Deploy** avec des étapes de promotion ordonnées (par exemple, `dev → staging → prod`). Chaque étape correspond à une cible nommée (un service Cloud Run ou un cluster GKE) et peut être configurée avec :

- **Portes d'approbation manuelles** — un humain doit approuver la promotion à l'étape suivante.
- **Auto-promotion** — le pipeline passe automatiquement à l'étape suivante en cas de déploiement réussi.

Un bucket GCS est créé pour stocker la configuration Skaffold et les manifestes de déploiement par étape. L'agent de service de Cloud Deploy reçoit les autorisations dont il a besoin pour déployer sur Cloud Run ou GKE.

### Exploration dans GCP {#exploring-in-gcp-12}

Console : **Cloud Deploy** → **Pipelines de livraison** — sélectionnez le pipeline pour voir ses étapes, ses versions et l'historique des déploiements.

```bash
# List Cloud Deploy delivery pipelines
gcloud deploy delivery-pipelines list \
  --project=PROJECT_ID \
  --region=REGION

# Describe a pipeline and its stages
gcloud deploy delivery-pipelines describe PIPELINE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# List releases for a pipeline
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --project=PROJECT_ID \
  --region=REGION
```

---

## Sécurité {#security}

### Binary Authorization {#binary-authorization}

Lorsque Binary Authorization est activé, App Common garantit que seules les images de conteneurs signées et attestées peuvent être déployées. Il provisionne :

- Une **clé de signature asymétrique Cloud KMS** utilisée pour signer les digests d'images.
- Une **note Container Analysis** et un **attestateur** (`pipeline-attestor`) auxquels la règle Binary Authorization fait référence.
- Une **règle Binary Authorization** limitée au projet.

Après chaque build de conteneur réussi, l'image de l'application est signée à l'aide de la clé KMS et une attestation est enregistrée dans Container Analysis. La règle est configurable selon trois modes d'application : permissif (autoriser tout), exiger une attestation (appliquer les images signées) ou refus d'urgence (bloquer tous les déploiements).

### Exploration dans GCP {#exploring-in-gcp-13}

Console : **Binary Authorization** → **Règle** pour voir le mode d'application et les attestateurs. **Sécurité** → **Container Analysis** → **Occurrences** pour voir les enregistrements d'attestation.

```bash
# Show the current Binary Authorization policy
gcloud container binauthz policy export --project=PROJECT_ID

# List attestors in the project
gcloud container binauthz attestors list --project=PROJECT_ID

# List attestations for an image digest
gcloud container binauthz attestations list \
  --attestor=pipeline-attestor \
  --attestor-project=PROJECT_ID \
  --artifact-url=IMAGE_URI@sha256:DIGEST
```

### VPC Service Controls {#vpc-service-controls}

Lorsque les contrôles de service VPC sont activés, App Common configure un périmètre Access Context Manager autour du projet pour restreindre les identités et les réseaux qui peuvent appeler les API GCP protégées. Le périmètre couvre les services clés utilisés par la plateforme, notamment Cloud Run, GKE, Cloud SQL, Secret Manager, Cloud Storage, Artifact Registry, Cloud Build, KMS et Pub/Sub.

App Common découvre automatiquement l'ID de l'organisation à partir du projet et les plages CIDR des sous-réseaux VPC, puis construit quatre niveaux d'accès :

- **Accès VPC** — trafic provenant des sous-réseaux VPC du projet.
- **Accès administrateur** — plages d'adresses IP d'administrateur spécifiées.
- **Accès IAP** — l'agent de service Identity-Aware Proxy.
- **Accès CI/CD** — le compte de service Cloud Build et l'identité de déploiement.

Un mode de simulation est disponible pour auditer les violations de périmètre avant d'appliquer la règle.

### Exploration dans GCP {#exploring-in-gcp-14}

Console : **VPC Service Controls** — affichez la règle d'accès et le périmètre du projet.

```bash
# List Access Context Manager access policies (requires org-level access)
gcloud access-context-manager policies list \
  --organization=ORG_ID

# List service perimeters in a policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME

# Describe a specific perimeter
gcloud access-context-manager perimeters describe PERIMETER_NAME \
  --policy=POLICY_NAME
```

---

## Chiffrement {#encryption}

### Clés de chiffrement gérées par le client (CMEK) {#customer-managed-encryption-keys-cmek}

Lorsque CMEK est activé, App Common provisionne et gère les clés Cloud KMS afin que les buckets Cloud Storage et le dépôt Artifact Registry soient chiffrés avec des clés gérées par le client plutôt qu'avec des clés gérées par Google. Il :

- Découvre tout trousseau de clés KMS existant créé par Services GCP (préfixe `PROJECT_ID-cmek-`) et le réutilise ; crée un nouveau trousseau de clés uniquement si aucun n'existe.
- Provisionne une CryptoKey `storage-key` pour le chiffrement des buckets GCS et accorde au compte de service Cloud Storage l'autorisation `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur celle-ci.
- Provisionne éventuellement une CryptoKey `artifact-registry-key` et accorde au compte de service Artifact Registry la même autorisation.

Au moment de la planification, App Common vérifie également si des versions de clés KMS sont programmées pour être détruites ou désactivées, et les restaure avant de provisionner les ressources chiffrées — empêchant ainsi la perte accidentelle de données due à l'expiration des versions de clés.

### Exploration dans GCP {#exploring-in-gcp-15}

Console : **Sécurité** → **Gestion des clés** — trouvez le trousseau de clés nommé `PROJECT_ID-cmek-keyring` et ses clés.

```bash
# List KMS keyrings in a location
gcloud kms keyrings list \
  --location=REGION \
  --project=PROJECT_ID

# List keys in a keyring
gcloud kms keys list \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID

# Describe a key and show its key versions
gcloud kms keys describe KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID

# List key versions and their states
gcloud kms keys versions list \
  --key=KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID
```

---

## Entrées et sorties de déploiement {#deployment-inputs-and-outputs}

App Common est une bibliothèque partagée interne. Elle n'a pas de variables d'entrée déployables via l'interface utilisateur et n'expose pas de sorties de déploiement de haut niveau qui lui soient propres — ses capacités sont toujours consommées via un module de base. Pour les variables de configuration destinées à l'utilisateur et les sorties renvoyées après un déploiement réussi, consultez le [Guide de configuration d'App GKE](App_GKE.md) et le [Guide de configuration d'App CloudRun](App_CloudRun.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Module App CloudRun — Guide de configuration](App_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module App GKE — Guide de configuration](App_GKE.md) — cette configuration déployée sur GKE.
