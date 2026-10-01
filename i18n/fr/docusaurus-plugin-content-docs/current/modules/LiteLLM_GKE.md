---
title: "LiteLLM sur GKE Autopilot"
description: "Référence de configuration pour déployer LiteLLM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LiteLLM_GKE.md @ 3055034 sha256:2518e3415d27 -->

# LiteLLM sur GKE Autopilot {#litellm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LiteLLM_GKE.png" alt="LiteLLM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LiteLLM est un proxy LLM et une passerelle d'IA open source qui fournit une API
unifiée compatible OpenAI pour plus de 100 fournisseurs, dont OpenAI, Anthropic, Google
Gemini, Azure OpenAI, AWS Bedrock et Ollama. Les organisations l'utilisent pour
centraliser le suivi des dépenses d'IA, gérer des clés d'API virtuelles, appliquer des limites de débit et
obtenir une visibilité complète sur l'usage des modèles. Ce module déploie LiteLLM sur **GKE
Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise LiteLLM et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LiteLLM s'exécute comme une charge de travail de proxy écrite en Python. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods de proxy Python, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'ORM Prisma de LiteLLM utilise PostgreSQL pour les clés virtuelles et le suivi des dépenses |
| Stockage objet | Cloud Storage | Facultatif — aucun bucket créé par défaut |
| Cache | Redis | Facultatif — réduit la latence et le coût des requêtes LLM identiques répétées |
| Secrets | Secret Manager | Clé maîtresse et clé de salage générées automatiquement ; clés d'API des fournisseurs de LLM injectées à l'exécution |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma de LiteLLM nécessite PostgreSQL pour
  la gestion des clés virtuelles et le suivi des dépenses ; changer de moteur empêche le démarrage.
- **Une image de conteneur personnalisée est construite par Cloud Build.** L'image intègre un
  `entrypoint.sh` qui assemble `DATABASE_URL` à partir des variables d'environnement `DB_*`
  injectées par le socle à l'exécution.
- **`LITELLM_MASTER_KEY` et `LITELLM_SALT_KEY` sont générées automatiquement** et stockées
  dans Secret Manager. La clé de salage ne doit jamais faire l'objet d'une rotation une fois des clés virtuelles
  émises — toutes les clés virtuelles existantes deviendraient définitivement invalides.
- **`STORE_MODEL_IN_DB = "true"` est défini automatiquement**, ce qui permet de gérer les modèles
  à l'exécution et d'utiliser l'interface d'administration sans redémarrer le conteneur.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements multi-réplicas afin de
  partager entre les pods les compteurs de limites de débit et les caches de réponses.
