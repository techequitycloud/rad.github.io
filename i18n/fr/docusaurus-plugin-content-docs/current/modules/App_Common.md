---
title: "App Common — Guide de configuration"
description: "Référence de configuration partagée du module App — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/App_Common.md @ 3055034 sha256:38888c75c31c -->

# App Common — Guide de configuration {#app-common--configuration-guide}

## Vue d'ensemble {#overview}

App Common est la bibliothèque de fonctionnalités partagée sur laquelle repose chaque déploiement d'application de cette plateforme. Elle **n'est pas déployée directement par les utilisateurs**. Elle est utilisée en interne par les deux moteurs de déploiement de base — [App CloudRun](App_CloudRun.md) et [App GKE](App_GKE.md) — qui l'appellent automatiquement lorsque vous déployez un module applicatif (comme Django CloudRun ou Odoo GKE).

Considérez App Common comme la « boîte à outils d'infrastructure standard » de la plateforme. À chaque déploiement d'une application, App Common se charge de découvrir l'environnement GCP déjà en place, d'y raccorder l'application et de provisionner les services de support dont l'application a besoin — bases de données, buckets de stockage, secrets, supervision, contrôles de sécurité et pipelines CI/CD.

Comme App Common s'exécute dans le cadre de chaque déploiement, les améliorations et correctifs qui lui sont apportés profitent automatiquement à toutes les applications, sans aucune modification des modules applicatifs individuels.

Ce guide est organisé par **fonctionnalité** plutôt que par groupe de configuration : App Common est une bibliothèque partagée et n'expose ni variables déployables depuis l'interface ni sorties de premier niveau qui lui soient propres. Pour les variables d'entrée et les sorties de déploiement visibles par l'utilisateur d'un déploiement réel, consultez le [guide de configuration App GKE](App_GKE.md) et le [guide de configuration App CloudRun](App_CloudRun.md).

## Services GCP déployés {#deployed-gcp-services}

App Common ne se déploie pas de manière indépendante. Pour le compte de chaque déploiement d'application, il provisionne et configure les services GCP suivants. Chaque fonctionnalité correspond à un ou plusieurs services Google Cloud, décrits en détail dans les sections ci-dessous.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Réseau | Compute Engine (VPC, Subnets, Firewall) | Découvre le VPC partagé et les tags de pare-feu |
| Base de données | Cloud SQL | Provisionne les bases de données et utilisateurs de l'application sur l'instance partagée |
| Stockage | Cloud Storage (GCS) | Buckets de données de l'application et buckets de sauvegarde |
| Stockage de fichiers | Cloud Filestore / VM NFS Compute Engine | Découvre le NFS partagé pour le partage de fichiers entre plusieurs instances |
| Images de conteneur | Artifact Registry, Cloud Build | Découverte du registre d'images et builds d'images Kaniko |
| IAM | IAM (liaisons de rôles des comptes de service) | Liaisons de moindre privilège pour la charge de travail et Cloud Build |
| Secrets | Secret Manager, Pub/Sub | Génération, validation des mots de passe et notifications de rotation |
| Supervision | Cloud Monitoring | Règles d'alerte, canaux de notification, tests de disponibilité et tableaux de bord |
| CI/CD *(facultatif)* | Cloud Build (v2 GitHub), Cloud Deploy | Connexions GitHub et pipelines de livraison multi-étapes |
| Sécurité *(facultatif)* | Binary Authorization, Container Analysis, VPC Service Controls | Attestation des images et périmètres d'API |
| Chiffrement *(facultatif)* | Cloud KMS | Trousseau CMEK et CryptoKeys pour GCS et Artifact Registry |
| Rotation des mots de passe *(facultatif)* | Cloud Run Jobs, Eventarc | Job `pw-rotator` et répartiteur `rot-dispatch` |

---

## Réseau {#networking}

### Découverte du réseau VPC {#vpc-network-discovery}

App Common découvre automatiquement le réseau VPC et les sous-réseaux provisionnés par Services GCP. Il identifie les sous-réseaux existants dans chaque région, associe les régions à leurs sous-réseaux et recueille les tags de pare-feu réseau utilisés pour acheminer correctement le trafic. Les charges de travail applicatives sont ainsi connectées au bon réseau privé sans aucune configuration manuelle — les services Cloud Run avec sortie VPC directe et les pods GKE reçoivent tous automatiquement le bon placement réseau et les bonnes attributions de tags de pare-feu.

