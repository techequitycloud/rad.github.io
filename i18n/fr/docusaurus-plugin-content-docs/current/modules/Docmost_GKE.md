---
title: "Docmost sur GKE Autopilot"
description: "Référence de configuration pour déployer Docmost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Docmost_GKE.md @ 3055034 sha256:9cb54d6bd78c -->

# Docmost sur GKE Autopilot {#docmost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_GKE.png" alt="Docmost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost est une plateforme open source de wiki et de documentation collaborative en
temps réel (une alternative à Confluence/Notion) construite sur NestJS. Ce module
déploie Docmost sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Docmost et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Docmost s'exécute comme une charge de travail web Node.js (NestJS) sur le port 3000.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods NestJS sur le port 3000, mis à l'échelle horizontalement entre 1 et 3 réplicas |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Docmost ne prend pas en charge MySQL ni d'autres moteurs |
| Cache et collaboration | Redis | **Obligatoire** pour l'édition en temps réel et les files d'attente en arrière-plan ; activé par défaut |
| Stockage de fichiers | Filestore / NFS | Pièces jointes écrites sur le volume adossé à NFS à `/app/data/storage` |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement (non utilisé par le pilote `local` par défaut) |
| Secrets | Secret Manager | `APP_SECRET` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Redis est obligatoire et activé par défaut.** Docmost utilise Redis pour l'édition
  collaborative en temps réel et les files d'attente de tâches en arrière-plan.
  `enable_redis = true` est la valeur par défaut ; laisser `redis_host` vide place Redis
  sur la VM du serveur NFS.
- **NFS est activé par défaut** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Le pilote de stockage `local` de Docmost y écrit les pièces jointes téléversées afin
  qu'elles survivent aux redémarrages des pods et soient partagées entre les réplicas.
- **`APP_SECRET` est généré automatiquement** et stocké dans Secret Manager (également
  matérialisé dans un Secret Kubernetes via le chemin à valeurs de secret explicites). Il
  signe et chiffre les sessions et les données sensibles et ne doit jamais être modifié
  après le premier démarrage sans fenêtre de maintenance.
- **La base de données est jointe via le sidecar Cloud SQL Auth Proxy sur `127.0.0.1`**
  (boucle locale en clair, `sslmode=disable`) — le point d'entrée bifurque selon `DB_HOST`
  pour choisir la forme de connexion et le mode SSL adaptés à chaque plateforme.
- **Une image personnalisée est construite via Cloud Build** (`container_image_source = "custom"`,
  base `docmost/docmost:latest`) ; elle encapsule l'image officielle avec le point d'entrée
  qui assemble `DATABASE_URL` / `REDIS_URL` / `APP_URL`. Les images reconstruites sont
  déployées avec `imagePullPolicy=Always`.
- **Un minimum d'un réplica est maintenu** (`min_instance_count = 1` ; GKE ne prend pas
  en charge la mise à l'échelle à zéro) afin que le wiki et le point de terminaison de
  collaboration restent toujours joignables.
- **La configuration initiale se fait via l'interface.** Docmost n'a pas d'identifiants
  par défaut — le premier visiteur crée l'espace de travail initial et le compte administrateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Docmost {#a-gke-autopilot--the-docmost-workload}

Les pods Docmost sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas. Comme les pièces
jointes résident sur le volume NFS partagé, le Deployment utilise la stratégie
`Recreate` pour les mises à jour, afin d'éviter que deux pods écrivent le même état
NFS/base de données pendant un déploiement progressif.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Docmost
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Docmost stocke toutes les données de l'application (espaces, pages, commentaires,
utilisateurs, autorisations) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods la joignent de façon privée via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1`
(boucle locale en clair) ; aucune IP publique n'est exposée. Lors du premier déploiement,
un Job d'initialisation crée la base de données et l'utilisateur de l'application ;
Docmost applique ensuite automatiquement ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`docmost`), l'utilisateur (`docmost`) et le
secret Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la
rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Redis (collaboration en temps réel et files d'attente) {#c-redis-real-time-collaboration--queues}

Redis est **activé par défaut** et est indispensable à l'éditeur collaboratif en temps
réel de Docmost et au traitement des tâches en arrière-plan. Lorsque `redis_host` est
laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur NFS sert de point de
terminaison Redis ; définissez `redis_host` (et éventuellement `redis_auth`) pour
pointer plutôt vers une instance Redis gérée/externe.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_URL is assembled inside the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_URL
  ```

### D. Cloud Storage et stockage de fichiers NFS {#d-cloud-storage--nfs-file-storage}

