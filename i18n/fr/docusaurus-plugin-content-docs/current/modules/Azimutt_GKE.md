---
title: "Azimutt sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Azimutt sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Azimutt_GKE.md @ 15fd4c7 sha256:0d7c7fe7d786 -->

# Azimutt sur GKE Autopilot {#azimutt-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_GKE.png" alt="Azimutt sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de base de données et un outil ERD (diagramme
entité-relation) open source de nouvelle génération pour les bases de données réelles,
construit avec Elixir/Phoenix. Il permet aux équipes d'explorer, de documenter et de
concevoir de grands schémas (des milliers de tables), de rechercher des colonnes et
des relations, et de partager des diagrammes. Ce module déploie Azimutt sur **GKE
Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Azimutt et sur la façon de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la
fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme une seule charge de travail web Elixir/Phoenix écoutant sur le
port **4000**. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Phoenix, auto-scalés horizontalement ; facturation pour le CPU/mémoire demandé |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Azimutt ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage de fichiers | Cloud Filestore (NFS) | Optionnel, désactivé par défaut (`enable_nfs = false`) : Azimutt écrit les téléchargements dans son propre répertoire de travail éphémère, jamais sur ce montage (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné (disponible pour un adaptateur de fichiers compatible S3) |
| Secrets | Secret Manager | Phoenix `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Wrapper léger FROM `ghcr.io/azimuttapp/azimutt`, mis en miroir dans Artifact Registry |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur empêche le
  démarrage. Toutes les données du projet Azimutt résident dans Postgres.
- **Azimutt se connecte à Postgres via la boucle de rappel du proxy d'authentification
  (sans SSL).** Ecto ne peut pas analyser le DSN du socket Cloud SQL, donc sur GKE
  le point d'entrée construit `DATABASE_URL` contre `127.0.0.1` (le sidecar
  Cloud SQL Auth Proxy, qui termine TLS) avec `DATABASE_ENABLE_SSL=false`. `enable_cloudsql_volume = true` est
  requis.
- **`container_port` et les sondes doivent être 4000.** Sur GKE, la plateforme
  n'injecte **pas** automatiquement `PORT`, donc le point d'entrée
  définit par défaut `PORT=4000` ; le port du Service et les sondes doivent
  correspondre, sinon le pod ne devient jamais Ready même si l'application est
  saine.
- **NFS est désactivé par défaut** (`enable_nfs = false`) car rien dans ce module
  n'y écrit — `FILE_STORAGE_ADAPTER` reste `local`, donc les téléchargements
  atterrissent sur le disque éphémère du pod, que NFS soit monté ou non. Les
  données du projet elles-mêmes (schémas, diagrammes, mises en page, utilisateurs)
  résident dans Postgres et ne sont pas affectées.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager.
  Le faire pivoter après le premier démarrage déconnecte toutes les sessions
  actives ; ne le faites pivoter que pendant une fenêtre de maintenance.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`) — GKE ne prend
  pas en charge la mise à l'échelle à zéro, ce qui maintient Azimutt toujours
  accessible.
- **Les migrations s'exécutent automatiquement à chaque démarrage** (`/app/bin/migrate && /app/bin/server`) ;
  prévoyez un temps supplémentaire pour le premier démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Épinglez à une
  version spécifique en production.