### Explorer dans GCP {#exploring-in-gcp}

Console : **VPC network** → **VPC networks** → sélectionnez le réseau → onglet **Subnets** pour voir les sous-réseaux par région ; onglet **Firewall** pour voir les règles et leurs tags cibles.

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

App Common découvre l'instance Cloud SQL que Services GCP a provisionnée pour le projet. Il lit le nom de connexion de l'instance, son adresse IP interne et la version de son moteur de base de données, puis génère un mot de passe de base de données aléatoire et sécurisé qu'il stocke dans Secret Manager. Il provisionne également la base de données et l'utilisateur propres à l'application sur l'instance partagée, de sorte que chaque application dispose de ses propres identifiants isolés tout en partageant l'infrastructure Cloud SQL sous-jacente.

Le secret du mot de passe de base de données suit la convention de nommage `secret-INSTANCE_NAME-SERVICE_NAME`, où `SERVICE_NAME` est l'identifiant propre à l'application `{application_name}{tenant_id}{hash}` — chaque application d'un tenant obtient donc son propre secret distinct. Les charges de travail applicatives récupèrent ce secret à l'exécution via Secret Manager au lieu de le recevoir sous forme de variable d'environnement en clair.

### Explorer dans GCP {#exploring-in-gcp-1}

Console : **SQL** → sélectionnez l'instance → onglet **Databases** pour voir les bases de données provisionnées ; onglet **Users** pour voir les utilisateurs provisionnés.

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

App Common provisionne un ou plusieurs buckets GCS à l'usage de l'application. Les buckets sont créés avec la gestion des versions, l'accès uniforme au niveau du bucket et la prévention de l'accès public activés par défaut. Des règles de cycle de vie sont appliquées pour faire changer de classe ou supprimer automatiquement les objets selon des conditions d'âge et de version, ce qui rend les coûts de stockage prévisibles. Un bucket de sauvegarde dédié est également créé pour chaque application, avec une durée de conservation configurable.

Lorsque le chiffrement CMEK est activé (voir la section CMEK ci-dessous), tous les buckets sont chiffrés avec une clé KMS gérée par le client.

### Explorer dans GCP {#exploring-in-gcp-2}

Console : **Cloud Storage** → **Buckets** — filtrez par le préfixe de ressources de l'application pour trouver ses buckets.

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

### Découverte de Cloud Filestore et du NFS {#cloud-filestore-and-nfs-discovery}

Pour les applications qui ont besoin d'un stockage de fichiers partagé (par exemple, un CMS dont les médias téléversés par les utilisateurs sont partagés entre plusieurs instances), App Common découvre l'infrastructure NFS que Services GCP a mise à disposition. Il prend en charge deux types : les instances Cloud Filestore gérées et les serveurs NFS basés sur GCE. Lorsque les deux sont présents, l'instance Filestore est prioritaire. Le point de terminaison NFS découvert est mis à la disposition de la charge de travail applicative afin qu'elle puisse monter le système de fichiers partagé au démarrage.

### Explorer dans GCP {#exploring-in-gcp-3}

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

## Images de conteneur {#container-images}

### Artifact Registry {#artifact-registry}

App Common découvre le dépôt Artifact Registry partagé provisionné par Services GCP. Ce dépôt stocke toutes les images de conteneur des applications et les images d'utilitaires de base de données. L'emplacement et l'ID du dépôt découvert sont utilisés à la fois par le processus de build des conteneurs et par les déclencheurs du pipeline CI/CD, afin que les images soient poussées vers le bon registre et tirées depuis celui-ci.

### Explorer dans GCP {#exploring-in-gcp-4}

Console : **Artifact Registry** → **Repositories** → sélectionnez le dépôt → parcourez les images et les tags.

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

### Build des images de conteneur {#container-image-building}

Lorsqu'un module applicatif comprend un build de conteneur personnalisé, App Common utilise **Cloud Build** avec Kaniko pour construire l'image à partir des sources et la pousser vers Artifact Registry. Le build est déclenché automatiquement pendant le déploiement et relancé chaque fois que le Dockerfile, le contexte de build ou les arguments de build changent. Les journaux de build sont disponibles dans l'historique de Cloud Build.