- **La sonde de démarrage cible `/health/readiness`**, qui valide la connectivité à la base de données
  et confirme que les migrations Prisma sont terminées avant que le trafic soit
  acheminé vers le pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LiteLLM {#a-gke-autopilot--the-litellm-workload}

Les pods LiteLLM sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. Le Horizontal Pod Autoscaling dimensionne le déploiement entre les
nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail LiteLLM pour
  afficher les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LiteLLM stocke toutes les clés virtuelles, les journaux d'utilisation, les enregistrements de coûts et les règles de
routage des modèles dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de manière privée
via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique
n'est donc exposée. Lors du premier déploiement, un job d'initialisation crée la base de données
et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant
le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatiques et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket de stockage n'est créé par défaut. Des buckets peuvent être déclarés via la
variable `storage_buckets` et montés via GCS Fuse lorsque `gcs_volumes` est défini —
par exemple pour fournir un `config.yaml` au conteneur sans reconstruire
l'image.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache facultative des réponses et les compteurs partagés de limites de débit de LiteLLM.
Lorsque `enable_redis = true`, les variables d'environnement `REDIS_HOST`, `REDIS_PORT` et (facultativement)
`REDIS_PASSWORD` sont injectées automatiquement dans les pods.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`LITELLM_MASTER_KEY` (la clé d'API d'administration principale, préfixée `sk-`) et
`LITELLM_SALT_KEY` (utilisée pour hacher les clés virtuelles) sont générées automatiquement et
stockées dans Secret Manager. Les clés d'API des fournisseurs de LLM (par ex. `OPENAI_API_KEY`) sont
injectées en référençant des secrets préexistants via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique
peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et
les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE et de Cloud SQL sont envoyées à Cloud
Monitoring. Des contrôles de disponibilité et des stratégies d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LiteLLM {#3-litellm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation crée la
  base de données et l'utilisateur LiteLLM et accorde les privilèges avant le démarrage de l'application. Il
  se connecte à Cloud SQL via Auth Proxy et est idempotent.
- **Migrations Prisma au démarrage.** LiteLLM exécute les migrations de son ORM Prisma à
  chaque démarrage de pod ; une mise à niveau de la version de l'application applique donc automatiquement les
  modifications de schéma. La sonde de démarrage attend que `/health/readiness` renvoie 200,
  ce qui confirme la fin des migrations avant que le trafic soit acheminé vers le pod.
- **Interface d'administration.** L'interface d'administration de LiteLLM est disponible sur `/ui` à l'URL du service.
  Authentifiez-vous avec la `LITELLM_MASTER_KEY` (récupérez-la dans Secret Manager).
  Depuis l'interface, vous pouvez ajouter des modèles, créer des clés virtuelles, définir des budgets et consulter
  des tableaux de bord d'utilisation — le tout sans redémarrer le conteneur.
- **Ajout des clés des fournisseurs de LLM.** Les clés d'API des fournisseurs ne sont pas gérées par ce
  module. Fournissez-les au moment du déploiement via `secret_environment_variables` (en associant
  chaque variable d'environnement à un secret Secret Manager préexistant), ou ajoutez-les après le
  déploiement via l'interface d'administration ou le point de terminaison d'API `/model/new` à l'aide de la clé
  maîtresse.
- **Gestion des clés virtuelles.** Utilisez l'API `/key/generate` avec la clé maîtresse
  pour émettre des clés virtuelles par équipe ou par utilisateur, avec des limites de débit et des budgets de dépenses.
  Ces clés sont stockées dans PostgreSQL et salées avec `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **Points de terminaison de santé.** `/health/readiness` valide la connectivité à la base de données et
  la fin des migrations Prisma ; `/health/liveliness` confirme que le processus du proxy
  est en cours d'exécution. Ils servent respectivement de sondes de démarrage et de vivacité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres propres à LiteLLM ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant de l'accès au projet et des alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `litellm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `LiteLLM AI Gateway` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `main-stable` | Tag de version de l'image LiteLLM ; épinglez une version précise pour la stabilité en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mémoire par pod ; portez-la à `4Gi` pour les déploiements à haut débit. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid sur la passerelle d'API. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `4000` | Port natif de LiteLLM. |
| `timeout_seconds` | `600` | Délai d'expiration des requêtes ; augmentez-le pour les appels d'inférence LLM de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources (désactive le HPA). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Paramètres non secrets supplémentaires. Les variables principales de LiteLLM sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom de secret Secret Manager. À utiliser pour injecter les clés d'API des fournisseurs de LLM. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant ; utile lorsqu'un client réutilise une connexion ouverte vers le même pod. |
| `workload_type` | `null` | Prend automatiquement la valeur StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC ; sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin, dans le conteneur, où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Déclarée pour la cohérence avec les conventions ; non référencée par le déploiement de ce module (aucun ResourceQuota n'est créé). |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Non référencées par ce module. Si elles sont branchées via un autre module, elles doivent utiliser des unités binaires (`4Gi`, `8192Mi`) — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Stratégies de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Portez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | Sonde HTTP ; valide la connectivité à la base de données et les migrations Prisma avant d'acheminer le trafic. |
| `liveness_probe` | `/health/liveliness` | Sonde HTTP ; confirme que le processus du proxy est en cours d'exécution. |
| `uptime_check_config` | désactivé | Contrôle de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Stratégies d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré de configuration de la base de données fourni par LiteLLM_Common. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour des tâches de maintenance ou d'entretien. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Principales entrées : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour LiteLLM ; ne l'activez que pour fournir un fichier de configuration partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket créé par défaut. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour fournir des fichiers de configuration. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne pas modifier ; LiteLLM nécessite PostgreSQL 15. |
| `db_name` | `litellm_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `litellm_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Expression cron de la sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne le routage Gateway API pour les noms d'hôte personnalisés, avec certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant LiteLLM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la mise en cache des réponses et les compteurs partagés de limites de débit. |
| `redis_host` | `""` | Point de terminaison Redis ; requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une stratégie Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la stratégie. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR des niveaux d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Association des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant de joindre LiteLLM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` / `POSTGRES_15` | Critical | LiteLLM nécessite PostgreSQL ; changer de moteur casse l'ORM Prisma et empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Le sidecar Auth Proxy est requis pour la connectivité à la base de données ; le désactiver fait échouer Prisma au démarrage. |
| `LITELLM_SALT_KEY` | générée automatiquement, jamais renouvelée | Critical | Renouveler la clé de salage invalide toutes les clés virtuelles émises auparavant ; tous les consommateurs de l'API perdent immédiatement l'accès. |
| `db_name` / `db_user` | définis une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les clés virtuelles et données de dépenses. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification. |
| `ingress_settings` / `service_type` | à restreindre en production | Critical | Un LoadBalancer public expose le point de terminaison de la clé maîtresse ; utilisez `ClusterIP` avec une Gateway authentifiée pour les déploiements internes. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | à fournir lorsque IAP est activé | Critical | Des valeurs manquantes empêchent l'initialisation de la passerelle IAP et rendent le service injoignable. |
| `LITELLM_MASTER_KEY` | générée automatiquement | High | À traiter comme un identifiant ; la renouveler casse toutes les intégrations existantes qui détiennent la clé jusqu'à leur mise à jour. |
| `enable_redis` | `true` en multi-réplicas | High | Sans Redis, les compteurs de limites de débit sont propres à chaque pod et non partagés ; les quotas ne sont pas appliqués entre les réplicas. |
| `redis_host` | à définir lorsque Redis est activé | High | Un hôte vide avec `enable_redis = true` provoque des erreurs de connexion à chaque requête. |
| `min_instance_count` | `1` | High | Les démarrages à froid ajoutent 30 à 60 s de latence et mettent en file d'attente tous les services dépendants. |
| `timeout_seconds` | `600` | High | L'inférence d'un grand modèle de langage peut prendre plusieurs minutes ; un délai trop court provoque des erreurs 504 sur les modèles lents. |
| `application_version` | à épingler en production | Medium | LiteLLM publie fréquemment de nouvelles versions ; des versions non épinglées peuvent modifier le schéma Prisma ou casser les formats des clés virtuelles. |
| `enable_vertical_pod_autoscaling` | `false`, sauf si vous utilisez le VPA | Medium | Activer le VPA désactive le HPA ; choisissez l'un ou l'autre. |
| `NUM_WORKERS` | `1` (à augmenter pour le débit) | Medium | Un worker unique sérialise toutes les requêtes ; passez à 2–4 et augmentez `cpu_limit` en proportion pour les passerelles à fort trafic. |
| `backup_schedule` | `0 2 * * *` | High | Sans sauvegardes, une suppression accidentelle détruit toutes les clés virtuelles et tout l'historique d'utilisation, sans possibilité de récupération. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à LiteLLM, partagée avec la
variante Cloud Run, est décrite dans **[LiteLLM_Common](LiteLLM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LiteLLM sur GKE Autopilot](../labs/LiteLLM_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LiteLLM Common — Configuration applicative partagée](LiteLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
