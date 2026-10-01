---
title: "N8N AI sur GKE Autopilot"
description: "Référence de configuration pour déployer N8N AI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/N8N_AI_GKE.md @ 3055034 sha256:2012f2a1b740 -->

# N8N AI sur GKE Autopilot {#n8n-ai-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_AI_GKE.png" alt="N8N AI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme open source d'automatisation de workflows dotée d'une interface
visuelle à base de nœuds pour connecter des services, exécuter de la logique et construire
des pipelines alimentés par l'IA. Ce module déploie n8n sur **GKE Autopilot** aux côtés de
deux services d'IA compagnons — **Qdrant** (base de données vectorielle pour le RAG et la
recherche sémantique) et **Ollama** (inférence LLM locale pour une IA respectueuse de la
confidentialité) — en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par n8n AI et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle
automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

N8N AI s'exécute comme une charge de travail de workflows Node.js aux côtés de Deployments
Kubernetes Qdrant et Ollama. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deployments n8n + Qdrant + Ollama, 2 vCPU / 4 GiB par défaut pour n8n |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — n8n requiert PostgreSQL ; le moteur est imposé |
| Stockage d'objets | Cloud Storage (GCS Fuse) | Bucket de données d'IA partagé monté sur `/mnt/gcs` ; données des workflows dans `/home/node/.n8n` |
| Fichiers partagés | Filestore (NFS) | Volume NFS partagé pour la persistance entre réplicas ; sert aussi d'hôte Redis par défaut |
| Cache et file d'attente | Redis | Activé par défaut ; utilisé pour le mode file d'attente de n8n sur plusieurs réplicas |
| Base de données vectorielle | Qdrant (dans le cluster) | Déployé comme Deployment Kubernetes compagnon ; service ClusterIP interne uniquement |
| Inférence LLM | Ollama (dans le cluster) | Déployé comme Deployment Kubernetes compagnon ; service ClusterIP interne uniquement |
| Secrets | Secret Manager | `N8N_ENCRYPTION_KEY` et `N8N_SMTP_PASS` générés automatiquement ; synchronisés vers des Secrets Kubernetes |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option via la Gateway API |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  configuration commune ; passer `database_type` à MySQL empêche le démarrage.
- **`N8N_ENCRYPTION_KEY` est généré automatiquement** et stocké dans Secret Manager.
  Sauvegardez-le avant de détruire le module — les identifiants chiffrés avec une clé ne
  peuvent pas être déchiffrés avec une autre.
- **Qdrant et Ollama s'exécutent comme des Deployments Kubernetes internes uniquement** dans
  le même espace de noms que n8n, chacun avec un service ClusterIP. Ils ne sont pas exposés
  hors du cluster.
- **La persistance GCS Fuse** conserve l'index vectoriel de Qdrant (`/mnt/gcs/qdrant`) et les
  poids des modèles d'Ollama (`/mnt/gcs/ollama/models`) de façon durable entre les
  redémarrages de pods.
- **Redis est activé par défaut.** Avec plus d'un réplica, un backend de file d'attente
  partagé est nécessaire pour éviter une exécution des workflows en split-brain.
