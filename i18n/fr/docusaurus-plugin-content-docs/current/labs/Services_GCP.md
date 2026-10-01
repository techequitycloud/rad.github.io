---
title: "Services GCP — Guide de lab"
description: "Lab pratique : déployez le module de fondation Services GCP — VPC, réseau et infrastructure Google Cloud partagée requise par tous les modules RAD."
---

<!-- translated-from: docs/labs/Services_GCP.md @ 3055034 sha256:6f2b796e01e9 -->

# Services GCP — Guide de lab {#services-gcp--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Services_GCP)**

## Vue d'ensemble {#overview}

`Services GCP` est le **module d'infrastructure fondamental** de l'écosystème RAD Modules. Chaque module applicatif en dépend et se provisionne par-dessus ses services GCP partagés : le réseau VPC, les bases de données Cloud SQL, une VM NFS et Redis autogérée, Artifact Registry, les comptes de service IAM, ainsi qu'un large éventail de fonctionnalités facultatives — AlloyDB pour PostgreSQL, Firestore, Cloud Memorystore (Redis), Cloud Filestore (NFS), des clusters GKE Autopilot/Standard, et des contrôles de sécurité et de gouvernance (CMEK, Binary Authorization, VPC Service Controls, Security Command Center, Workload Identity Federation, journalisation d'audit, alertes de surveillance et budgets de facturation).

**Vous n'avez pas besoin de le déployer vous-même avant de déployer un module applicatif.** La plateforme détecte automatiquement si `Services GCP` existe déjà dans le projet cible et, sinon, le provisionne automatiquement — avec les ressources précises (`create_postgres`, `create_mysql`, `create_google_kubernetes_engine`, etc.) dont le module applicatif que vous déployez a réellement besoin — avant de poursuivre le build de votre propre module. Ce lab présente le déploiement et la vérification de `Services GCP` **directement et manuellement**, ce qui reste utile pour comprendre ce qu'il provisionne en coulisses, pour le pré-provisionner avec une configuration précise avant qu'une application n'en dépende, ou pour partager délibérément, dès le départ, un même déploiement `Services GCP` entre plusieurs déploiements d'applications.

**Durée estimée :** 1.5 à 2.5 heures (ajoutez 30 à 40 minutes si vous déployez un cluster GKE)

### Ce que le module automatise {#what-the-module-automates}

- Active jusqu'à 46 API GCP dans le projet cible (avec une attente de propagation de 360 secondes)
- Crée un réseau VPC en mode personnalisé avec des sous-réseaux, Cloud NAT et un appairage Private Service Connect
- Provisionne quatre comptes de service IAM (Cloud Build, Cloud Deploy, Cloud Run, NFS/Redis) avec toutes les liaisons de rôles requises
- Crée un dépôt Docker Artifact Registry partagé
- Provisionne en option des instances Cloud SQL PostgreSQL, MySQL ou AlloyDB avec IP privée, sauvegardes automatiques et mots de passe root dans Secret Manager (toutes désactivées par défaut ; ce lab active PostgreSQL)
- Crée en option une base de données documentaire Firestore Native (édition Enterprise)
- Déploie une VM NFS + Redis autogérée sous forme de groupe d'instances géré, avec réparation automatique et instantanés de disque quotidiens (activée par défaut)
- Provisionne en option Cloud Memorystore pour Redis, Cloud Filestore NFS, un ou plusieurs clusters GKE Autopilot/Standard, CMEK, Binary Authorization, VPC Service Controls, Security Command Center, Workload Identity Federation et des règles d'alerte Cloud Monitoring
- Valide vos paramètres **au moment du plan** — les valeurs ou combinaisons de fonctionnalités non valides sont rejetées avec une erreur claire avant la création de toute ressource

### Ce que vous faites manuellement {#what-you-do-manually}

- Relever les sorties du déploiement dans l'onglet **Outputs** du déploiement
- Vérifier le réseau VPC, les sous-réseaux et Cloud NAT dans la console Cloud
- Inspecter les instances Cloud SQL, la connectivité par IP privée et les mots de passe Secret Manager
- Vérifier que le MIG de la VM NFS/Redis est opérationnel et que le disque de données est rattaché
- (Facultatif) Configurer l'accès `kubectl` au cluster GKE et vérifier qu'il a rejoint le parc (fleet)
- Examiner les liaisons IAM des comptes de service provisionnés
- Explorer les règles d'alerte et les canaux de notification Cloud Monitoring

---

## Vue d'ensemble de la CLI et de l'API REST {#cli-and-rest-api-overview}

```bash
# Set these variables at the start of each session
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the VPC network created by this module
export NETWORK=$(gcloud compute networks list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Discover the Cloud SQL PostgreSQL instance
export PG_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~POSTGRES" \
  --format="value(name)" \
  --limit=1)

# Discover the NFS/Redis VM (if created)
export NFS_VM=$(gcloud compute instances list \
  --project=${PROJECT} \
  --filter="tags.items:nfsserver" \
  --format="value(name)" \
  --limit=1)
```

---

## Prérequis {#prerequisites}

| Exigence | Détail |
|---|---|
| Projet GCP avec facturation | Compte de facturation actif associé |
| Compte de service | `roles/owner` accordé dans le projet cible au compte de service RAD module creator |
| CLI `gcloud` | Authentifiée (`gcloud auth login`) |
| `kubectl` (facultatif) | Requis uniquement si vous déployez un cluster GKE |
| Accès à la plateforme RAD | Autorisation de déployer des modules dans le projet GCP cible |

`Services GCP` est un module autonome, sans dépendance d'exécution envers d'autres modules RAD. Le seul prérequis est un projet GCP existant avec la facturation activée.

---

## Phase 1 — Déployer l'infrastructure [AUTOMATISÉ] {#phase-1--deploy-infrastructure-automated}

### Étape 1.1 — Configurer les variables {#step-11--configure-variables}

Les variables se configurent dans le formulaire de configuration du module de la plateforme RAD. Le formulaire de création ne demande que la première page de paramètres (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et les régions) ; tout le reste se définit ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour. Le tableau ci-dessous présente les variables les plus couramment ajustées ; le **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Services_GCP)** documente chaque variable, regroupées exactement comme le formulaire les présente, avec pour chaque groupe une note de décision *« Choosing… »* expliquant les compromis coût / disponibilité / sécurité qui sous-tendent le choix.

