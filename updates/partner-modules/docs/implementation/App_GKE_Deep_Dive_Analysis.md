# App_GKE Module Deep Dive Analysis

This document provides a detailed analysis of the configuration options for the `App_GKE` module, organized by function and audience.

| Variable | Description | Default | Update | Audience |
| :--- | :--- | :--- | :--- | :--- |
| **Group 0: Module Metadata** | | | | |
| `module_description` | Describes the module's purpose. Metadata only. | See variables.tf | Yes | Publisher |
| `module_documentation` | URL to external documentation. Metadata only. | `https://docs.radmodules.dev...` | Yes | Publisher |
| `module_dependency` | Lists module dependencies. Metadata only. (e.g., ['Services_GCP']) | `["Services_GCP"]` | Yes | Publisher |
| `module_services` | Lists GCP services enabled/used by the module. Metadata only. | List of services | Yes | Publisher |
| `credit_cost` | Defines the cost/credits required to deploy. Metadata only. (e.g., 100) | `100` | Yes | Publisher |
| `require_credit_purchases` | Enforces credit check. Metadata only. | `true` | Yes | Publisher |
| `enable_purge` | Allows module deletion/purge. Metadata only. | `true` | Yes | Publisher |
| `public_access` | Controls visibility to platform users. Metadata only. | `true` | Yes | Publisher |
| `resource_creator_identity` | Creator SA. IAM bindings. | `rad-module-creator...` | Yes | Publisher |
| **Group 1: Project & Identity** | | | | |
| `existing_project_id` | The GCP project ID where resources deploy. (e.g., 'my-project-123') | Required | **No** (Re-provision) | End User |
| `tenant_deployment_id` | Unique identifier for the deployment environment. (e.g., 'prod', 'dev', 'tenant-1') | `demo` | **No** (Re-provision) | End User |
| `trusted_users` | Email addresses of users granted access. (e.g., ['admin@example.com']) | `[]` | Yes | End User |
| `resource_labels` | Common labels. Applied to all resources. (e.g., { env = "dev" }) | `{}` | Yes | End User |
| **Group 2: Application Identity** | | | | |
| `application_name` | Internal app name. Used in resource names. (e.g., 'crm-app') | `gkeapp` | **No** (Recreation) | End User |
| `application_display_name` | Human-readable name. Used in UI/Dashboards. (e.g., 'Customer Portal') | `App_GKE Application` | Yes | End User |
| `application_description` | Description of the app. Metadata/Labels. (e.g., 'Enterprise GKE workload') | `App_GKE Custom Application...` | Yes | End User |
| `application_version` | Version tag. Used for image tagging. (e.g., 'v1.0.0', 'latest') | `1.0.0` | Yes | End User |
| `gke_service_account` | Workload Identity SA. SA used by Pods. (e.g., 'workload-sa@project.iam') | `""` | Yes | Publisher |
| **Group 3: Runtime & Scaling** | | | | |
| `container_image_source` | Image Source. Options: `prebuilt`, `custom`. | `custom` | Yes | End User |
| `container_image` | Image URI. Image deployed to GKE. (e.g., 'us-docker.pkg.dev/cloudrun/container/hello') | `us-docker.pkg.dev/...` | Yes | End User |
| `container_build_config` | Build Config. Dockerfile/Context for custom builds. Example: { enabled = true, dockerfile_path = "Dockerfile", ... }. | `{enabled=true}` | Yes | End User |
| `enable_image_mirroring` | Mirror Image. Mirrors external image to Artifact Registry. | `true` | Yes | End User |
| `min_instance_count` | Minimum pod replicas. Sets HPA `minReplicas`. | `1` | Yes | End User |
| `max_instance_count` | Maximum pod replicas. Sets HPA `maxReplicas`. (e.g., 20) | `3` | Yes | End User |
| `enable_vertical_pod_autoscaling` | Enable VPA. Optimize resource requests. | `false` | Yes | End User |
| `container_port` | Application port. Port container listens on. | `8080` | Yes | End User |
| `container_protocol` | Service protocol. Options: `http1`, `h2c`. | `http1` | Yes | End User |
| `container_resources` | CPU/Mem limits. Example: { cpu_limit = "1000m", memory_limit = "512Mi", ... }. | `{cpu="1000m", memory="512Mi"}` | Yes | End User |
| `timeout_seconds` | Request Timeout. Backend timeout config. | `300` | Yes | Publisher |
| `enable_cloudsql_volume` | SQL Proxy. Inject SQL Proxy sidecar. | `true` | Yes | Publisher |
| `cloudsql_volume_mount_path` | Socket Path. Mount path for socket. (e.g., "/cloudsql") | `/cloudsql` | Yes | Publisher |
| `service_annotations` | Service Annotations. Custom annotations. | `{}` | Yes | Publisher |
| `service_labels` | Service Labels. Custom labels. | `{}` | Yes | Publisher |
| `deploy_application` | Deploy workload toggle. If false, only creates infra. | `true` | Yes | Publisher |
| **Group 4: Access & Networking** | | | | |
| `enable_iap` | Enable IAP. Secures LoadBalancer with IAP. | `false` | Yes | End User |
| `iap_authorized_users` | IAP User Allowlist. (e.g., ['user:alice@example.com']) | `[]` | Yes | End User |
| `iap_authorized_groups` | IAP Group Allowlist. (e.g., ['group:devs@example.com']) | `[]` | Yes | End User |
| `iap_oauth_client_id` | OAuth Client ID. For IAP config. | `""` | Yes | End User |
| `iap_oauth_client_secret` | OAuth Secret. For IAP config. | `""` | Yes | End User |
| `iap_support_email` | IAP Support Email. OAuth screen contact. (e.g., 'help@example.com') | `""` | Yes | End User |
| `enable_vpc_sc` | Enable VPC-SC. Configures VPC-SC boundaries. | `false` | Yes | End User |
| `admin_ip_ranges` | Admin CIDR ranges. IPs allowed for privileged access. (e.g., ['203.0.113.0/24']) | `[]` | Yes | End User |
| `network_tags` | Firewall Tags. For firewall rules. (e.g., ['allow-ingress']) | `["nfsserver"]` | Yes | Publisher |
| **Group 5: Environment Variables & Secrets** | | | | |
| `environment_variables` | Static env vars. Injected into container. (e.g., { LOG_LEVEL = "info" }) | `{}` | Yes | End User |
| `secret_environment_variables` | Secret env vars. Injected as `valueFrom` Secret. | `{}` | Yes | End User |
| `secret_rotation_period` | Secret rotation schedule. (e.g., '2592000s' for 30 days) | `2592000s` | Yes | End User |
| `secret_propagation_delay` | Secret Delay. Wait time for secrets. (e.g., 30) | `30` | Yes | Publisher |
| **Group 6: Backup & Maintenance** | | | | |
| `backup_schedule` | Backup cron schedule. (e.g., '0 2 * * *' for daily at 2am) | `0 2 * * *` | Yes | End User |
| `backup_retention_days` | Retention period. (e.g., 30) | `7` | Yes | End User |
| `enable_backup_import` | Import backup on deploy. Triggers DB import job. | `false` | Yes | End User |
| `backup_source` | Source type. Options: `gcs`, `gdrive`. | `gcs` | Yes | End User |
| `backup_uri` | URI of backup file. (e.g., 'gs://bucket/file.sql' or GDrive File ID) | `""` | Yes | End User |
| `backup_format` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. | `sql` | Yes | End User |
| **Group 7: CI/CD & GitHub Integration** | | | | |
| `enable_cicd_trigger` | Enable Cloud Build Trigger. Creates trigger linked to GitHub. | `false` | Yes | End User |
| `github_repository_url` | GitHub Repo URL. (e.g., 'https://github.com/user/repo') | `""` | Yes | End User |
| `github_token` | GitHub PAT. Used for repo access. | `""` | Yes | End User |
| `github_app_installation_id` | GitHub App ID. Alternative auth. (e.g., '87654321') | `""` | Yes | End User |
| `cicd_trigger_config` | Advanced Trigger Config. Example: { branch_pattern = "^main$", ... }. | `{branch_pattern="^main$"}` | Yes | End User |
| `enable_cloud_deploy` | Enable Cloud Deploy. Switches to Cloud Deploy pipeline. | `false` | **Destructive** | End User |
| `cloud_deploy_stages` | Cloud Deploy Stages. Defines promotion pipeline. | `[dev, staging, prod]` | Yes | End User |
| `enable_binary_authorization` | BinAuthz. Enforce Binary Authorization. | `false` | Yes | End User |
| **Group 8: Custom SQL Scripts** | | | | |
| `enable_custom_sql_scripts` | Enable custom SQL. Runs job to execute SQL. | `false` | Yes | Advanced User |
| `custom_sql_scripts_bucket` | Bucket for SQL. (e.g., 'my-init-bucket') | `""` | Yes | Advanced User |
| `custom_sql_scripts_path` | Path in bucket. (e.g., 'scripts/') | `""` | Yes | Advanced User |
| `custom_sql_scripts_use_root` | Run as root. Executes as superuser. | `false` | Yes | Advanced User |
| **Group 9: GKE Backend Configuration** | | | | |
| `gke_cluster_name` | Target Cluster. Name of GKE cluster. (e.g., 'gke-cluster-1') | `""` | Yes (Migration) | Publisher |
| `gke_cluster_selection_mode` | Cluster Selection. Options: `explicit`, `round-robin`, `primary`. | `explicit` | Yes | Publisher |
| `namespace_name` | Namespace Name. Kubernetes Namespace. | `""` | **No** (Recreation) | Publisher |
| `workload_type` | Workload Type. Options: `Deployment`, `StatefulSet`. | `Deployment` | **No** (Recreation) | End User |
| `service_type` | Service Type. Options: `ClusterIP`, `LoadBalancer`, `NodePort`. | `LoadBalancer` | Yes | End User |
| `enable_multi_cluster_service` | Enable MCS. Service Export/Import. | `false` | Yes | Publisher |
| `configure_service_mesh` | Service Mesh. Enables Istio injection. | `false` | Yes | Publisher |
| `enable_network_segmentation` | Network Policy. Creates NetworkPolicies. | `false` | Yes | End User |
| `session_affinity` | Session Affinity. Options: `ClientIP`, `None`. | `ClientIP` | Yes | End User |
| `termination_grace_period_seconds` | Grace Period. Pod termination grace period. | `30` | Yes | End User |
| `deployment_timeout` | Timeout. Terraform timeout. (e.g., 1200) | `1200` | Yes | Publisher |
| **Group 10: StatefulSet Configuration** | | | | |
| `stateful_pvc_enabled` | StatefulSet PVC. Provisions PVCs for StatefulSets. | `false` | Yes | End User |
| `stateful_pvc_size` | PVC Size. (e.g., '20Gi') | `10Gi` | Yes | End User |
| `stateful_pvc_mount_path` | PVC Mount Path. (e.g., '/var/lib/data') | `/data` | Yes | End User |
| `stateful_pvc_storage_class` | Storage Class. K8s Storage Class. (e.g., "standard-rwo") | `standard-rwo` | Yes | End User |
| `stateful_headless_service` | Headless Service. Creates headless service for StatefulSet. | `true` | Yes | End User |
| `stateful_pod_management_policy` | Pod Mgmt. Options: `OrderedReady`, `Parallel`. | `OrderedReady` | Yes | End User |
| `stateful_update_strategy` | Update Strategy. Options: `RollingUpdate`, `OnDelete`. | `RollingUpdate` | Yes | End User |
| **Group 11: Custom Domain & Static IP** | | | | |
| `enable_custom_domain` | Enable custom domain. Configures Ingress/Gateway. | `false` | Yes | End User |
| `application_domains` | Custom domains. Hostnames for Ingress. (e.g., ['api.example.com']) | `[]` | Yes | End User |
| `reserve_static_ip` | Reserve static IP. Allocates Global Static IP. | `false` | Yes | End User |
| `static_ip_name` | Static IP Name. Leave empty to auto-generate. | `""` | **No** (Recreation) | End User |
| **Group 12: Resource Quota** | | | | |
| `enable_resource_quota` | Enable ResourceQuota. Limits namespace consumption. | `false` | Yes | End User |
| `quota_cpu_requests` | Quota CPU Req. (e.g., '4', '4000m') | `""` | Yes | End User |
| `quota_cpu_limits` | Quota CPU Lim. (e.g., '8', '8000m') | `""` | Yes | End User |
| `quota_memory_requests` | Quota Mem Req. (e.g., '4Gi', '8192Mi') | `""` | Yes | End User |
| `quota_memory_limits` | Quota Mem Lim. (e.g., '8Gi', '16384Mi') | `""` | Yes | End User |
| `quota_max_pods` | Quota Max Pods. Max pods allowed. | `null` | Yes | End User |
| `quota_max_services` | Quota Max Svcs. Max services allowed. | `null` | Yes | End User |
| `quota_max_pvcs` | Quota Max PVCs. Max PVCs allowed. | `null` | Yes | End User |
| **Group 13: Cloud Armor & CDN** | | | | |
| `enable_cloud_armor` | Enable Cloud Armor. Attaches Security Policy. | `false` | Yes | End User |
| `cloud_armor_policy_name` | Security Policy Name. (e.g., 'primary-waf-policy') | `default-waf-policy` | Yes | End User |
| `enable_cdn` | Enable Cloud CDN. Enables CDN on BackendConfig. | `false` | Yes | End User |
| **Group 14: Reliability Policies** | | | | |
| `enable_pod_disruption_budget` | Enable PDB. Creates PodDisruptionBudget. | `true` | Yes | End User |
| `pdb_min_available` | Min available pods. PDB configuration. | `1` | Yes | End User |
| `enable_topology_spread` | Enable Topology Spread. Adds spread constraints. | `false` | Yes | End User |
| `topology_spread_strict` | Strict placement. `DoNotSchedule` if unsatisfied. | `false` | Yes | End User |
| **Group 15: NFS Storage** | | | | |
| `enable_nfs` | Enable Filestore. Provisions Filestore and mounts it. | `true` | Yes | End User |
| `nfs_mount_path` | NFS Mount Path. Path inside container. (e.g., '/mnt/nfs') | `/mnt/nfs` | Yes | End User |
| **Group 16: Cloud Storage** | | | | |
| `create_cloud_storage` | Create Buckets. Toggle bucket creation. | `true` | Yes | End User |
| `storage_buckets` | Bucket Config. e.g. [{name_suffix="data", ...}] | `[{name_suffix="data", ...}]` | Yes | End User |
| `gcs_volumes` | GCS Fuse Volumes. Mounts GCS buckets via CSI. Example: [{ name = "gcs-pvc", bucket_name = "my-bucket", mount_path = "/data" }]. | `[]` | Yes | End User |
| **Group 17: Database Backend** | | | | |
| `database_type` | DB Engine. Cloud SQL database type. Options: `MYSQL`, `POSTGRES`, `NONE`. (e.g., 'MYSQL_8_0', 'POSTGRES_15') | `POSTGRES` | Yes | End User |
| `application_database_name` | Database name. Name of Cloud SQL DB. (e.g., 'app_db') | `gkeappdb` | **No** (Recreation) | End User |
| `application_database_user` | Database username. (e.g., 'db_user') | `gkeappuser` | **No** (Recreation) | End User |
| `database_password_length` | Password Length. Length of generated password. | `16` | Fixed | Publisher |
| `enable_postgres_extensions` | Postgres Exts. Enable extension install. | `false` | Yes | Publisher |
| `postgres_extensions` | Extensions List. (e.g., ['postgis', 'uuid-ossp']) | `[]` | Yes | Publisher |
| `enable_mysql_plugins` | MySQL Plugins. Enable plugin install. | `false` | Yes | Publisher |
| `mysql_plugins` | Plugins List. (e.g., ['audit_log']) | `[]` | Yes | Publisher |
| `enable_auto_password_rotation` | Auto-rotate DB password. Deploys rotator job/trigger. | `false` | Yes | Advanced User |
| `rotation_propagation_delay_sec` | Rotation delay. Wait time for secrets. | `90` | Yes | Advanced User |
| **Group 18: Workload Automation** | | | | |
| `initialization_jobs` | Init Jobs. K8s Jobs to run before app. Example: [{ name = "db-setup", ... }]. | `[{name="db-init", ...}]` | Yes | Advanced User |
| `cron_jobs` | Cron Jobs. Scheduled K8s CronJobs. | `[]` | Yes | Advanced User |
| `additional_services` | Sidecar Services. Helper containers. | `[]` | Yes | Advanced User |
| **Group 19: Observability & Health** | | | | |
| `startup_probe_config` | Startup Probe. Example: { enabled = true, type = "TCP", path = "/", initial_delay_seconds = 60, ... }. | `{enabled=true}` | Yes | End User |
| `health_check_config` | Liveness Probe. Example: { enabled = true, type = "HTTP", path = "/healthz", ... }. | `{enabled=true}` | Yes | End User |
| `uptime_check_config` | Uptime Check. Example: { enabled = true, path = "/", check_interval = "60s", timeout = "10s" }. | `{enabled=true}` | Yes | End User |
| `alert_policies` | Alert Policies. Custom metric alerts. | `[]` | Yes | End User |