Docmost écrit les pièces jointes téléversées via son pilote de stockage `local` à
`/app/data/storage`, adossé au volume **NFS** afin que les fichiers persistent après les
redémarrages des pods et soient partagés entre les réplicas. Un bucket de données
**Cloud Storage** dédié est également provisionné automatiquement (disponible si vous
faites passer Docmost à un pilote de stockage d'objets).

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (utilisé pour signer et chiffrer les sessions et les données sensibles).
Sur GKE, il est également matérialisé dans un Secret Kubernetes. Le mot de passe de la
base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Docmost {#3-docmost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et, de façon idempotente, crée la base de données et l'utilisateur
  de l'application et accorde les privilèges, puis signale au sidecar du proxy de
  s'arrêter afin que le Job puisse se terminer. La tâche peut être relancée sans risque.
- **Les migrations s'exécutent automatiquement au démarrage.** Docmost exécute ses
  propres migrations de schéma à chaque démarrage via sa commande par défaut `pnpm start`,
  si bien qu'une mise à niveau de la version de l'application applique les changements de
  schéma sans étape de migration distincte.
- **`APP_SECRET` est immuable après le premier démarrage.** Il est généré une fois et
  écrit dans Secret Manager (et dans un Secret Kubernetes). Le faire tourner invalide
  toutes les sessions existantes et rend irrécupérables les données chiffrées avec
  l'ancienne valeur — ne le faites tourner que pendant une fenêtre de maintenance planifiée.
- **`APP_URL` doit correspondre à l'URL joignable.** Elle est injectée comme l'URL
  interne/prévue du service et sert aux liens absolus et au WebSocket de collaboration.
  Une fois l'IP du LoadBalancer externe (ou le domaine personnalisé) connue, définissez
  `APP_URL` sur cette URL externe via `environment_variables` (ou corrigez le Deployment) :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" APP_URL="https://docmost.example.com"
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health` — le
  point de terminaison public de Docmost qui renvoie 200. Prévoyez environ 2 minutes au
  premier démarrage pendant l'exécution des migrations.
- **Création du compte au premier lancement.** Docmost est livré sans identifiants par
  défaut. Rendez-vous sur l'IP du LoadBalancer / le domaine et remplissez le formulaire
  de configuration pour créer le premier espace de travail et l'utilisateur administrateur.
  Faites-le rapidement après le déploiement.
- **Reconstructions de l'image personnalisée.** Comme l'image est construite sur mesure,
  les images reconstruites réutilisent un tag de version ; App_GKE définit
  `imagePullPolicy=Always` afin que les nœuds récupèrent l'image fraîche plutôt que de
  servir une couche en cache obsolète.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Docmost ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docmost` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Docmost` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Docmost (associé à l'ARG de build `DOCMOST_VERSION`) ; épinglez une version précise en production. |

### Groupe 4 — Conteneur et mise à l'échelle {#group-4--container--scale}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Docmost est construit à partir d'un Dockerfile personnalisé qui encapsule l'image officielle. |
| `container_image` | `docmost/docmost:latest` | Image de base amont qu'encapsule le build personnalisé. |
| `container_port` | `3000` | Docmost écoute sur le port 3000. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `3` | Nombre maximal de réplicas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connexion en boucle locale. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) sont définies automatiquement — ne définissez pas `APP_SECRET`, `DATABASE_URL` ni `REDIS_URL` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en `Deployment` (sans état ; l'état réside dans Postgres/NFS). |
| `session_affinity` | `ClientIP` | Le routage persistant maintient le WebSocket de collaboration d'un client sur un même pod. |
| `namespace_name` | `""` | Espace de noms (par défaut, l'espace de noms dérivé propre à l'application). |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez désactivé — Docmost conserve son état dans PostgreSQL et le NFS partagé, pas dans des PVC par pod. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod (uniquement si un StatefulSet est choisi). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` / `quota_memory_requests` / `quota_memory_limits` | `false` / `""` / `""` | **Non référencées** — l'ensemble du bloc du groupe 8 n'est déclaré que pour la compatibilité d'interface ; il n'a aucun effet sur le déploiement de ce module. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health` délai de 60s | Sonde de démarrage. Prévoyez environ 2 minutes au premier démarrage. |
| `health_check_config` | HTTP `/api/health` | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring facultatif (point de terminaison public). |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — il sert de support au chemin des pièces jointes `/app/data/storage`. |
| `nfs_mount_path` | `/app/data/storage` | Chemin de montage correspondant au pilote de stockage local de Docmost. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — Docmost utilise Redis pour l'édition en temps réel et les files d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé — Docmost exige PostgreSQL 15. |
| `application_database_name` | `docmost` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `docmost` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Docmost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage, un quota de mémoire exprimé par un entier nu. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_SECRET` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Le faire tourner invalide toutes les sessions et rend irrécupérables les données chiffrées avec l'ancienne valeur. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Docmost exige PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_redis` | `true` | Critique | L'éditeur en temps réel et les files d'attente de Docmost ont besoin de Redis ; le désactiver empêche l'application de fonctionner correctement. |
| `enable_nfs` | `true` | Élevé | Sans NFS, les pièces jointes téléversées atterrissent sur le disque éphémère du pod et sont perdues au redémarrage / non partagées entre les réplicas. |
| `APP_URL` | URL externe du LoadBalancer / du domaine | Élevé | Une URL erronée casse les liens absolus et le point de terminaison WebSocket de collaboration. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, le WebSocket de collaboration d'un client peut se reconnecter à un autre pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est nécessaire pour la connexion PostgreSQL en boucle locale. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; conserver 1 garantit que le wiki reste toujours joignable. |
| `stateful_pvc_enabled` | laisser désactivé | Moyen | Les PVC par pod sont inutiles — Docmost conserve son état dans Postgres/NFS ; les activer ajoute du coût et de la complexité. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à Docmost, partagée avec la variante Cloud Run, est
décrite dans **[Docmost_Common](Docmost_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Docmost sur GKE Autopilot](../labs/Docmost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docmost sur Google Cloud Run](Docmost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Docmost Common — Configuration applicative partagée](Docmost_Common.md) — la configuration partagée par les deux cibles de déploiement.