### Explorer dans GCP {#exploring-in-gcp-5}

Console : **Cloud Build** → **History** — filtrez par déclencheur ou par nom d'image pour trouver les exécutions de build d'une application donnée.

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

### Workload Identity et liaisons de rôles {#workload-identity-and-role-bindings}

App Common met en place les liaisons IAM nécessaires pour que le compte de service de chaque application fonctionne selon le principe du moindre privilège. Plus précisément, il accorde au compte de service de la charge de travail :

- **Secret Manager** — `roles/secretmanager.secretAccessor` sur le secret du mot de passe de base de données et sur tout secret supplémentaire déclaré par l'application. Les secrets dans lesquels la charge de travail elle-même réécrit (par exemple un hook de post-installation qui stocke une valeur générée) reçoivent en plus `roles/secretmanager.secretVersionManager`.
- **Cloud Storage** — `roles/storage.objectAdmin` et `roles/storage.legacyBucketReader` sur chacun des buckets GCS de l'application.

Lorsque la CI/CD est activée, App Common accorde également au compte de service Cloud Build le rôle de déploiement approprié (`roles/run.developer` ou `roles/container.developer`) ainsi que la capacité d'agir en tant que compte de service de la charge de travail.

### Explorer dans GCP {#exploring-in-gcp-6}

Console : **IAM & Admin** → **IAM** — filtrez par l'adresse e-mail du compte de service de l'application pour voir ses liaisons. Pour les liaisons par ressource (secrets, buckets), consultez l'onglet **Permissions** de la ressource concernée.

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

App Common gère l'intégralité du cycle de vie des secrets applicatifs dans Secret Manager. Pour chaque déploiement, il :

- Génère un mot de passe de base de données aléatoire et le stocke sous forme de secret versionné.
- Vérifie que tous les secrets supplémentaires déclarés par le module applicatif (clés d'API, identifiants tiers, etc.) existent déjà dans Secret Manager avant que le déploiement ne se poursuive.
- Crée un sujet Pub/Sub destiné à recevoir les notifications de rotation des secrets selon un intervalle de rotation configurable.

Les secrets sont référencés par les charges de travail applicatives à l'exécution — les services Cloud Run les résolvent en variables d'environnement au démarrage, tandis que les charges de travail GKE les reçoivent sous forme de Secrets Kubernetes.

### Explorer dans GCP {#exploring-in-gcp-7}

Console : **Secret Manager** — filtrez par le préfixe de ressources de l'application pour trouver ses secrets. Cliquez sur un secret pour voir ses versions, son calendrier de rotation et ses journaux d'audit des accès.

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

Lorsque la rotation automatique des mots de passe est activée pour une application, App Common déploie une architecture de rotation reposant sur trois composants :

1. **Cloud Run Job** (`SERVICE_NAME-pw-rotator`) — exécute la rotation : génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL, ajoute la nouvelle version du secret, attend sa propagation, puis désactive l'ancienne version. Cette approche sans interruption de service garantit que les charges de travail en cours d'exécution ne sont jamais perturbées.
2. **Cloud Run Service** (`SERVICE_NAME-rot-dispatch`) — un répartiteur léger, avec mise à l'échelle jusqu'à zéro, qui relie le déclencheur Eventarc au job de rotation.
3. **Déclencheur Eventarc** (`SERVICE_NAME-pw-rot-trigger`) — active le répartiteur chaque fois que Secret Manager émet une notification de rotation sur le sujet Pub/Sub.

Ces trois ressources sont propres à l'application : elles sont préfixées par le `SERVICE_NAME` du déploiement, de sorte que chaque application d'un tenant effectue la rotation de ses propres identifiants de manière indépendante.

### Explorer dans GCP {#exploring-in-gcp-8}

Console : **Cloud Run** — recherchez `SERVICE_NAME-pw-rotator` (Job) et `SERVICE_NAME-rot-dispatch` (Service) dans la région de l'application. **Eventarc** → **Triggers** pour voir le déclencheur de rotation.

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

## Supervision {#monitoring}

### Règles d'alerte et canaux de notification {#alert-policies-and-notification-channels}

App Common crée des règles d'alerte Cloud Monitoring pour chaque application. Par défaut, il provisionne :

- Une **alerte d'utilisation du CPU** — se déclenche lorsque l'utilisation du CPU dépasse 90 % pendant 60 secondes.
- Une **alerte d'utilisation de la mémoire** — se déclenche lorsque l'utilisation de la mémoire dépasse 90 % pendant 60 secondes.

Les deux alertes notifient les adresses e-mail désignées comme utilisateurs du support pour le déploiement, et renvoient une notification toutes les 30 minutes tant que la condition persiste. Les applications peuvent également définir des règles d'alerte personnalisées supplémentaires, avec leurs propres filtres, seuils et périodes d'agrégation.

### Tests de disponibilité {#uptime-checks}

Lorsque le point de terminaison de l'application est accessible publiquement, App Common provisionne également un **test de disponibilité** Cloud Monitoring (`SERVICE_NAME-uptime-check`) qui sonde le chemin configuré en HTTP(S) depuis plusieurs emplacements dans le monde, ainsi qu'une **alerte d'échec du test correspondante (créée uniquement lorsque `support_users` n'est pas vide)** (`SERVICE_NAME-uptime-check-alert`) qui se déclenche lorsque le point de terminaison est inaccessible depuis 5 minutes. Le chemin, le délai d'expiration et l'intervalle du test sont configurables ; le module de base détermine si le point de terminaison est accessible publiquement et ignore le test dans le cas contraire.

