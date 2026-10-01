---
title: "OpenClaw sur GKE Autopilot"
description: "Référence de configuration pour déployer OpenClaw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenClaw_GKE.md @ 3055034 sha256:b6465c83fbc4 -->

# OpenClaw sur GKE Autopilot {#openclaw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenClaw_GKE.png" alt="OpenClaw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenClaw est une passerelle d'agents IA multi-tenant conçue spécifiquement pour des déploiements
d'agents isolés et persistants. Elle permet aux équipes d'exécuter des assistants IA par tenant s'appuyant sur des modèles Anthropic, avec
des espaces de travail GCS dédiés et une intégration facultative des canaux Telegram ou Slack — le tout sans
état partagé entre les agents. Ce module déploie OpenClaw sur **GKE Autopilot** au-dessus du
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenClaw et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez le
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenClaw s'exécute sous forme de charge de travail de passerelle Node.js sur GKE Autopilot. Le déploiement associe
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle horizontale automatique |
| Stockage de l'espace de travail | Cloud Storage (GCS Fuse) | Bucket d'espace de travail par tenant monté sur `/data` via le pilote CSI GCS Fuse |
| Identifiants IA | Secret Manager | Clé API Anthropic et jeton de passerelle toujours stockés ; secrets Telegram et Slack facultatifs |
| Entrée | Cloud Load Balancing | `LoadBalancer` par défaut (IP externe publique) ; `ClusterIP` ou un domaine personnalisé disponibles |
| Secrets | Secret Manager | Tous les identifiants sont injectés au démarrage des pods ; jamais en clair dans la configuration |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ni base de données, ni Redis.** OpenClaw est une passerelle Node.js avec état reposant entièrement sur GCS
  Fuse sur `/data`. Cloud SQL et Redis ne sont jamais provisionnés.
- **Une image de conteneur personnalisée est toujours construite.** Le module ajoute un `entrypoint.sh` par-dessus
  l'image amont `ghcr.io/openclaw/openclaw`. L'argument de build `BASE_IMAGE` est figé sur
  `application_version`.
- **L'espace de travail GCS sur `/data` est toujours monté.** Un bucket dédié `<prefix>-storage` est
  toujours provisionné et monté par le pilote CSI GCS Fuse. L'état persistant des agents y réside
  d'un redémarrage de pod à l'autre.
- **`OPENCLAW_STATE_DIR` est sur le disque local.** Le staging npm et le répertoire de configuration XDG sont
  redirigés vers `/tmp/openclaw` pour éviter les limitations de GCS Fuse sur les liens physiques au démarrage.
- **`min_instance_count = 1` par défaut.** Maintient l'agent actif afin que les événements de webhook de
  Telegram ou de Slack ne soient pas perdus pendant un démarrage à froid.
- **L'affinité de session vaut `ClientIP`.** Garantit que les sessions WebSocket d'un utilisateur sont systématiquement
  routées vers le même pod lorsque plusieurs réplicas sont en cours d'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenClaw {#a-gke-autopilot--the-openclaw-workload}

Les pods OpenClaw sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent
réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail OpenClaw pour voir les pods,
  les événements et l'utilisation des ressources. Kubernetes Engine → Services & Ingress affiche le point de terminaison
  du service.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet) sont gérés.

### B. Cloud Storage — espace de travail GCS Fuse {#b-cloud-storage--gcs-fuse-workspace}

Tout l'état durable des agents est stocké dans un bucket Cloud Storage dédié et monté dans les pods
sur `/data` par le pilote CSI GCS Fuse. L'organisation de l'espace de travail est la suivante :

```
<prefix>-storage/
├── workspace/              ← agent workspace (/data/workspace)
│   └── skill-library/      ← shared skills repo (when skills_repo_url is set)
├── agents/main/agent/      ← agent state directory
└── ...
```

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `<prefix>-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<prefix>-storage/
  # Confirm the bucket is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  ```

Consultez [App_GKE](App_GKE.md) pour le CSI GCS Fuse, les options CMEK et le cycle de vie des buckets.

### C. Secret Manager — identifiants {#c-secret-manager--credentials}

La clé API Anthropic et le jeton de passerelle sont toujours stockés dans Secret Manager. Lorsque
l'intégration Telegram ou Slack est activée, les jetons des bots et les secrets de webhook/de signature y sont
également stockés. Tous les identifiants sont injectés au démarrage des pods ; ils n'apparaissent jamais en clair
dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée sous forme de service `LoadBalancer` avec une IP externe publique.
Définissez `service_type = "ClusterIP"` pour un accès uniquement interne (généralement derrière un service routeur
OpenClaw), ou activez un domaine personnalisé via la Kubernetes Gateway API pour un accès externe direct
sur un nom d'hôte stable.

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud Armor et les détails de
l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE sont envoyées vers Cloud Monitoring. Un
test de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenClaw {#3-openclaw-application-behaviour}

- **Aucun job d'initialisation de base de données.** OpenClaw ne nécessite ni Cloud SQL ni job d'initialisation. L'état des agents
  réside entièrement sur GCS ; le premier démarrage d'un pod crée automatiquement les répertoires de l'espace de travail
  via `entrypoint.sh`.
- **Configuration régénérée à chaque démarrage.** `entrypoint.sh` réécrit toujours `openclaw.json`
  dans `$OPENCLAW_STATE_DIR`, ce qui garantit que les variables d'environnement gérées par Terraform (clés API,
  jeton de passerelle, paramètres des canaux) l'emportent sur toute valeur obsolète précédemment persistée sur GCS.
