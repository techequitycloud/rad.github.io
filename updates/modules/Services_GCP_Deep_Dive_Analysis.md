# Services_GCP Module Deep Dive Analysis

This document provides a detailed analysis of the configuration options for the `Services_GCP` module, organized by function and audience.

| Variable | Description | Default | Update | Audience |
| :--- | :--- | :--- | :--- | :--- |
| **Group 0: Module Metadata** | | | | |
| `module_description` | Describes the module's purpose. Metadata only. | See variables.tf | Yes | Publisher |
| `module_documentation` | URL to external documentation. Metadata only. | `https://docs.radmodules.dev...` | Yes | Publisher |
| `module_dependency` | Lists module dependencies. e.g. ["GCP_Project"] | `["GCP_Project"]` | Yes | Publisher |
| `module_services` | Lists GCP services enabled/used by the module. e.g. ["Compute Engine"] | List of services | Yes | Publisher |
| `credit_cost` | Defines the cost/credits required to deploy. | `100` | Yes | Publisher |
| `require_credit_purchases` | Enforces credit check. | `true` | Yes | Publisher |
| `enable_purge` | Allows module deletion/purge. | `true` | Yes | Publisher |
| `deployment_id` | Unique deployment identifier. Used in resource naming suffixes. | `null` (random) | **No** (Recreation) | Publisher |
| `public_access` | Controls visibility to platform users. | `true` | Yes | Publisher |
| `enable_services` | Enable project APIs. Enables required Google Cloud APIs. | `true` | Yes | Publisher |
| `agent_service_account` | Agent Service Account. Grants Owner role to external agent SA. | `null` | Yes | Publisher |
| `resource_creator_identity` | Creator SA. Service Account used to create resources. | `rad-module-creator...` | Yes | Publisher |
| **Group 1: Project & Identity** | | | | |
| `existing_project_id` | Project ID. Target Google Cloud Project ID. e.g. "my-project-id" | Required | **No** (Re-provision) | End User |
| `support_users` | Trusted Users. List of users for budget alerts/admin access. e.g. ["user@example.com"] | `[]` | Yes | End User |
| `resource_labels` | Resource Labels. Common labels applied to all resources. e.g. {"environment" = "dev"} | `{}` | Yes | End User |
| **Group 2: Networking Configuration** | | | | |
| `availability_regions` | Regions. Target regions for resources. e.g. ["us-central1","us-west1"] | `["us-central1"]` | **Destructive** | End User |
| `network_name` | VPC Network Name. Name of the VPC network. | `vpc-network` | **No** (Recreation) | End User |
| `billing_account_id` | Billing Account ID. Associates project with billing account. | `""` | Yes | End User |
| `subnet_cidr_range` | Subnet CIDRs. List of CIDR ranges for subnets. e.g. ["10.0.0.0/24"] | `["10.0.0.0/24", ...]` | **Destructive** | End User |
| **Group 3: Database Configuration** | | | | |
| `create_postgres` | Create PostgreSQL. Provisions Cloud SQL PostgreSQL instance. | `true` | Yes | End User |
| `postgres_database_availability_type` | Postgres Availability. Options: `ZONAL`, `REGIONAL` (HA). | `ZONAL` | Yes | End User |
| `postgres_database_version` | Postgres Version. Options: `POSTGRES_16`, `POSTGRES_15`, `POSTGRES_14`. | `POSTGRES_16` | Yes | End User |
| `postgres_tier` | Postgres Tier. Machine type (e.g. `db-custom-1-3840`). | `db-custom-1-3840` | Yes | End User |
| `postgres_database_flags` | Postgres Flags. Database configuration flags. e.g. [{name="max_connections", value="30000"}] | `[{name="max_connections", ...}]` | Yes | End User |
| `create_postgres_read_replica` | Create Replica. Adds read replica to Postgres. | `false` | Yes | End User |
| `postgres_read_replica_count` | Number of read replicas to create for PostgreSQL. | `1` | Yes | End User |
| `create_mysql` | Create MySQL. Provisions Cloud SQL MySQL instance. | `false` | Yes | End User |
| `mysql_database_availability_type` | MySQL Availability. Options: `ZONAL`, `REGIONAL` (HA). | `ZONAL` | Yes | End User |
| `mysql_database_version` | MySQL Version. Options: `MYSQL_8_0`, `MYSQL_5_7`. | `MYSQL_8_0` | Yes | End User |
| `mysql_tier` | MySQL Tier. Machine type. | `db-custom-1-3840` | Yes | End User |
| `mysql_database_flags` | MySQL Flags. Database configuration flags. e.g. [{name="max_connections", value="30000"}] | `[{name="max_connections", ...}]` | Yes | End User |
| `create_mysql_read_replica` | Create a read replica for the MySQL instance. Requires create_mysql = true. | `false` | Yes | End User |
| `mysql_read_replica_count` | Number of read replicas to create for MySQL. | `1` | Yes | End User |
| **Group 4: Self Managed NFS & Redis** | | | | |
| `create_network_filesystem` | Create NFS/Redis VMs. Provisions Compute Engine VMs for NFS/Redis. | `true` | Yes | End User |
| `network_filesystem_machine` | VM Machine Type. Machine type for NFS server. | `e2-small` | Yes (Recreate VM) | End User |
| `network_filesystem_capacity` | Disk Capacity. Size of data disk in GB. | `10` | Yes | End User |
| **Group 5: Managed Redis** | | | | |
| `create_redis` | Create Memorystore. Provisions Cloud Memorystore for Redis. | `false` | Yes | End User |
| `redis_tier` | Redis Tier. Options: `BASIC`, `STANDARD_HA`. | `BASIC` | Yes | End User |
| `redis_memory_size_gb` | Memory Size. Redis memory size in GB. | `1` | Yes | End User |
| `redis_version` | Redis Version. Options: `REDIS_7_2`, `REDIS_7_0`, `REDIS_6_X`. | `REDIS_7_2` | Yes | End User |
| `redis_connect_mode` | Connect Mode. Options: `DIRECT_PEERING`, `PRIVATE_SERVICE_ACCESS`. | `DIRECT_PEERING` | **No** (Recreation) | End User |
| **Group 6: Filestore** | | | | |
| `create_filestore_nfs` | Create Filestore. Provisions Cloud Filestore instance. | `false` | Yes | End User |
| `filestore_tier` | Filestore Tier. Options: `BASIC_HDD`, `BASIC_SSD`, `ENTERPRISE`. | `BASIC_HDD` | **No** (Recreation) | End User |
| `filestore_capacity_gb` | Capacity. Storage capacity in GB. | `1024` | Yes (Increase only) | End User |
| **Group 7: GKE Autopilot Configuration** | | | | |
| `create_google_kubernetes_engine` | Create GKE. Provisions GKE Autopilot cluster(s). | `false` | Yes | End User |
| `gke_cluster_count` | Cluster Count. Number of clusters (1-10). | `1` | Yes | End User |
| `gke_cluster_name_prefix` | Cluster Name Prefix. Prefix for cluster names. | `gke-cluster` | **No** (Recreation) | End User |
| `gke_multi_cluster_ingress_config_cluster` | MCI Config Cluster. Index of config cluster for MCI. | `1` | Yes | End User |
| `gke_subnet_base_cidr` | Subnet Base CIDR. Base CIDR for cluster subnets. | `10.128.0.0/12` | **No** (Recreation) | End User |
| `gke_pod_base_cidr` | Pod Base CIDR. Base CIDR for pod ranges. | `10.64.0.0/10` | **No** (Recreation) | End User |
| `gke_service_base_cidr` | Service Base CIDR. Base CIDR for service ranges. | `10.8.0.0/16` | **No** (Recreation) | End User |
| `configure_cloud_service_mesh` | Service Mesh. Enable Cloud Service Mesh (Istio). | `false` | Yes | End User |
| `configure_config_management` | Config Sync. Enable Config Sync. | `false` | Yes | End User |
| `configure_policy_controller` | Policy Controller. Enable Policy Controller. | `false` | Yes | End User |
| **Group 8: GKE Backup** | | | | |
| `enable_gke_backup` | Enable Backup. Enables GKE Backup for Autopilot. | `false` | Yes | End User |
| `gke_backup_retention_days` | Retention Days. Backup retention period. | `30` | Yes | End User |
| `gke_backup_schedule` | Backup Schedule. Cron schedule for backups. | `0 3 * * *` | Yes | End User |
| **Group 9: GKE Usage Metering** | | | | |
| `enable_gke_usage_metering` | Usage Metering. Exports usage to BigQuery. | `false` | Yes | End User |
| `enable_gke_network_egress_meter` | Network Metering. Exports network egress data. | `false` | Yes | End User |
| `gke_metering_dataset_location` | Dataset Location. BigQuery dataset location. | `US` | **No** (Recreation) | End User |
| **Group 10: VPC Service Controls** | | | | |
| `enable_vpc_sc` | Enable VPC-SC. Creates Service Perimeter. | `false` | Yes | Advanced User |
| `vpc_cidr_ranges` | VPC CIDRs. Allowed VPC CIDR ranges. e.g. ["10.0.0.0/8"] | `[]` | Yes | Advanced User |
| `admin_ip_ranges` | Admin IPs. Allowed Admin IP ranges. e.g. ["1.2.3.4/32"] | `[]` | Yes | Advanced User |
| `vpc_sc_dry_run` | Dry Run Mode. `true` (Log only) or `false` (Enforce). | `true` | Yes | Advanced User |
| **Group 11: Binary Authorization** | | | | |
| `enable_binary_authorization` | Enable BinAuthz. Enforces image signature policies. | `false` | Yes | End User |
| `binauthz_evaluation_mode` | Evaluation Mode. Options: `ALWAYS_ALLOW`, `ALWAYS_DENY`, `REQUIRE_ATTESTATION`. | `ALWAYS_ALLOW` | Yes | End User |
| `enable_vulnerability_scanning` | Vulnerability Scan. Enables Container Analysis/Scanning. | `false` | Yes | End User |
| **Group 12: Cloud Armor** | | | | |
| `create_cloud_armor_security_policy` | Create WAF Policy. Creates Cloud Armor security policy. | `false` | Yes | End User |
| **Group 13: CMEK** | | | | |
| `enable_cmek` | Enable CMEK. Encrypts resources with Cloud KMS keys. | `false` | **Destructive** (Recreation) | Advanced User |
| `cmek_key_rotation_period` | Key Rotation. Rotation period for KMS keys. | `7776000s` | Yes | Advanced User |
| **Group 14: Audit Logging** | | | | |
| `enable_audit_logging` | Audit Logging. Enables detailed audit logs. | `false` | Yes | End User |
| **Group 15: Workload Identity Federation** | | | | |
| `enable_workload_identity_federation` | Enable WIF. Creates WIF pool for external auth. | `false` | Yes | End User |
| `wif_provider_type` | Provider Type. Options: `github`, `gitlab`, `generic`. | `github` | **No** (Recreation) | End User |
| `wif_github_org` | GitHub Org. Allowed GitHub Organization. e.g. "my-org" | `""` | Yes | End User |
| `wif_gitlab_hostname` | GitLab Host. GitLab instance hostname. | `gitlab.com` | Yes | End User |
| `wif_oidc_issuer_uri` | OIDC Issuer. Custom OIDC issuer URI. e.g. "https://oidc.example.com" | `""` | Yes | End User |
| `wif_allowed_audiences` | Audiences. Allowed OIDC audiences. e.g. ["audience-1"] | `[]` | Yes | End User |
| **Group 16: Security Command Center** | | | | |
| `enable_security_command_center` | Enable SCC. Enables Security Command Center. | `false` | Yes | End User |
| `enable_scc_notifications` | SCC Notifications. Routes findings to Pub/Sub. | `false` | Yes | End User |
| **Group 17: Observability** | | | | |
| `configure_email_notification` | Enable Email Notifications. Configures email notification channel. | `false` | Yes | End User |
| `notification_channels` | Alert Emails. List of email addresses for notifications. e.g. ["user@example.com"] | `[]` | Yes | End User |
| `alert_cpu_threshold` | CPU Alert. Threshold % for CPU alerts. | `80` | Yes | End User |
| `alert_memory_threshold` | Memory Alert. Threshold % for Memory alerts. | `80` | Yes | End User |
| `alert_disk_threshold` | Disk Alert. Threshold % for Disk alerts. | `80` | Yes | End User |
| **Group 18: Billing & Budget** | | | | |
| `create_billing_budget` | Create Budget. Creates billing budget and alerts. | `false` | Yes | End User |
| `budget_alert_emails` | Alert Emails. Recipients for budget alerts. e.g. ["user@company.com"] | `[]` | Yes | End User |
| `budget_amount` | Budget Amount. Monthly budget limit. | `100` | Yes | End User |
| `budget_alert_thresholds` | Alert Thresholds. List of percentages (0.5, 0.9, 1.0). e.g. [0.5, 0.9] | `[0.5, 0.9, 1.0]` | Yes | End User |