### Explorer dans GCP {#exploring-in-gcp-9}

Console : **Monitoring** → **Alerting** → **Policies** — filtrez par le nom de l'application pour trouver ses alertes. **Alerting** → **Notification channels** pour voir les canaux e-mail.

```bash
# List alert policies in the project
gcloud alpha monitoring policies list --project=PROJECT_ID

# List notification channels
gcloud alpha monitoring channels list --project=PROJECT_ID
```

### Tableaux de bord Cloud Monitoring {#cloud-monitoring-dashboards}

App Common crée un tableau de bord Cloud Monitoring prédéfini, adapté à la plateforme de déploiement :

- **Cloud Run** — affiche le nombre de requêtes, la latence des requêtes au p95, le nombre d'instances de conteneur et l'utilisation du CPU, filtrés par nom de service.
- **GKE** — affiche l'utilisation du CPU, l'utilisation de la mémoire, le nombre de redémarrages de pods et le trafic réseau sortant, filtrés par espace de noms Kubernetes.

### Explorer dans GCP {#exploring-in-gcp-10}

Console : **Monitoring** → **Dashboards** — trouvez le tableau de bord nommé d'après l'application ou le service.

```bash
# List custom dashboards in the project
gcloud monitoring dashboards list --project=PROJECT_ID
```

---

## CI/CD {#cicd}

### Intégration GitHub de Cloud Build v2 {#cloud-build-v2-github-integration}

Lorsque la CI/CD est activée pour une application, App Common établit une connexion Cloud Build v2 vers GitHub à l'aide d'un jeton OAuth et d'une installation de GitHub App. Il crée ensuite une ressource de dépôt Cloud Build v2 liée au dépôt GitHub de l'application. Cette connexion permet aux déclencheurs Cloud Build de réagir aux événements de push et à l'activité des pull requests dans GitHub.

### Explorer dans GCP {#exploring-in-gcp-11}

Console : **Cloud Build** → **Repositories (2nd gen)** — trouvez la connexion et le dépôt lié de l'application.

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

Pour les applications qui utilisent une livraison multi-étapes, App Common provisionne un pipeline de livraison **Cloud Deploy** avec des étapes de promotion ordonnées (par exemple, `dev → staging → prod`). Chaque étape correspond à une cible nommée (un service Cloud Run ou un cluster GKE) et peut être configurée avec :

- **Des points d'approbation manuelle** — une personne doit approuver la promotion vers l'étape suivante.
- **Une promotion automatique** — le pipeline passe automatiquement à l'étape suivante après un déploiement progressif réussi.

Un bucket GCS est créé pour stocker la configuration Skaffold et les manifestes de déploiement de chaque étape. L'agent de service de Cloud Deploy reçoit les autorisations dont il a besoin pour déployer sur Cloud Run ou GKE.