- **L'inscription est ouverte par défaut.** Restreignez l'accès après avoir créé
  votre premier compte.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Azimutt {#a-gke-autopilot--the-azimutt-workload}

Les pods Azimutt sont planifiés sur Autopilot, qui facture le CPU/mémoire
réellement demandé par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Azimutt pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep cloud-entrypoint  # resolved DB wiring
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données de l'application (schémas, diagrammes, mises en
page, utilisateurs, sources) dans une instance gérée de Cloud SQL pour PostgreSQL
15. Les pods l'atteignent via le **sidecar Cloud SQL Auth Proxy** sur `127.0.0.1`
(TLS terminé par le proxy, donc `DATABASE_ENABLE_SSL=false`). Lors du premier déploiement, un
job d'initialisation crée la base de données et le rôle de l'application ; Azimutt
exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) et Cloud Storage {#c-cloud-filestore-nfs--cloud-storage}

NFS est **désactivé par défaut** (`enable_nfs = false`) ; s'il est activé, il est
monté à `nfs_mount_path`, mais il n'est pas relié au chemin de stockage d'Azimutt
— avec le `FILE_STORAGE_ADAPTER = local` par défaut, Azimutt écrit toujours les téléchargements
dans son propre répertoire de travail éphémère plutôt que sur ce montage. Un bucket
**Cloud Storage** est également provisionné (disponible si vous passez Azimutt à un
adaptateur de fichiers compatible S3). Les données du projet elles-mêmes (schémas,
diagrammes, mises en page, utilisateurs) résident dans Postgres et ne sont pas
affectées dans les deux cas.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, les options CMEK et les
montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** de Phoenix est généré automatiquement et stocké dans
Secret Manager (utilisé pour signer et chiffrer les cookies de session). Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est un wrapper léger construit FROM `ghcr.io/azimuttapp/azimutt` ; Cloud
Build produit l'image wrappée et elle est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`). Parce qu'il s'agit d'une image reconstruite/mise en miroir,
App_GKE définit `imagePullPolicy = Always` afin que les nœuds ne servent jamais une couche
mise en cache périmée.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré
par Google peut être activé, et une adresse IP statique peut être réservée afin que
l'adresse survive aux redéploiements. `session_affinity = ClientIP` maintient un client
épinglé à un pod.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles. Les lignes `cloud-entrypoint` affichent le
chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle de l'application (`LOGIN CREATEDB`) et la base de
  données, accorde `ALL` sur la base de données et le schéma
  `public`, et `ALTER` le propriétaire du schéma — Azimutt a besoin de
  droits DDL complets car il exécute ses propres migrations. Le job signale ensuite
  au sidecar Auth Proxy de s'arrêter (`/quitquitquit`) afin que le pod du job se
  termine. Peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est
  `/app/bin/migrate && /app/bin/server`, donc Ecto applique les migrations en attente à chaque
  démarrage avant que le point d'accès Phoenix ne se lie. La mise à niveau
  `application_version` applique automatiquement les modifications de schéma.
- **Le câblage de la base de données d'exécution est composé par le point
  d'entrée.** Sur GKE, `DATABASE_URL` est construit contre la boucle de rappel
  du proxy d'authentification (`127.0.0.1`) avec `DATABASE_ENABLE_SSL=false`, et
  `PORT` est défini par défaut à 4000 (GKE ne l'injecte pas
  automatiquement). `PHX_HOST` est dérivé de l'URL du service injecté.
- **`SECRET_KEY_BASE` est stable et effectivement immuable.** Le faire pivoter
  invalide tous les cookies de session actifs — tous les utilisateurs sont
  déconnectés. Ne le faites pivoter que pendant une fenêtre de maintenance.
- **Chemin de santé.** La sonde de démarrage cible la racine Phoenix
  `/` et la sonde de vivacité `/health`, toutes deux avec un
  délai initial de 60 secondes. La sonde de vivacité est mise en miroir dans la
  vérification de santé de la passerelle, qui nécessite un 200 littéral, elle ne
  doit donc pas pointer vers `/`. Les sondes et `container_port`
  doivent toutes deux être **4000** ou le pod ne devient jamais Ready.
- **Configuration initiale.** Accédez au service via son adresse IP externe de
  LoadBalancer (ou domaine personnalisé) et créez le premier compte Azimutt via
  la page d'inscription. L'inscription est ouverte par défaut — restreignez
  l'accès par la suite.
- **Inspectez l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Azimutt sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son
comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `azimutt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag de l'image Azimutt ; `latest` correspond au tag `main`. Épinglez à une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Nombre maximum de réplicas. |
| `container_port` | `4000` | Phoenix écoute sur le port 4000 ; les sondes et le port du Service doivent correspondre. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour la connexion à la base de données `127.0.0.1` ; requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Déploiement par défaut ; se résout automatiquement en StatefulSet si `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser vide — Azimutt est basé sur NFS et stocke les données du projet dans Postgres. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, fenêtre d'échec de 30 × 15s | Sonde de démarrage ; prévoir du temps pour les migrations au premier démarrage. Doit cibler le port 4000. |
| `liveness_probe` | HTTP `/health`, délai de 60s | Sonde de vivacité ; également la vérification de santé de la passerelle, qui nécessite un 200 littéral. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, sondes d'infrastructure de niveau App_GKE | Sondes structurées. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité optionnelle de Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : rien dans ce module n'écrit sur le montage NFS. Azimutt stocke les téléchargements avec `FILE_STORAGE_ADAPTER = local` sur le disque éphémère du conteneur ; les téléchargements durables nécessitent l'adaptateur `s3` d'Azimutt_Common, que l'activation de NFS n'a jamais fourni. Les données du projet résident dans PostgreSQL. |
| `nfs_mount_path` | `/opt/azimutt/storage` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les jobs en arrière-plan, pas Redis. |
| `redis_host` | `""` | Point d'accès Redis (uniquement si une fonctionnalité en aval le requiert). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `azimutt` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupes 19-22 — Domaine personnalisé, IAP, Cloud Armor, VPC-SC {#groups-1922--custom-domain-iap-cloud-armor-vpc-sc}

Comportement standard d'App_GKE — `enable_custom_domain`, `reserve_static_ip`,
`enable_iap`, `enable_cloud_armor`, `enable_vpc_sc`, `enable_audit_logging`. Voir
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Azimutt. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès DB (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors
> de portée, un `quota_memory_*` entier nu. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide tous les cookies de session actifs — tous les utilisateurs sont déconnectés. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et orpheline toutes les données Azimutt. |
| `container_port` | `4000` | Critique | Le point d'entrée définit par défaut `PORT=4000` sur GKE ; un port de service ou un port de sonde non concordant atteint un port mort et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy fournit la connexion à la base de données `127.0.0.1` ; le désactiver laisse Azimutt sans base de données et bloque le démarrage `db-init`. |
| `enable_nfs` | `false` | Faible | L'activer provisionne Filestore, mais n'a aucun effet sur Azimutt lui-même — `FILE_STORAGE_ADAPTER` n'est jamais pointé vers le montage NFS, donc les téléchargements atterrissent toujours sur le disque éphémère du pod, quel que soit ce paramètre (les données du projet elles-mêmes sont en sécurité dans Postgres). |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `application_version` | Épingler une version | Élevé | `latest` correspond au tag `main` roulant ; un changement inattendu en amont peut casser un redéploiement. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions UI rebondissent entre les pods. |
| `enable_iap` / domaine personnalisé | Restreindre après le premier compte | Élevé | L'inscription est ouverte par défaut ; laisser le LoadBalancer publiquement accessible permet à quiconque de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_redis` | `false` | Faible | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Azimutt
partagée avec la variante Cloud Run est décrite dans
**[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Azimutt sur GKE Autopilot](../labs/Azimutt_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration d'application partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