- **Synchronisation du dépôt de skills (facultative).** Lorsque `skills_repo_url` est défini, `entrypoint.sh`
  effectue un clonage superficiel ou une mise à jour du dépôt dans `/data/workspace/skill-library`
  à chaque démarrage d'un pod. La synchronisation n'est pas bloquante — la passerelle démarre même si le clonage échoue.
  Inspectez la synchronisation sur un pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data/workspace/skill-library
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `GET /health` sur le port 8080. La
  sonde de démarrage accorde jusqu'à environ 3 minutes (36 × 5 s) à npm pour préparer les paquets de plugins
  embarqués avant que la passerelle ne soit déclarée en mauvaise santé.
- **Affinité de session.** Le Service Kubernetes utilise par défaut l'affinité `ClientIP` afin que la
  connexion WebSocket d'un utilisateur soit systématiquement routée vers le même pod lorsque plusieurs réplicas
  sont déployés.
- **Webhooks Telegram et Slack.** Lorsque `enable_telegram` ou `enable_slack` est défini, le
  jeton de bot correspondant est injecté sous la forme `TELEGRAM_BOT_TOKEN` ou `SLACK_BOT_TOKEN`. Les
  secrets de webhook/de signature sont stockés dans Secret Manager pour un service routeur compagnon et ne sont
  pas injectés dans le conteneur de l'agent.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à OpenClaw ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `anthropic_api_key` | _(obligatoire au premier déploiement)_ | Clé API Anthropic. Stockée dans Secret Manager et injectée sous la forme `ANTHROPIC_API_KEY`. Omettez-la lors des mises à jour pour conserver la valeur stockée. Sensible. |