### Explorer dans GCP {#exploring-in-gcp-12}

Console : **Cloud Deploy** → **Delivery pipelines** — sélectionnez le pipeline pour voir ses étapes, ses releases et l'historique de ses déploiements progressifs.

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

Lorsque Binary Authorization est activé, App Common garantit que seules des images de conteneur signées et attestées peuvent être déployées. Il provisionne :

- Une **clé de signature asymétrique Cloud KMS** utilisée pour signer les condensés (digests) des images.
- Une **note Container Analysis** et un **attestor** (`pipeline-attestor`) auxquels la règle Binary Authorization fait référence.
- Une **règle Binary Authorization** limitée au projet.

Après chaque build de conteneur réussi, l'image de l'application est signée à l'aide de la clé KMS et une attestation est enregistrée dans Container Analysis. La règle peut être configurée selon trois modes d'application : permissif (tout autoriser), attestation obligatoire (n'accepter que les images signées) ou refus d'urgence (bloquer tous les déploiements).

### Explorer dans GCP {#exploring-in-gcp-13}

Console : **Binary Authorization** → **Policy** pour voir le mode d'application et les attestors. **Security** → **Container Analysis** → **Occurrences** pour voir les enregistrements d'attestation.

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

Lorsque VPC Service Controls est activé, App Common configure un périmètre Access Context Manager autour du projet afin de restreindre les identités et les réseaux autorisés à appeler les API GCP protégées. Le périmètre couvre les principaux services utilisés par la plateforme, notamment Cloud Run, GKE, Cloud SQL, Secret Manager, Cloud Storage, Artifact Registry, Cloud Build, KMS et Pub/Sub.

App Common découvre automatiquement l'ID de l'organisation à partir du projet ainsi que les plages CIDR des sous-réseaux VPC, puis construit quatre niveaux d'accès :

- **Accès VPC** — le trafic provenant des sous-réseaux VPC du projet.
- **Accès administrateur** — les plages d'adresses IP d'administrateurs spécifiées.
- **Accès IAP** — l'agent de service Identity-Aware Proxy.
- **Accès CI/CD** — le compte de service Cloud Build et l'identité de déploiement.

Un mode simulation (dry-run) est disponible pour auditer les violations du périmètre avant d'appliquer la règle.

### Explorer dans GCP {#exploring-in-gcp-14}

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

Lorsque CMEK est activé, App Common provisionne et gère des clés Cloud KMS afin que les buckets Cloud Storage et le dépôt Artifact Registry soient chiffrés avec des clés gérées par le client plutôt qu'avec des clés gérées par Google. Il :

- Découvre tout trousseau de clés KMS existant créé par Services GCP (préfixe `PROJECT_ID-cmek-`) et le réutilise ; il ne crée un nouveau trousseau que si aucun n'existe.
- Provisionne une CryptoKey `storage-key` pour le chiffrement des buckets GCS et accorde au compte de service Cloud Storage l'autorisation `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur celle-ci.
- Provisionne éventuellement une CryptoKey `artifact-registry-key` et accorde la même autorisation à l'agent de service Artifact Registry.

Au moment du plan, App Common vérifie également si des versions de clés KMS sont programmées pour destruction ou désactivées, et les restaure avant de provisionner les ressources chiffrées — ce qui évite une perte de données accidentelle due à l'expiration d'une version de clé.

### Explorer dans GCP {#exploring-in-gcp-15}

Console : **Security** → **Key Management** — trouvez le trousseau nommé `PROJECT_ID-cmek-keyring` et ses clés.

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

## Entrées et sorties du déploiement {#deployment-inputs-and-outputs}

App Common est une bibliothèque partagée interne. Il ne possède aucune variable d'entrée déployable depuis l'interface et n'expose aucune sortie de déploiement de premier niveau qui lui soit propre — ses fonctionnalités sont toujours utilisées par l'intermédiaire d'un module de base. Pour les variables de configuration visibles par l'utilisateur et les sorties renvoyées après un déploiement réussi, consultez le [guide de configuration App GKE](App_GKE.md) et le [guide de configuration App CloudRun](App_CloudRun.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Module App CloudRun — Guide de configuration](App_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module App GKE — Guide de configuration](App_GKE.md) — cette configuration déployée sur GKE.