> **Les paramètres sont validés au moment du plan.** Vous n'avez pas à retenir de mémoire toutes les combinaisons valides — le module rejette les valeurs non valides (un `tenant_id` mal formé, une capacité Filestore inférieure au minimum du niveau, un seuil de budget hors de `0–1`) et les combinaisons non valides (un réplica en lecture sans instance principale, un périmètre VPC-SC appliqué sans IP autorisées, un module complémentaire GKE sans cluster) *avant* toute création, avec un message nommant la variable en cause. Considérez un plan sans erreur comme la confirmation que les règles de valeurs et de combinaisons sont respectées — le dimensionnement et les choix de topologie CIDR restent sous votre responsabilité.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | ID du projet GCP dans lequel déployer |
| `tenant_id` | `demo` | **Préfixe de chaque nom de ressource** (lettres minuscules et chiffres uniquement, sans trait d'union — contrôlé). Les modules applicatifs doivent utiliser cette même valeur pour se rattacher à cette fondation. Ne la modifiez jamais après le premier déploiement. |
| `availability_regions` | `['us-central1']` | Liste des régions pour les sous-réseaux et les ressources ; la première entrée est la région principale. Une deuxième région active les réplicas en lecture interrégionaux. |
| `subnet_cidr_range` | `['10.0.0.0/24']` | Plages CIDR des sous-réseaux VPC, une par région (au moins une par région est exigée). Le nom du réseau VPC est dérivé automatiquement du tenant — ce n'est pas une variable configurable. |
| `support_users` | `[]` | Destinataires supplémentaires des alertes de **budget de facturation** uniquement, et seulement lorsque `create_billing_budget = true` (fusionnés avec `budget_alert_emails`). N'accorde aucun rôle IAM et n'alimente pas les alertes Cloud Monitoring — celles-ci proviennent de `notification_alert_emails` combiné à `configure_email_notification`. Sans effet tant que `create_billing_budget = false`. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources provisionnées |
| `create_postgres` | `false` | Provisionne une instance Cloud SQL PostgreSQL. Désactivée par défaut — le tfvars du lab ci-dessous la définit explicitement. |
| `postgres_database_version` | `POSTGRES_17` | Version du moteur PostgreSQL (`POSTGRES_17`/`16`/`15`/`14` — validée) |
| `postgres_database_availability_type` | `ZONAL` | `ZONAL` pour le développement et les tests ; `REGIONAL` pour une production en haute disponibilité |
| `postgres_tier` | `db-custom-1-3840` | Type de machine Cloud SQL (1 vCPU, 3.75 GB de RAM) |
| `create_mysql` | `false` | Provisionne une instance Cloud SQL MySQL (requise par WordPress, Moodle, Odoo) |
| `enable_alloydb` | `false` | Provisionne un cluster AlloyDB pour PostgreSQL (charges de travail d'analyse/IA/vectorielles). Coût supérieur à celui d'une petite instance Cloud SQL. |
| `create_firestore` | `false` | Crée une base de données documentaire Firestore Native (Enterprise). Serverless, facturée à l'usage. |
| `create_network_filesystem` | `true` | Déploie une VM NFS + Redis autogérée sous forme de groupe d'instances géré |
| `network_filesystem_machine` | `e2-small` | Type de machine Compute Engine de la VM NFS/Redis |
| `network_filesystem_capacity` | `10` | Taille du disque de données NFS en GB (agrandissement uniquement) |
| `create_redis` | `false` | Provisionne Cloud Memorystore pour Redis (alternative gérée ; définissez `create_network_filesystem = false`) |
| `create_filestore_nfs` | `false` | Provisionne Cloud Filestore NFS (alternative gérée ; définissez `create_network_filesystem = false`) |
| `create_google_kubernetes_engine` | `false` | Provisionne un ou plusieurs clusters GKE Autopilot/Standard |
| `enable_vulnerability_scanning` | `false` | Analyse des CVE lors du push pour les images Artifact Registry (faible coût, forte valeur) |
| `enable_cmek` | `false` | Chiffre les ressources avec des clés de chiffrement gérées par le client via Cloud KMS (à décider dès le premier déploiement) |
| `enable_binary_authorization` | `false` | Active l'application des règles d'images Binary Authorization (commencez en `ALWAYS_ALLOW`) |
| `enable_vpc_sc` | `false` | Crée un périmètre VPC Service Controls autour du projet (commencez avec `vpc_sc_dry_run = true`) |
| `enable_security_command_center` | `false` | Active Security Command Center pour centraliser les résultats de sécurité |
| `configure_email_notification` | `false` | Crée des règles d'alerte Cloud Monitoring pour le CPU, la mémoire et le disque (fournissez `notification_alert_emails`) |

### Étape 1.1b — Choisir votre parcours de lab {#step-11b--choose-your-lab-path}

Ce lab prend en charge deux configurations. Choisissez-en une selon la part du module que vous souhaitez mettre en œuvre (et le temps et le coût de lab que vous pouvez y consacrer).

**Parcours A — Minimal (le plus rapide, ~20–35 min).** Conservez les valeurs par défaut, qui incluent la VM NFS/Redis autogérée, et ajoutez PostgreSQL, désactivé par défaut. Cela suffit pour adosser une seule application Cloud Run et parcourir les phases 2 à 4 et 7. Définissez `project_id`, `tenant_id` et `create_postgres = true`.

**Parcours B — Complet (recommandé pour ce lab, ~45–70 min avec GKE).** Activez un éventail représentatif de fonctionnalités afin que chaque phase de vérification ait quelque chose à montrer. Configuration suggérée :

```hcl
project_id                      = "<your-project-id>"
tenant_id            = "demo"

# Databases — exercise all three relational engines + Firestore
create_postgres                 = true
create_mysql                    = true
create_firestore                = true
# enable_alloydb                = true   # optional: highest-cost item, enable to see AlloyDB

# Compute
create_google_kubernetes_engine = true   # adds ~10–20 min for the Autopilot cluster

# Storage & cache — keep the default self-managed VM, OR switch to managed:
create_network_filesystem       = true
# create_redis                  = true   # if set, also set create_network_filesystem = false
# create_filestore_nfs          = true   # if set, also set create_network_filesystem = false

# Security & governance (all in safe/audit modes — no lockout risk)
enable_vulnerability_scanning   = true
enable_binary_authorization     = true   # stays in ALWAYS_ALLOW until you add an attestation pipeline
enable_cmek                     = true
enable_vpc_sc                   = true   # remains dry-run (vpc_sc_dry_run = true) — audit only
enable_security_command_center  = true

# Observability & cost
configure_email_notification    = true
notification_alert_emails       = ["you@example.com"]
create_billing_budget           = true
budget_amount                   = 100
budget_alert_emails             = ["you@example.com"]
```

> Le parcours B laisse les deux fonctionnalités au plus grand rayon d'impact (`enable_binary_authorization`, `enable_vpc_sc`) dans leurs **modes sûrs** — `ALWAYS_ALLOW` et dry-run — afin que vous puissiez les observer dans la console sans risquer un blocage à l'échelle du projet. Ne les durcissez qu'après avoir lu les notes de déploiement progressif du Guide de configuration. La suite de ce lab suppose le parcours B et signale les étapes propres à un moteur par l'indicateur de fonctionnalité qui les active, afin que les utilisateurs du parcours A puissent simplement les ignorer.

### Étape 1.2 — Lancer le déploiement {#step-12--initiate-deployment}

Le déploiement se lance depuis la plateforme RAD : ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure, ouvrez **Services GCP** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), remplissez le formulaire de configuration, cliquez sur **Deploy Module** et confirmez dans la boîte de dialogue qui suit. (Lorsque vous déployez une application dans un projet qui ne dispose pas encore de `Services GCP`, la plateforme enchaîne automatiquement ce module avant elle.)

**Durées de provisionnement attendues des ressources :**

| Phase | Durée typique |
|---|---|
| Activation des API GCP (46 API + attente de propagation de 360 s) | 6–8 min |
| Réseau VPC, sous-réseaux, Cloud NAT, Private Service Connect | 2–4 min |
| Dépôt Artifact Registry + comptes de service | 2–3 min |
| VM NFS/Redis + groupe d'instances géré | 3–5 min |
| Instance Cloud SQL PostgreSQL (si activée) | 5–10 min |
| Instance Cloud SQL MySQL (si activée) | 3–5 min |
| Cloud Memorystore Redis (si activé) | 3–5 min |
| Cloud Filestore NFS (si activé) | 3–5 min |
| Cluster GKE Autopilot + enregistrement dans le parc (si activé) | 10–20 min |
| CMEK / Binary Authorization / VPC-SC (si activés) | 2–5 min |
| Règles d'alerte Cloud Monitoring | 1–2 min |
| **Total (parcours A : PostgreSQL + VM NFS)** | **20–35 min** |
| **Total (avec cluster GKE)** | **35–55 min** |

### Étape 1.3 — Relever les sorties {#step-13--record-outputs}

Une fois le déploiement terminé, les sorties suivantes sont disponibles dans l'onglet **Outputs** du déploiement.

| Sortie | Description |
|---|---|
| `deployment_id` | ID hexadécimal aléatoire utilisé comme suffixe dans tous les noms de ressources |
| `primary_region` | Première région de `availability_regions` |
| `host_project_id` | ID du projet GCP |
| `vpc_network_name` | Nom du réseau VPC |
| `vpc_network_id` | ID de ressource du réseau VPC |
| `cloudrun_service_account` | Adresse e-mail du compte de service Cloud Run |
| `cloudbuild_service_account` | Adresse e-mail du compte de service Cloud Build |
| `artifact_registry_repository_name` | Nom du dépôt Docker partagé |
| `artifact_registry_repository_location` | Région du dépôt |
| `nfs_server_ip` | IP interne statique de la VM NFS+Redis (si `create_network_filesystem = true`) |
| `redis_on_nfs_connection_string` | `redis://{ip}:6379` (si `create_network_filesystem = true`) |
| `postgres_instance_connection_name` | Nom de connexion Cloud SQL Auth Proxy (si `create_postgres = true`) |
| `postgres_instance_ip` | IP privée de l'instance PostgreSQL (si `create_postgres = true`) |
| `mysql_instance_connection_name` | Nom de connexion Cloud SQL Auth Proxy (si `create_mysql = true`) |
| `redis_host` | IP de l'hôte Memorystore Redis (si `create_redis = true`) |
| `filestore_ip` | IP du serveur NFS Filestore (si `create_filestore_nfs = true`) |
| `alloydb_cluster_name` | Nom du cluster AlloyDB (si `enable_alloydb = true`) |
| `alloydb_primary_ip` | IP privée de l'instance principale AlloyDB (si `enable_alloydb = true`) |
| `gke_cluster_name` | Nom du cluster GKE principal (si `create_google_kubernetes_engine = true`) |
| `binauthz_attestor_name` | Nom de l'attesteur Binary Authorization (si `enable_binary_authorization = true`) |
| `storage_kms_key_name` | Nom de ressource de la clé KMS pour Cloud Storage (si `enable_cmek = true`) |

Définissez les variables shell utilisées dans les étapes suivantes :

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

export NETWORK=$(gcloud compute networks list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

export PG_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~POSTGRES" \
  --format="value(name)" \
  --limit=1)

export NFS_VM=$(gcloud compute instances list \
  --project=${PROJECT} \
  --filter="tags.items:nfsserver" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Vérifier le réseau et IAM [MANUEL] {#phase-2--verify-networking--iam-manual}

### Étape 2.1 — Vérifier le réseau VPC {#step-21--confirm-the-vpc-network}

Vérifiez que le réseau VPC a été créé :

```bash
gcloud compute networks describe ${NETWORK} \
  --project=${PROJECT} \
  --format="yaml(name,autoCreateSubnetworks,routingConfig)"
```

**Résultat attendu :** le réseau apparaît avec `autoCreateSubnetworks: false` (mode personnalisé) et le nom que vous avez configuré.

Dans la console Cloud, accédez à **VPC network → VPC networks** et vérifiez que le réseau figure dans la liste.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/networks/${NETWORK}" \
>   | jq '{name, autoCreateSubnetworks, routingConfig}'
> ```

### Étape 2.2 — Inspecter les sous-réseaux {#step-22--inspect-subnets}

```bash
gcloud compute networks subnets list \
  --network=${NETWORK} \
  --project=${PROJECT} \
  --format="table(name,region,ipCidrRange,privateIpGoogleAccess)"
```

**Résultat attendu :** un sous-réseau par région de disponibilité configurée, avec la plage CIDR que vous avez indiquée. `privateIpGoogleAccess` doit valoir `True`.

### Étape 2.3 — Vérifier Cloud NAT {#step-23--confirm-cloud-nat}

```bash
gcloud compute routers list \
  --project=${PROJECT} \
  --format="table(name,region,network)"
```

```bash
gcloud compute routers nats list \
  --router=$(gcloud compute routers list \
    --project=${PROJECT} \
    --format="value(name)" \
    --limit=1) \
  --router-region=${REGION} \
  --project=${PROJECT}
```

**Résultat attendu :** un Cloud Router et une passerelle NAT sont présents dans la région principale. Ils permettent aux instances de VM privées d'accéder à Internet pour les mises à jour sans IP publique.

### Étape 2.4 — Vérifier les règles de pare-feu {#step-24--verify-firewall-rules}

```bash
gcloud compute firewall-rules list \
  --project=${PROJECT} \
  --filter="network~${NETWORK}" \
  --format="table(name,direction,sourceRanges[0],allowed[0].ports)"
```

**Résultat attendu :** les règles comprennent `fw-allow-lb-hc` (contrôles de santé de l'équilibreur de charge), `fw-allow-iap-ssh` (SSH via IAP), `fw-allow-intra-vpc-tcp/udp/icmp` (trafic interne) et `fw-allow-nfs-tcp/udp` (port NFS 2049).

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls" \
>   | jq '.items[] | select(.network | endswith("'${NETWORK}'")) | {name, direction, allowed}'
> ```

### Étape 2.5 — Inspecter les comptes de service IAM {#step-25--inspect-iam-service-accounts}

```bash
gcloud iam service-accounts list \
  --project=${PROJECT} \
  --format="table(displayName,email,disabled)"
```

**Résultat attendu :** quatre comptes de service sont listés — `cloudbuild-sa-*`, `clouddeploy-sa-*`, `cloudrun-sa-*` et `app-nfs-sa-*` — chacun portant le suffixe de nommage issu de l'ID de déploiement.

Inspectez les liaisons IAM du compte de service Cloud Run :

```bash
export CLOUDRUN_SA=$(gcloud iam service-accounts list \
  --project=${PROJECT} \
  --filter="email~cloudrun-sa" \
  --format="value(email)" \
  --limit=1)

gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${CLOUDRUN_SA}" \
  --format="table(bindings.role)"
```

**Résultat attendu :** le compte de service Cloud Run détient notamment les rôles `run.admin`, `secretmanager.secretAccessor`, `storage.objectAdmin`, `cloudsql.client` et `vpcaccess.user`.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
>   | jq '.accounts[] | {displayName, email, disabled}'
> ```

### Étape 2.6 — Vérifier le dépôt Artifact Registry {#step-26--verify-artifact-registry-repository}

```bash
gcloud artifacts repositories list \
  --project=${PROJECT} \
  --location=${REGION} \
  --format="table(name,format,location,encryptionConfig)"
```

**Résultat attendu :** un dépôt Docker nommé `shared-repo-*` existe dans la région principale. Si `enable_cmek = true`, `encryptionConfig.kmsKeyName` contient la clé KMS.

Dans la console Cloud, accédez à **Artifact Registry → Repositories** et vérifiez que le dépôt figure dans la liste avec le format `Docker`.

---

## Phase 3 — Vérifier les bases de données [MANUEL] {#phase-3--verify-databases-manual}

### Étape 3.1 — Vérifier l'instance Cloud SQL PostgreSQL [`create_postgres = true`] {#step-31--confirm-cloud-sql-postgresql-instance-create_postgres--true}

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(name,databaseVersion,settings.tier,settings.availabilityType,ipAddresses,state)"
```

**Résultat attendu :** l'instance est à l'état `RUNNABLE`, la version de la base de données correspond à votre configuration, aucune adresse IP publique n'est listée et une adresse IP privée est présente.

Dans la console Cloud, accédez à **SQL** et cliquez sur le nom de l'instance. Examinez les onglets **Overview**, **Connections** et **Backups**.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${PG_INSTANCE}" \
>   | jq '{name, state, databaseVersion, settings: {tier: .settings.tier, availabilityType: .settings.availabilityType}}'
> ```

### Étape 3.2 — Vérifier l'utilisation exclusive d'une IP privée {#step-32--verify-private-ip-only}

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(ipAddresses)"
```

**Résultat attendu :** seule une adresse IP de type `PRIVATE` est listée. Aucune IP `PRIMARY` (publique) n'existe — l'instance n'est accessible que depuis le VPC.

### Étape 3.3 — Vérifier les sauvegardes automatiques {#step-33--verify-automated-backups}

```bash
gcloud sql backups list \
  --instance=${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="table(id,windowStartTime,status,backupKind)" \
  --limit=5
```

**Résultat attendu :** si l'instance a plus de 24 heures, des sauvegardes terminées apparaissent. Si elle vient d'être déployée, la liste peut être vide, mais la configuration de sauvegarde est déjà active (tous les jours à 04:00 UTC, conservation de 7 jours).

### Étape 3.4 — Récupérer le secret du mot de passe root {#step-34--retrieve-the-root-password-secret}

Le mot de passe root est généré automatiquement et stocké dans Secret Manager :

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~postgres" \
  --format="table(name,createTime)"
```

```bash
export PG_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~postgres" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${PG_SECRET}" \
  --project=${PROJECT}
```

**Résultat attendu :** le mot de passe root est renvoyé. Conservez-le en lieu sûr — il s'agit de l'identifiant du superutilisateur de la base de données.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${PG_SECRET}/versions/latest:access" \
>   | jq -r '.payload.data' | base64 --decode
> ```

### Étape 3.5 — Vérifier les indicateurs de base de données {#step-35--check-database-flags}

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(settings.databaseFlags)"
```

**Résultat attendu :** l'indicateur `max_connections` est défini sur `200` (valeur par défaut) ou sur la valeur que vous avez configurée.

### Étape 3.6 — Vérifier l'instance Cloud SQL MySQL [`create_mysql = true`] {#step-36--confirm-cloud-sql-mysql-instance-create_mysql--true}

```bash
export MY_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~MYSQL" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe ${MY_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(name,databaseVersion,settings.tier,settings.availabilityType,ipAddresses,state)"
```

**Résultat attendu :** une deuxième instance Cloud SQL à l'état `RUNNABLE` avec une version `MYSQL_*`, une IP privée uniquement et son propre mot de passe root dans Secret Manager (`gcloud secrets list --filter="name~mysql"`). PostgreSQL et MySQL coexistent en tant qu'instances indépendantes — les applications se rattachent à celle qu'exige leur pile.

### Étape 3.7 — Vérifier le cluster AlloyDB [`enable_alloydb = true`] {#step-37--confirm-alloydb-cluster-enable_alloydb--true}

```bash
gcloud alloydb clusters list --region=${REGION} --project=${PROJECT} \
  --format="table(name,state)"

export ALLOYDB_CLUSTER=$(gcloud alloydb clusters list \
  --region=${REGION} --project=${PROJECT} \
  --format="value(name)" --limit=1)

gcloud alloydb instances list \
  --cluster=$(basename ${ALLOYDB_CLUSTER}) \
  --region=${REGION} --project=${PROJECT} \
  --format="table(name,instanceType,state)"
```

**Résultat attendu :** cette étape ne réussit plus sur un déploiement par défaut. `alloydb.googleapis.com` a été délibérément retiré de `default_apis`, si bien que `enable_alloydb = true` **échoue désormais lors de l'application** au lieu de provisionner un cluster — AlloyDB a été retiré en tant que fonctionnalité coûteuse. Pour exécuter cette étape, vous devez ajouter `alloydb.googleapis.com` à `additional_apis` (et, sur les dossiers gérés par RAD, à la liste d'autorisation `gcp.restrictServiceUsage` de `rad-automation/scripts/02-setup-ui.sh`) — activer l'API sur le projet et l'autoriser au niveau du dossier sont deux verrous indépendants. Notez que le commentaire obsolète de `modules/Services_GCP/alloydb.tf:30` (« Requires alloydb.googleapis.com — added to default_apis in main.tf ») est erroné pour la même raison, et que les lignes 19, 103 et 205-206 de Services_GCP.md reprennent la même hypothèse périmée.

### Étape 3.8 — Vérifier la base de données Firestore [`create_firestore = true`] {#step-38--confirm-firestore-database-create_firestore--true}

```bash
gcloud firestore databases list --project=${PROJECT} \
  --format="table(name,type,locationId)"
```

**Résultat attendu :** une base de données Firestore en mode `FIRESTORE_NATIVE` (l'édition Enterprise utilise une base de données *nommée*, et non `(default)`). Dans la console Cloud, accédez à **Firestore** pour parcourir les collections. Firestore est serverless et s'adapte jusqu'à zéro ; il n'entraîne donc aucun coût de calcul au repos.

---

## Phase 4 — Vérifier le stockage de fichiers et le cache [MANUEL] {#phase-4--verify-file-storage--cache-manual}

Cette phase vérifie le modèle de stockage/cache que vous avez choisi. Les **étapes 4.1 à 4.4** s'appliquent à la VM autogérée (`create_network_filesystem = true`, la valeur par défaut) ; l'**étape 4.5** s'applique aux services gérés (`create_redis` / `create_filestore_nfs`). On utilise normalement l'un ou l'autre modèle — exécuter les deux crée un stockage de fichiers redondant et sujet au split-brain.

### (VM autogérée) {#self-managed-vm}

Les étapes 4.1 à 4.4 s'appliquent lorsque `create_network_filesystem = true` (la valeur par défaut). Si vous avez plutôt choisi les services gérés, passez directement à l'étape 4.5.

### Étape 4.1 — Vérifier que la VM est en cours d'exécution {#step-41--confirm-the-vm-is-running}

```bash
gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="yaml(name,status,machineType,networkInterfaces[0].networkIP)"
```

**Résultat attendu :** la VM est à l'état `RUNNING` avec une adresse IP privée sur le VPC du module. Aucune IP publique n'est attribuée.

Dans la console Cloud, accédez à **Compute Engine → VM instances** et vérifiez que la VM du serveur NFS figure dans la liste et s'exécute.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/instances" \
>   | jq '.items | to_entries[] | .value.instances[]? | select(.tags.items[]? == "nfsserver") | {name, status, zone, networkIP: .networkInterfaces[0].networkIP}'
> ```

### Étape 4.2 — Vérifier le groupe d'instances géré {#step-42--confirm-the-managed-instance-group}

```bash
gcloud compute instance-groups managed list \
  --project=${PROJECT} \
  --format="table(name,zone,targetSize,status.isStable)"
```

**Résultat attendu :** le MIG affiche `targetSize: 1` et `isStable: True`. La règle de réparation automatique surveille le port TCP 2049 (NFS) — si la VM devient défaillante, le MIG la recrée automatiquement.

### Étape 4.3 — Vérifier le disque de données {#step-43--verify-the-data-disk}

```bash
gcloud compute disks list \
  --project=${PROJECT} \
  --filter="users~${NFS_VM}" \
  --format="table(name,zone,sizeGb,type,status)"
```

**Résultat attendu :** un disque persistant SSD de la capacité configurée (10 GB par défaut) est rattaché à la VM avec l'état `READY`.

Dans la console Cloud, accédez à **Compute Engine → Disks** pour afficher le disque, et vérifiez la création des instantanés quotidiens sous **Compute Engine → Snapshots**.

### Étape 4.4 — Vérifier l'IP du serveur NFS dans les sorties {#step-44--verify-nfs-server-ip-in-outputs}

L'IP du serveur NFS est exposée sous la forme `nfs_server_ip` dans les sorties du module ; App CloudRun et App GKE l'utilisent pour monter le partage NFS. Vérifiez qu'elle correspond à l'IP interne de la VM :

```bash
NFS_IP=$(gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="value(networkInterfaces[0].networkIP)")
echo "NFS server IP: ${NFS_IP}"
```

### (Services gérés) {#managed-services}

### Étape 4.5 — Vérifier Memorystore Redis et Filestore [`create_redis` / `create_filestore_nfs = true`] {#step-45--confirm-memorystore-redis--filestore-create_redis--create_filestore_nfs--true}

Si vous êtes passé aux alternatives gérées, vérifiez chacune d'elles. **Memorystore Redis :**

```bash
gcloud redis instances list --region=${REGION} --project=${PROJECT} \
  --format="table(name,tier,memorySizeGb,redisVersion,host,state)"
```

**Résultat attendu :** une instance `READY` au niveau configuré. Sur `STANDARD_HA`, vérifiez le mode de persistance avec `gcloud redis instances describe ... --format="yaml(persistenceConfig)"` — `BASIC` ignore la persistance par conception, c'est pourquoi le module rejette cette combinaison au moment du plan. L'hôte et le port sont exposés via les sorties `redis_host` / `redis_port`.

**Cloud Filestore :**

```bash
gcloud filestore instances list --project=${PROJECT} \
  --format="table(name,tier,fileShares[0].capacityGb,networks[0].ipAddresses[0],state)"
```

**Résultat attendu :** une instance `READY` au niveau choisi, avec une capacité égale ou supérieure au minimum du niveau (1024 GB pour BASIC_HDD/ENTERPRISE, 2560 GB pour BASIC_SSD — contrôlé au moment du plan). L'IP du serveur est exposée via la sortie `filestore_ip`.

---

## Phase 5 — Vérifier le cluster GKE [MANUEL] {#phase-5--verify-gke-cluster-manual}

Cette phase ne s'applique que lorsque `create_google_kubernetes_engine = true`. Passez à la phase 6 si GKE n'a pas été activé.

### Étape 5.1 — Lister les clusters GKE {#step-51--list-gke-clusters}

```bash
gcloud container clusters list \
  --project=${PROJECT} \
  --format="table(name,location,status,autopilot.enabled,currentMasterVersion)"
```

**Résultat attendu :** le ou les clusters sont listés avec `status: RUNNING` et `autopilot.enabled: True`.

Dans la console Cloud, accédez à **Kubernetes Engine → Clusters** pour vérifier que le nombre de clusters attendu est présent.

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
>   | jq '.clusters[] | {name, status, autopilot, currentMasterVersion}'
> ```

### Étape 5.2 — Configurer l'accès kubectl {#step-52--configure-kubectl-access}

```bash
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

kubectl config current-context
```

**Résultat attendu :** un contexte kubeconfig faisant référence à votre projet et à votre cluster s'affiche, par exemple `gke_my-project_us-central1_gke-cluster-1`.

### Étape 5.3 — Vérifier la configuration CIDR du cluster {#step-53--verify-cluster-cidr-configuration}

```bash
gcloud container clusters describe ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(clusterIpv4Cidr,servicesIpv4Cidr,network,subnetwork)"
```

**Résultat attendu :** les plages CIDR des pods et des services correspondent aux valeurs `gke_pod_base_cidr` et `gke_service_base_cidr` configurées. Le cluster est rattaché au VPC du module.

### Étape 5.4 — Vérifier l'enregistrement dans le parc {#step-54--verify-fleet-registration}

```bash
gcloud container fleet memberships list \
  --project=${PROJECT} \
  --format="table(name,state.code,endpoint.gkeCluster.resourceLink)"
```

**Résultat attendu :** chaque cluster apparaît avec `state.code: READY`, ce qui confirme qu'il a rejoint le parc (fleet) GKE et qu'il peut bénéficier des fonctionnalités de parc telles que Config Management et Cloud Service Mesh.

---

## Phase 6 — Vérifier les contrôles de sécurité [MANUEL] {#phase-6--verify-security-controls-manual}

Cette phase couvre les contrôles de sécurité facultatifs. Les étapes ne s'appliquent que si la fonctionnalité concernée a été activée lors du déploiement.

### Étape 6.1 — CMEK : vérifier le trousseau de clés et la clé KMS {#step-61--cmek-verify-kms-key-ring-and-key}

S'applique lorsque `enable_cmek = true` :

```bash
gcloud kms keyrings list \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="table(name,createTime)"
```

```bash
export KEYRING=$(gcloud kms keyrings list \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud kms keys list \
  --keyring=${KEYRING} \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="table(name,purpose,rotationPeriod,nextRotationTime,primary.state)"
```

**Résultat attendu :** un trousseau de clés et au moins une clé d'objectif `ENCRYPT_DECRYPT` existent dans la région principale. L'état de la version principale de la clé est `ENABLED`. Vérifiez que l'instance Cloud SQL et le dépôt Artifact Registry affichent un chiffrement géré par le client sur leurs pages de console respectives.

### Étape 6.2 — Binary Authorization : vérifier la règle {#step-62--binary-authorization-verify-policy}

S'applique lorsque `enable_binary_authorization = true` :

```bash
gcloud container binauthz policy export --project=${PROJECT}
```

**Résultat attendu :** une règle Binary Authorization est renvoyée, indiquant le `evaluationMode` configuré (`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION` ou `ALWAYS_DENY`).

Listez les attesteurs configurés :

```bash
gcloud container binauthz attestors list \
  --project=${PROJECT} \
  --format="table(name,userOwnedGrafeasNote.noteReference)"
```

Dans la console Cloud, accédez à **Security → Binary Authorization** pour afficher la règle et les attesteurs.

### Étape 6.3 — VPC Service Controls : vérifier le périmètre {#step-63--vpc-service-controls-verify-perimeter}

S'applique lorsque `enable_vpc_sc = true` :

```bash
gcloud access-context-manager policies list --organization=ORG_ID
```

```bash
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"
```

**Résultat attendu :** un périmètre existe et liste le projet comme ressource protégée. Lorsque `vpc_sc_dry_run = true` (valeur par défaut), le périmètre est en mode audit — les violations sont journalisées, mais les requêtes ne sont pas bloquées.

Consultez les violations en mode simulation (dry-run) pour repérer, avant l'application, les schémas d'accès qui seraient bloqués :

```bash
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

Dans la console Cloud, accédez à **Security → VPC Service Controls** pour afficher le périmètre et son mode actuel.

### Étape 6.4 — Security Command Center : vérifier les résultats [`enable_security_command_center = true`] {#step-64--security-command-center-verify-findings-enable_security_command_center--true}

```bash
gcloud scc findings list ${PROJECT} \
  --source=- \
  --filter="state=\"ACTIVE\"" \
  --format="table(category,severity,eventTime)" \
  --limit=10
```

**Résultat attendu :** SCC est actif et fait remonter les résultats de ses détecteurs intégrés (buckets accessibles publiquement, comptes de service dotés de privilèges excessifs, règles de pare-feu ouvertes). Les résultats d'un projet fraîchement déployé peuvent être rares — l'essentiel est que l'analyseur fonctionne. Si `enable_scc_notifications = true`, vérifiez que le sujet Pub/Sub existe avec `gcloud pubsub topics list --project=${PROJECT}` (la configuration de notification exige que SCC soit activé, ce qui est contrôlé au moment du plan). La création du périmètre et des notifications est ignorée avec un avertissement si l'identité de déploiement ne dispose pas du rôle au niveau de l'organisation.

Dans la console Cloud, accédez à **Security → Security Command Center → Findings** pour parcourir les résultats par gravité et par source.

---

## Phase 7 — Cloud Logging et Monitoring [MANUEL] {#phase-7--cloud-logging--monitoring-manual}

### Étape 7.1 — Vérifier les journaux d'activation des API {#step-71--confirm-api-enablement-logs}

Affichez les entrées du journal d'audit générées lors de l'activation des API pendant le déploiement :

```bash
gcloud logging read \
  'protoPayload.methodName="google.api.serviceusage.v1.ServiceUsage.EnableService"' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp,protoPayload.resourceName)"
```

**Résultat attendu :** les entrées de journal montrent les 46 API ou plus activées par ce module lors du déploiement initial.

### Étape 7.2 — Afficher les journaux d'audit des activités d'administration {#step-72--view-admin-activity-audit-logs}

```bash
gcloud logging read \
  'logName="projects/'${PROJECT}'/logs/cloudaudit.googleapis.com%2Factivity" AND protoPayload.serviceName="compute.googleapis.com"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.authenticationInfo.principalEmail)"
```

**Résultat attendu :** les événements de création de l'infrastructure sont journalisés, y compris la création du réseau VPC, des sous-réseaux et des règles de pare-feu.

### Étape 7.3 — Vérifier les règles d'alerte Cloud Monitoring {#step-73--check-cloud-monitoring-alert-policies}

S'applique lorsque `configure_email_notification = true` :

```bash
gcloud beta monitoring channels list \
  --project=${PROJECT} \
  --format="table(displayName,type,labels.email_address,enabled)"
```

**Résultat attendu :** un canal de notification par e-mail est listé avec la ou les adresses de `notification_alert_emails`.

```bash
gcloud alpha monitoring policies list \
  --project=${PROJECT} \
  --format="table(displayName,enabled,conditions[0].displayName)"
```

**Résultat attendu :** trois règles d'alerte sont listées — pour les seuils d'utilisation du CPU, de la mémoire et du disque — chacune associée au canal de notification.

Dans la console Cloud, accédez à **Monitoring → Alerting → Policies** pour afficher les règles et leur état actuel (`OK`, `No data` ou `Alerting`).

> **Équivalent API REST :**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
>   | jq '.alertPolicies[] | {displayName, enabled, conditions: [.conditions[].displayName]}'
> ```

### Étape 7.4 — Explorer les métriques Compute Engine (VM NFS) {#step-74--explore-compute-engine-metrics-nfs-vm}

S'applique lorsque `create_network_filesystem = true`. Dans la console Cloud, accédez à **Monitoring → Metrics Explorer** et exécutez les requêtes suivantes :

**Utilisation CPU de la VM NFS :**
```
fetch gce_instance
| metric 'compute.googleapis.com/instance/cpu/utilization'
| filter resource.instance_id == 'INSTANCE_ID'
| every 1m
```

**Utilisation du disque de la VM NFS :**
```
fetch gce_instance
| metric 'compute.googleapis.com/instance/disk/write_bytes_count'
| filter resource.instance_id == 'INSTANCE_ID'
| every 1m
```

Remplacez `INSTANCE_ID` par l'ID d'instance de la VM, que vous pouvez récupérer avec :

```bash
gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="value(id)"
```

---

## Phase 8 — Dépanner et déboguer [MANUEL] {#phase-8--troubleshoot--debug-manual}

Des diagnostics durables, au niveau de la plateforme, pour les problèmes les plus courants lors de la mise en place
ou de l'exploitation de la plateforme partagée. Ces techniques ne changent pas avec les versions des produits.

- **API non activées / le déploiement échoue tôt :** vérifiez que les services requis sont
  activés, puis relancez.
  ```bash
  gcloud services list --enabled --project="$PROJECT" | grep -E 'compute|sqladmin|container|file|redis|servicenetworking'
  ```
- **Erreurs d'appairage VPC / d'accès aux services privés (Cloud SQL, Filestore) :** vérifiez que la
  connexion `servicenetworking` et la plage d'appairage allouée existent.
  ```bash
  gcloud services vpc-peerings list --network="$(gcloud compute networks list --project=$PROJECT --format='value(name)' --limit=1)" --project="$PROJECT"
  ```
- **Refus IAM / de règles d'organisation (création de compte de service, VPC-SC, SCC) :** l'identité de déploiement
  ne dispose peut-être pas des rôles au niveau de l'organisation ; le module ignore alors les fonctionnalités à portée organisation (périmètre VPC-SC, notifications
  SCC) avec un avertissement au lieu d'échouer. Examinez les journaux de déploiement et les
  liaisons IAM du projet.
- **Erreurs de quota (CPU, adresses IP, SSD) :** vérifiez l'utilisation des quotas dans la région.
  ```bash
  gcloud compute regions describe "$REGION" --project="$PROJECT" --format="value(quotas)"
  ```
- **Cluster GKE non prêt :** inspectez l'état du cluster et ses opérations.
  ```bash
  gcloud container clusters describe "$(gcloud container clusters list --project=$PROJECT --format='value(name)' --limit=1)" --region="$REGION" --project="$PROJECT" --format="value(status)"
  gcloud container operations list --project="$PROJECT" --region="$REGION" --limit=5
  ```
- **Les créations de longue durée sont normales, pas bloquées.** Le module définit des
  délais de création/mise à jour généreux pour les ressources lentes — jusqu'à 60 min pour Cloud SQL et AlloyDB,
  40 à 60 min pour les clusters GKE, 30 min pour Memorystore/Filestore et la connexion Private Service Access
  — afin qu'un provisionnement lent puisse aller à son terme plutôt que d'être
  abandonné. Une création GKE Autopilot de 10 à 15 minutes ou une création Cloud SQL de plusieurs minutes
  est normale.
- **Ressource existante dans GCP mais absente de l'état Terraform (orpheline).** Il arrive rarement qu'une
  erreur transitoire d'API ou d'opération (ou un identifiant de déploiement qui expire pendant une
  application très longue) mette fin à l'application *après* que la ressource a effectivement été créée,
  la laissant active mais non gérée. C'est récupérable, il n'y a pas de perte de données :
  - **Relancez le déploiement.** Un état partiel reprend simplement — la plupart des ressources
    sont déjà présentes, si bien que la nouvelle application se termine rapidement sans reconstruire
    l'image ni les ressources lentes.
  - **Si une ressource signale « already exists » lors de la nouvelle application, importez-la** au lieu
    de la supprimer et de la recréer (ce qui est lent et, pour Cloud SQL, bloqué par la réservation
    du nom). Par exemple, pour adopter une instance Cloud SQL créée mais non
    enregistrée :
    ```bash
    # Platform deploys run via the RAD pipeline; for a manual recovery from the
    # module directory:
    tofu import 'google_sql_database_instance.postgres_instance[0]' "${PROJECT}/${PG_INSTANCE}"
    ```
    puis relancez le plan et vérifiez que la ressource apparaît en « update in-place » et non en « replace ».
- **Exploration des ressources :** utilisez les étapes de vérification par service des phases 2 à 6 ci-dessus pour
  confirmer que chaque composant est opérationnel. Pour les pièges propres à chaque paramètre, consultez la
  section *Configuration Pitfalls* du Guide de configuration.

---

## Phase 9 — Supprimer [AUTOMATISÉ] {#phase-9--tear-down-automated}

Lorsque vous avez terminé, ouvrez la page **Deployments** de la plateforme RAD, repérez votre déploiement `Services GCP` et cliquez sur l'icône **Trash** (**Delete**) pour supprimer toutes les ressources provisionnées par ce module (cela exécute `terraform destroy`).

> **Important :** tous les modules applicatifs (`*_CloudRun`, `*_GKE`) qui dépendent de ce déploiement `Services GCP` **doivent être supprimés au préalable**. Détruire `Services GCP` alors que des modules applicatifs s'exécutent encore coupera leur connectivité à la base de données, au NFS et au réseau.

**Durées de suppression attendues :**

| Ressource | Durée typique |
|---|---|
| Cluster GKE + désenregistrement du parc (si activé) | 5–10 minutes |
| Instances Cloud SQL | 3–5 minutes |
| Cloud Memorystore Redis (si activé) | 2–3 minutes |
| Cloud Filestore NFS (si activé) | 2–3 minutes |
| VM NFS/Redis et groupe d'instances géré | 2–3 minutes |
| Réseau VPC, sous-réseaux, règles de pare-feu, Cloud NAT | 2–4 minutes |
| Dépôt Artifact Registry | 1–2 minutes |
| Trousseau de clés et clés KMS (si CMEK est activé) | 1–2 minutes |
| Secrets Secret Manager | < 1 minute |
| Comptes de service IAM | < 1 minute |
| **Total (valeurs par défaut)** | **12–20 minutes** |
| **Total (avec GKE)** | **20–30 minutes** |

> **Remarque :** les versions de clés KMS peuvent passer à l'état `DESTROY_SCHEDULED` avec un délai de grâce de 24 heures avant leur suppression définitive. Il s'agit d'une fonctionnalité de sécurité de Cloud KMS — la clé et les données qu'elle chiffre restent accessibles jusqu'à l'expiration du délai de grâce.

---

## Résumé {#summary}

| Action | Phase | Automatisé |
|---|---|---|
| Choisir un parcours de lab et configurer les variables dans la plateforme RAD | 1.1 | Manuel |
| Déployer les API, le réseau, les bases de données, la VM NFS et Artifact Registry | 1.2 | Automatisé |
| Relever les sorties dans l'onglet Outputs du déploiement | 1.3 | Manuel |
| Vérifier le réseau VPC, les sous-réseaux, le NAT et les règles de pare-feu | 2 | Manuel |
| Inspecter les comptes de service IAM et Artifact Registry | 2 | Manuel |
| Vérifier Cloud SQL (PostgreSQL + MySQL), AlloyDB et Firestore | 3 | Manuel |
| Vérifier la VM NFS/Redis autogérée, ou Memorystore + Filestore gérés | 4 | Manuel |
| Configurer kubectl et vérifier le cluster GKE et le parc (si activé) | 5 | Manuel |
| Vérifier CMEK, Binary Authorization et VPC-SC (si activés) | 6 | Manuel |
| Examiner les journaux d'audit, les règles d'alerte et les métriques Compute | 7 | Manuel |
| Dépanner les problèmes courants de la plateforme | 8 | Manuel |
| Supprimer toutes les ressources du module | 9 | Automatisé |