| `gateway_token` | _(généré automatiquement)_ | Jeton d'authentification de la passerelle. Un jeton hexadécimal sécurisé de 64 caractères est généré lorsqu'il est laissé vide. Stocké dans Secret Manager sous le nom `OPENCLAW_GATEWAY_TOKEN`. Sensible. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openclaw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `OpenClaw Gateway` | Nom convivial affiché dans la console. |
| `description` | `OpenClaw AI Gateway - Multi-tenant AI agent gateway on GKE Autopilot` | Brève description de la finalité de l'application. |
| `application_version` | `latest` | Tag de l'image OpenClaw utilisé comme argument de build `BASE_IMAGE`. Figez-le sur une version précise pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | Limites de CPU et de mémoire. Minimum recommandé de 2 vCPU / 2 GiB pour les charges de travail d'agents. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods. Conservez ≥ 1 afin que les événements de webhook ne soient pas perdus pendant un démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximal de réplicas de pods. OpenClaw est avec état — utilisez 1 par tenant, sauf avec un routage de session persistant. |
| `container_port` | `8080` | Port sur lequel écoute la passerelle OpenClaw. Doit correspondre à la variable d'environnement `PORT`. |
| `timeout_seconds` | `3600` | Délai d'expiration des requêtes. Les sessions d'agents sont longues ; 3600 s est le maximum. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources (désactive le HPA). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables gérées par le module (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) sont toujours prioritaires. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom d'un secret Secret Manager existant. Les identifiants principaux sont gérés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE. Découvre automatiquement le cluster géré par Services_GCP lorsqu'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement à partir du préfixe des ressources lorsqu'il est vide. |
| `workload_type` | `null` | `Deployment` pour des réplicas sans état adossés à GCS ; `StatefulSet` pour une identité de pod persistante. |
| `service_type` | `LoadBalancer` | `ClusterIP` pour un accès uniquement interne ; `LoadBalancer` pour un accès externe direct. |
| `session_affinity` | `ClientIP` | Routage persistant pour la cohérence des sessions WebSocket entre les réplicas. |
| `termination_grace_period_seconds` | `60` | Délai de grâce permettant aux sessions d'agents actives de se terminer avant l'arrêt du pod. |
| `network_tags` | `[]` | Tags réseau des nœuds/pods pour les règles de pare-feu. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC pour le StatefulSet. OpenClaw utilise normalement GCS — n'activez cette option que si les performances d'un disque local sont nécessaires. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. |
| `stateful_pvc_mount_path` | `/pvc-data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup dans le contexte de sécurité du pod ; `0` le laisse non défini. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — des entiers nus sont lus comme des octets et bloquent l'ordonnancement. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, seuil de 36 tentatives | Accorde environ 3 minutes pour le démarrage de npm et le montage GCS Fuse. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Redémarre le pod si la passerelle ne répond plus. |
| `uptime_check_config` | `{ enabled = false }` | Désactivé par défaut pour les services `ClusterIP` (non joignables de l'extérieur). |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw n'a pas de job d'initialisation par défaut. À utiliser pour un amorçage personnalisé de l'espace de travail. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par ex. archivage de l'espace de travail). |
| `additional_services` | `[]` | Services sidecar ou compagnons (par ex. un routeur OpenClaw). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | OpenClaw utilise GCS Fuse pour son état. NFS n'est pas nécessaire et est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS. Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets supplémentaires définis dans `storage_buckets`. Le bucket de l'espace de travail est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket d'espace de travail provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le volume `openclaw-data` sur `/data` est toujours ajouté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Configuration d'OpenClaw {#group-15--openclaw-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `skills_repo_url` | `""` | URL GitHub d'un dépôt de skills partagé. Cloné dans `/data/workspace/skill-library` à chaque démarrage d'un pod. Laissez vide pour ignorer. |
| `skills_repo_ref` | `main` | Référence Git (branche, tag ou SHA) à extraire. |
| `enable_telegram` | `false` | Provisionne un secret de jeton de bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. Nécessite `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Jeton de bot Telegram obtenu auprès de @BotFather. Sensible. |
| `telegram_webhook_secret` | `""` | Secret de validation des webhooks pour le routeur (non injecté dans l'agent). À générer avec `openssl rand -hex 32`. Sensible. |
| `enable_slack` | `false` | Provisionne les secrets Slack et injecte `SLACK_BOT_TOKEN`. Nécessite `slack_bot_token`. |
| `slack_bot_token` | `""` | Jeton de bot Slack (`xoxb-...`). Sensible. |
| `slack_signing_secret` | `""` | Secret de signature Slack pour le routeur (non injecté dans l'agent). Sensible. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de la sauvegarde automatique de l'espace de travail (UTC). |
| `backup_retention_days` | `7` | Jours de rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Importe une sauvegarde de l'espace de travail lors du déploiement. `backup_format` vaut `tar` par défaut. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway Kubernetes avec SSL pour les noms d'hôte personnalisés. Requis pour IAP. |
| `application_domains` | `[]` | Noms d'hôte personnalisés à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant OpenClaw. Nécessite `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé. Sensibles. |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` / `admin_ip_ranges` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run) / plages CIDR d'administration. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à la passerelle OpenClaw. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation personnalisés. |
| `cron_jobs` | Noms des CronJobs créés. |
| `statefulset_name` | Nom du StatefulSet (lorsque `workload_type = "StatefulSet"`). |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — un second apply est nécessaire. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `anthropic_api_key` | Définie au premier déploiement | Critical | Sans clé valide, l'agent démarre mais toutes les requêtes IA échouent avec des erreurs 401. |
| Cohérence de `gateway_token` | Généré automatiquement ou défini une seule fois | Critical | Effectuer la rotation du jeton dans Secret Manager sans redémarrer les pods entraîne le rejet de toutes les requêtes clientes jusqu'au recyclage des pods. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires | Critical | Des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement de tous les pods. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `telegram_bot_token` / `slack_bot_token` | définis lorsque l'intégration est activée | High | Un jeton vide fait échouer tous les appels d'API ; les messages sont perdus. |
| `telegram_webhook_secret` / `slack_signing_secret` | définis lorsque l'intégration est activée | High | Une valeur vide désactive la vérification des signatures, ce qui permet l'injection de faux webhooks. |
| `min_instance_count` | `1` | High | `0` signifie que les événements de webhook Telegram/Slack sont perdus pendant un démarrage à froid (généralement 30 à 60 s pour l'initialisation d'un pod GKE). |
| `skills_repo_url` | URL joignable ou vide | High | Une URL injoignable fait échouer le clonage git au démarrage, ce qui place le pod en CrashLoopBackOff. |
| `skills_repo_ref` | référence existante | High | Une branche ou un tag inexistant fait échouer le clonage à chaque démarrage. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les déploiements à plusieurs réplicas répartissent l'état WebSocket entre les pods. |
| `enable_iap` | à activer pour un usage d'administration | Medium | Sinon, la passerelle est joignable publiquement. Les points de terminaison de webhooks Telegram/Slack ne peuvent pas s'authentifier avec une identité Google — veillez à ce qu'ils ne soient pas derrière IAP. |
| `stateful_pvc_enabled` | `false` | Medium | OpenClaw utilise GCS. Les PVC ajoutent un disque local inutilisé et peuvent bloquer le réordonnancement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour la conformité ; une purge accidentelle du bucket fait perdre définitivement l'état des agents. |
| `pdb_min_available` par rapport à `min_instance_count` | laisser une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_vpc_sc` sans `organization_id` | à définir explicitement | Medium | VPC-SC est ignoré silencieusement, ce qui laisse les identifiants sans protection de périmètre. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity, mise à l'échelle automatique,
entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes
et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à OpenClaw
partagée avec la variante Cloud Run est décrite dans
**[OpenClaw_Common](OpenClaw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenClaw sur GKE Autopilot](../labs/OpenClaw_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenClaw Common — Configuration applicative partagée](OpenClaw_Common.md) — la configuration partagée par les deux cibles de déploiement.