- **`min_instance_count` vaut `0` par défaut.** Le HPA de GKE ne prend pas en charge une
  véritable mise à l'échelle à zéro de la même façon que Cloud Run ; définissez-le à `1` pour
  une disponibilité fiable des webhooks.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail n8n AI {#a-gke-autopilot--the-n8n-ai-workload}

n8n, Qdrant et Ollama s'exécutent chacun comme un Deployment Kubernetes distinct dans le même
espace de noms. L'autoscaling horizontal des pods régit le nombre de réplicas de n8n entre les
limites minimale et maximale. Qdrant et Ollama sont fixés à un réplica chacun.

- **Console :** Kubernetes Engine → Workloads → sélectionnez chaque charge de travail pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche les IP externes et les points de terminaison ClusterIP.
- **CLI :**
  ```bash
  kubectl get deployments,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/n8nai --tail=100
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  kubectl describe hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur Autopilot, la mise à l'échelle et les
types de charges de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de workflows, l'historique des exécutions et les
identifiants dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent en privé
via le sidecar **Cloud SQL Auth Proxy**, par un socket Unix sur `127.0.0.1`. Lors du premier
déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags
  et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez
[App_GKE](App_GKE.md).

### C. Cloud Storage (GCS Fuse) et Filestore (NFS) {#c-cloud-storage-gcs-fuse-and-filestore-nfs}

Un bucket **Cloud Storage** partagé est monté dans chaque conteneur via GCS Fuse :

- données des workflows et identifiants de n8n dans `/home/node/.n8n`
- index vectoriel de Qdrant dans `/mnt/gcs/qdrant`
- poids des modèles d'Ollama dans `/mnt/gcs/ollama/models`

**Filestore (NFS)** est activé par défaut et fournit un volume persistant partagé pour les
données multi-réplicas ; il sert aussi de point de terminaison Redis par défaut.

- **Console :** Cloud Storage → Buckets pour le bucket de données d'IA ; Filestore →
  Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/          # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- df -h | grep -E "gcs|nfs"
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Backend de file d'attente Redis {#d-redis-queue-backend}

Redis sert de support au mode file d'attente de n8n, ce qui permet une exécution fiable des
workflows sur plusieurs réplicas. Lorsqu'aucun `redis_host` n'est configuré et que NFS est
activé, l'IP du serveur NFS est utilisée comme point de terminaison Redis. Pour la production
en haute disponibilité, pointez vers une instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep -E "REDIS"
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — base de données vectorielle {#e-qdrant--vector-database}

Qdrant fournit une recherche de similarité vectorielle haute performance pour les pipelines
RAG, les embeddings de documents et la mémoire d'IA au sein des workflows n8n. Il est déployé
comme Deployment Kubernetes interne uniquement et n8n y accède via la variable
d'environnement `QDRANT_URL`, qui pointe vers son service ClusterIP.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le Deployment `qdrant`.
- **CLI :**
  ```bash
  kubectl get deployment qdrant -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  # Confirm QDRANT_URL is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep QDRANT_URL
  # Check Qdrant's health endpoint from inside the cluster
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://qdrant:6333/healthz
  ```

### F. Ollama — serveur LLM local {#f-ollama--local-llm-server}

Ollama exécute des modèles de langage open source (Llama 3, Mistral, Gemma) directement sur
votre infrastructure, permettant une inférence d'IA respectueuse de la confidentialité sans
dépendance à une API externe. C'est un Deployment Kubernetes interne uniquement ;
`OLLAMA_HOST` est injecté dans n8n pour l'atteindre.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le Deployment `ollama`.
- **CLI :**
  ```bash
  kubectl get deployment ollama -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  # Confirm OLLAMA_HOST is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep OLLAMA_HOST
  # List models loaded in Ollama (from inside the cluster)
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://ollama:11434/api/tags
  ```

### G. Secret Manager {#g-secret-manager}

La clé de chiffrement de n8n et le mot de passe SMTP sont générés automatiquement et stockés
comme secrets Secret Manager, puis synchronisés vers des Secrets Kubernetes et injectés dans
les pods à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [Sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### H. Réseau et entrée {#h-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. La prise
en charge des domaines personnalisés via la Gateway API de Kubernetes avec un certificat géré
par Google est activée par défaut (`enable_custom_domain = true`), et une IP statique est
réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et l'IP statique.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

La sortie stdout/stderr des pods est envoyée à Cloud Logging ; les métriques GKE et Cloud SQL
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application N8N AI {#3-n8n-ai-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job Kubernetes `db-init`
  s'exécute avant le démarrage du Deployment n8n. Il crée la base de données PostgreSQL
  `n8n_db` et l'utilisateur `n8n_user` via le socket du Cloud SQL Auth Proxy, accorde tous les
  privilèges et arrête proprement le proxy. Le job est idempotent et peut être relancé sans
  risque.
- **Clé de chiffrement.** `N8N_ENCRYPTION_KEY` est généré automatiquement au premier
  déploiement et stocké dans Secret Manager. **Sauvegardez ce secret avant de détruire le
  module.** Tous les identifiants n8n (clés d'API, jetons OAuth, mots de passe de workflows)
  sont chiffrés avec cette clé ; ils ne peuvent pas être déchiffrés après un redéploiement
  avec une autre clé.
- **Sondes de santé.** La sonde de démarrage cible `GET /` sur le port 5678 avec un délai
  initial de 120 secondes, ce qui laisse à n8n le temps de se connecter à PostgreSQL et de
  charger l'état des workflows. La sonde de vivacité vérifie le même chemin après le
  démarrage.
- **URL des webhooks et de l'éditeur.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis
  sur l'URL prévue du service avant la création du Deployment, afin que les webhooks
  fonctionnent sans nouvel apply après le déploiement.
- **Mode file d'attente.** Lorsque Redis est activé, n8n fonctionne en mode file d'attente
  pour une exécution fiable des workflows sur plusieurs réplicas. Sans Redis, un seul réplica
  doit s'exécuter.
- **Mot de passe SMTP.** `N8N_SMTP_PASS` est généré automatiquement comme valeur provisoire.
  Remplacez la valeur du secret dans Secret Manager par de vrais identifiants SMTP avant
  d'activer l'envoi d'e-mails.
- **Inspecter les jobs planifiés et les CronJobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à n8n AI ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8nai` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `N8N AI Starter Kit` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod n8n ; également hérité par Ollama. 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par pod n8n ; également héritée par Ollama. 4 GiB minimum pour les charges de travail d'IA. |
| `min_instance_count` | `0` | Nombre minimal de réplicas n8n. Définissez `1` pour une disponibilité continue des webhooks. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. N'augmentez qu'avec Redis activé. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les workflows d'inférence d'IA longs. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Valeurs provisoires SMTP | Paramètres non sensibles. Les variables principales de n8n sont injectées automatiquement ; ne définissez pas `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL` ni `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour les clés d'API de fournisseurs d'IA externes. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager (30 jours). Configure une notification Pub/Sub lorsque la rotation est due. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | n8n AI est sans état entre instances avec Redis. Passez à `ClientIP` uniquement si nécessaire. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Requis pour les règles de pare-feu de connectivité NFS. |
| `gke_cluster_name` | `""` | Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Laissez vide pour une génération automatique. |
| `prereq_subnet_cidr_override` | `""` | Remplacement du CIDR du sous-réseau principal du VPC intégré. Vide, un /24 unique par déploiement est dérivé de l'ID de déploiement aléatoire ; sur les déploiements existants, définissez la valeur précédemment appliquée pour éviter le remplacement des ressources. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles de PVC dans le StatefulSet. La valeur `true` sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartir les pods n8n, Qdrant et Ollama entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — délai de 120 s | Sonde de démarrage de n8n ; le délai généreux permet la connexion à la base de données et le chargement des workflows. |
| `liveness_probe` | HTTP `/` — délai de 30 s | Sonde de vivacité de n8n. |
| `startup_probe_config` | TCP — activée | Sonde de démarrage standard d'App_GKE. |
| `health_check_config` | HTTP `/` — activée | Sonde de vivacité standard d'App_GKE. |
| `uptime_check_config` | désactivé | À activer pour la supervision en production. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs planifiés pour les tâches périodiques (exports, maintenance). |
| `additional_services` | `[]` | Deployments sidecar ou auxiliaires supplémentaires aux côtés de n8n. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données des workflows et la découverte de l'hôte Redis par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. À remplacer lorsque vous montez un second partage NFS à côté du premier. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données d'IA provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Backend de file d'attente Redis {#group-15--redis-queue-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le mode file d'attente de n8n. **Requis lorsque `max_instance_count > 1`.** |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez-le explicitement pour une instance Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `n8n_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_mysql_plugins` | `false` | Activer l'installation automatique de plugins MySQL. Applicable uniquement aux bases MySQL ; `N8N_AI_Common` impose `database_type` à PostgreSQL 15, ce paramètre est donc sans effet pour la base de données propre à n8n. |
| `mysql_plugins` | `[]` | Liste des plugins MySQL à installer (par ex. `validate_password`, `audit_log`). Applicable uniquement aux bases MySQL. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner la Gateway API de Kubernetes pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant n8n. **Remarque :** activer IAP bloque les points de terminaison de webhooks publics. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la règle. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

### Groupe — Composants d'IA {#group--ai-components}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_ai_components` | `true` | Interrupteur principal. Définissez `false` pour déployer n8n sans Qdrant ni Ollama. |
| `enable_qdrant` | `true` | Déployer Qdrant comme Deployment Kubernetes interne uniquement. |
| `qdrant_version` | `latest` | Tag de l'image Docker de Qdrant. Épinglez une version précise pour la stabilité en production. |
| `enable_ollama` | `true` | Déployer Ollama comme Deployment Kubernetes interne uniquement. |
| `ollama_version` | `latest` | Tag de l'image Docker d'Ollama. Épinglez une version précise pour la stabilité en production. |
| `ollama_model` | `llama3.2` | Déclaration du modèle par défaut. Remarque : cette variable n'est actuellement pas transmise au service Ollama — les modèles doivent être téléchargés séparément au niveau de l'API Ollama. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes de la charge de travail n8n. |
| `namespace` | Espace de noms dans lequel s'exécutent toutes les charges de travail (n8n, Qdrant, Ollama). |
| `service_cluster_ip` | ClusterIP interne au cluster du Service n8n. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre l'interface de n8n. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`n8n_db`). |
| `database_user` | Utilisateur de la base de données de l'application (`n8n_user`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données d'IA). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (généré automatiquement) | À sauvegarder immédiatement | Critical | Le modifier après la première exécution détruit définitivement tous les identifiants n8n enregistrés. |
| `application_name` | `n8nai` — défini une seule fois | Critical | Immuable après le premier déploiement ; le renommer recrée toutes les ressources GCP et Kubernetes avec perte de données. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer fait pointer n8n vers une nouvelle base de données vide, avec perte de tous les workflows. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement de tous les pods. |
| `enable_qdrant` | `true` | High | Les workflows RAG actifs échouent à l'exécution avec des erreurs de connexion si Qdrant est retiré. |
| `enable_ollama` | `true` | High | Les workflows utilisant le nœud LLM local échouent ; ne le désactivez que si vous utilisez exclusivement des fournisseurs d'IA externes. |
| `enable_redis` | `true` | High | Sans Redis, plusieurs réplicas entrent en conflit sur l'état des workflows ; l'exécution en split-brain corrompt les exécutions. |
| `redis_host` | `""` (NFS) ou explicite | High | Lorsque Redis est activé mais que `redis_host` et NFS ne sont pas définis, n8n ne démarre pas. |
| `memory_limit` | `4Gi` | High | Les workflows d'IA (embeddings, recherche vectorielle, chaînage de LLM) provoquent des arrêts OOM en dessous de 4 GiB. |
| `max_instance_count` | `1` sauf si Redis est configuré | High | Dépasser 1 sans Redis provoque un split-brain ; l'augmenter avec Redis est sans risque. |
| `min_instance_count` | `1` pour les webhooks | Medium | `0` peut laisser les webhooks sans pod cible ; l'état du HPA peut être incohérent sur GKE. |
| `enable_nfs` | `true` | High | Qdrant et Ollama utilisent GCS Fuse sur le bucket de données d'IA ; sans lui, les fichiers de modèles et les index vectoriels sont perdus au redémarrage des pods. |
| `enable_iap` | uniquement avec des identifiants OAuth valides | High | L'activer sans `iap_oauth_client_id` / `iap_oauth_client_secret` bloque tout accès. IAP bloque aussi les webhooks publics. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à n8n AI partagée avec la
variante Cloud Run est décrite dans **[N8N_AI_Common](N8N_AI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : N8N_AI sur GKE Autopilot](../labs/N8N_AI_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [N8N AI sur Cloud Run](N8N_AI_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [N8N AI Common — Configuration applicative partagée](N8N_AI_Common.md) — la configuration partagée par les deux cibles de déploiement.
