# Variable Grouping Recommendations for GKE and CloudRun Modules

## Executive Summary

This document provides comprehensive recommendations for organizing and displaying variables to end users across all GKE and CloudRun modules. The goal is to balance simplicity with flexibility by:

1. Hiding advanced/technical configuration (group 0)
2. Exposing essential user-configurable options (groups 1-6)
3. Grouping related variables logically
4. Ordering variables intuitively within each group

## Grouping Strategy

### Group 0: Hidden/Advanced (Not Displayed to End Users)

**Purpose**: Hide internal platform configuration, auto-detected values, and advanced settings that have sensible defaults.

**Variables**:
- Module metadata (description, documentation, services, cost, credit requirements, purge settings)
- Service accounts (auto-detected: `resource_creator_identity`, `agent_service_account`, `gke_service_account`, `cloudrun_service_account`, `cloudbuild_service_account`, `cloudsql_service_account`)
- Deployment internals (`deployment_id`, `deploy_application`, `application_module`)
- Network configuration (`network_name`, `deployment_region`, `deployment_regions`)
- GKE cluster settings (`gke_cluster_name`, `namespace_name`, `configure_service_mesh`)
- CloudRun execution (`execution_environment`)
- Advanced resource settings (`resource_labels`, `application_version`)
- Technical settings (`container_protocol`, `service_type`, `vpc_egress_setting`, `network_tags`)
- Storage defaults (`create_cloud_storage`, `storage_buckets`)
- NFS configuration (`enable_nfs`, `nfs_mount_path`)
- Volume mounts (`gcs_volumes`, `enable_cloudsql_volume`, `cloudsql_volume_mount_path`)
- Database technical (`database_type`, `database_password_length`, `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, `mysql_plugins`)
- Backup schedule (`backup_schedule`, `backup_retention_days`)
- Observability defaults (`health_check_config`, `startup_probe_config`, `uptime_check_config`, `alert_policies`)
- Container build (`container_image_source`, `container_build_config`, `enable_image_mirroring`)
- Advanced Kubernetes (`initialization_jobs`, `cron_jobs`, `additional_services`, `workload_type`, `stateful_*`, `termination_grace_period_seconds`)
- Security advanced (`enable_binary_authorization`, `binauthz_attestor`, `enable_network_segmentation`, `enable_vertical_pod_autoscaling`)
- Service configuration (`service_annotations`, `service_labels`, `timeout_seconds`, `secret_propagation_delay`)
- CI/CD technical (`cicd_trigger_config`, `github_app_installation_id`)

**Rationale**: These variables either have sensible defaults, are auto-detected, or are too technical for typical users. Advanced users can access them through configuration files if needed.

---

## Group 1: Project & Access (Order: 201-203)

**Purpose**: Essential project selection and user access management.

**Variables** (in display order):

1. **existing_project_id** (201)
   - Description: "Select an existing project or enter a GCP project ID"
   - Type: String (dropdown with project selection + manual entry)
   - Required: Yes
   - Rationale: First decision point - where to deploy

2. **trusted_users** (202)
   - Description: "Email addresses for project access and monitoring alerts"
   - Type: List of strings
   - Default: []
   - Rationale: Access control and notification setup

3. **tenant_deployment_id** (203)
   - Description: "Unique deployment identifier (1-20 lowercase alphanumeric and hyphens)"
   - Type: String
   - Default: "demo"
   - Required: Yes
   - Rationale: Identifies this specific deployment instance

---

## Group 2: Application Configuration (Order: 301-310)

**Purpose**: Core application settings that define the deployment.

**Variables** (in display order):

1. **application_name** (301)
   - Description: "Application name for resource naming (1-20 characters)"
   - Type: String
   - Default: Module-specific (e.g., "wordpress", "ghost", "n8n")
   - Rationale: Primary identifier for the application

2. **application_database_name** (302)
   - Description: "Database name for the application"
   - Type: String
   - Default: Same as application_name
   - Rationale: Database configuration

3. **application_database_user** (303)
   - Description: "Database user for the application"
   - Type: String
   - Default: Same as application_name
   - Rationale: Database access configuration

4. **enable_custom_domain** (304) [GKE only]
   - Description: "Enable custom domain with Kubernetes Gateway"
   - Type: Boolean
   - Default: false
   - Rationale: Optional custom domain setup

5. **application_domains** (305)
   - Description: "Custom domains for the application (leave empty for auto-generated)"
   - Type: List of strings
   - Default: []
   - Rationale: Domain configuration

6. **enable_cdn** (306)
   - Description: "Enable Cloud CDN for faster global content delivery"
   - Type: Boolean
   - Default: false
   - Rationale: Performance optimization option

---

## Group 3: Application-Specific Settings (Order: 401-420)

**Purpose**: Module-specific configuration options (e.g., WordPress PHP settings, Ghost themes).

**Variables** (varies by module):

### For WordPress modules:

1. **php_memory_limit** (401)
   - Description: "PHP memory limit (e.g., '512M')"
   - Type: String
   - Default: "512M"

2. **post_max_size** (402)
   - Description: "Maximum POST data size (e.g., '64M')"
   - Type: String
   - Default: "64M"

3. **upload_max_filesize** (403)
   - Description: "Maximum upload file size (e.g., '64M')"
   - Type: String
   - Default: "64M"

### For Ghost/N8N/Other modules:

- Module-specific configuration variables
- Feature toggles specific to the application
- Application behavior settings

**Rationale**: Each application has unique configuration needs. These should be grouped together and clearly labeled as application-specific.

---

## Group 4: Security & Access Control (Order: 501-515)

**Purpose**: Security features and access control mechanisms.

**Variables** (in display order):

1. **enable_iap** (501)
   - Description: "Enable Identity-Aware Proxy for authentication"
   - Type: Boolean
   - Default: false
   - Rationale: Enterprise security feature

2. **iap_authorized_users** (502)
   - Description: "User emails authorized for IAP access"
   - Type: List of strings
   - Default: []
   - Condition: Only shown if enable_iap = true

3. **iap_authorized_groups** (503)
   - Description: "Google Groups authorized for IAP access"
   - Type: List of strings
   - Default: []
   - Condition: Only shown if enable_iap = true

4. **iap_support_email** (504) [GKE only]
   - Description: "Support email for OAuth consent screen"
   - Type: String
   - Default: ""
   - Condition: Only shown if enable_iap = true

5. **iap_oauth_client_id** (505)
   - Description: "OAuth client ID for IAP (create in GCP Console)"
   - Type: String (sensitive)
   - Default: ""
   - Condition: Only shown if enable_iap = true

6. **iap_oauth_client_secret** (506)
   - Description: "OAuth client secret for IAP"
   - Type: String (sensitive)
   - Default: ""
   - Condition: Only shown if enable_iap = true

7. **enable_vpc_sc** (507)
   - Description: "Enable VPC Service Controls for data exfiltration prevention"
   - Type: Boolean
   - Default: false
   - Rationale: Advanced security feature

8. **admin_ip_ranges** (508)
   - Description: "IP ranges allowed for admin access (required if VPC-SC enabled)"
   - Type: List of strings
   - Default: []
   - Condition: Only shown if enable_vpc_sc = true

9. **ingress_settings** (509) [CloudRun only]
   - Description: "Network ingress: 'all' (public), 'internal' (VPC only), or 'internal-and-cloud-load-balancing'"
   - Type: String (dropdown)
   - Default: "all"
   - Rationale: Access control

10. **enable_cloud_armor** (510)
    - Description: "Enable Cloud Armor WAF for DDoS and application protection"
    - Type: Boolean
    - Default: false
    - Rationale: Web application firewall

11. **cloud_armor_policy_name** (511)
    - Description: "Cloud Armor security policy name"
    - Type: String
    - Default: "default-waf-policy"
    - Condition: Only shown if enable_cloud_armor = true

12. **reserve_static_ip** (512)
    - Description: "Reserve a static external IP address"
    - Type: Boolean
    - Default: false
    - Rationale: Predictable IP for DNS configuration

13. **session_affinity** (513) [GKE only]
    - Description: "Session affinity: 'ClientIP' (sticky sessions) or 'None'"
    - Type: String (dropdown)
    - Default: "ClientIP"
    - Rationale: Session management

**Rationale**: Security is a major concern. Group all security features together so users can make informed decisions about their security posture.

---

## Group 5: Scaling & Performance (Order: 601-610)

**Purpose**: Control application scaling behavior and resource allocation.

**Variables** (in display order):

1. **container_image** (601)
   - Description: "Container image (e.g., 'nginx:latest', 'gcr.io/project/app:v1')"
   - Type: String
   - Default: Module-specific default image
   - Rationale: Source of the application container

2. **min_instance_count** (602)
   - Description: "Minimum number of instances (0 = scale to zero when idle)"
   - Type: Number (0-1000)
   - Default: 0
   - Rationale: Cost optimization vs. availability

3. **max_instance_count** (603)
   - Description: "Maximum number of instances under load"
   - Type: Number (1-1000)
   - Default: 3
   - Rationale: Scale limit control

4. **container_resources** (604)
   - Description: "Container CPU and memory limits"
   - Type: Object {cpu_limit: string, memory_limit: string}
   - Default: {cpu_limit: "1000m", memory_limit: "512Mi"}
   - Rationale: Resource allocation

**Rationale**: Scaling and performance settings directly impact cost and user experience. Users need visibility into these options to optimize their deployments.

---

## Group 6: Environment Variables (Order: 701-710)

**Purpose**: Application environment configuration.

**Variables** (in display order):

1. **environment_variables** (701)
   - Description: "Environment variables as key-value pairs (e.g., {APP_ENV='production', LOG_LEVEL='info'})"
   - Type: Map of strings
   - Default: Module-specific defaults
   - Rationale: Application configuration

2. **secret_environment_variables** (702)
   - Description: "Environment variables from Secret Manager (e.g., {API_KEY='my-api-key-secret'})"
   - Type: Map of strings
   - Default: {}
   - Rationale: Secure credential management

**Rationale**: Environment variables are essential for application configuration. Separating regular and secret variables helps users understand security implications.

---

## Group 7: Backup & Data Management (Order: 801-810)

**Purpose**: Data backup and import configuration.

**Variables** (in display order):

1. **enable_backup_import** (801)
   - Description: "Import database backup during deployment"
   - Type: Boolean
   - Default: false
   - Rationale: Data migration feature

2. **backup_source** (802)
   - Description: "Backup source: 'gcs' (Google Cloud Storage) or 'gdrive' (Google Drive)"
   - Type: String (dropdown)
   - Default: "gcs"
   - Condition: Only shown if enable_backup_import = true

3. **backup_uri** (803)
   - Description: "Backup URI (GCS: gs://bucket/path/file, GDrive: file ID)"
   - Type: String
   - Default: ""
   - Condition: Only shown if enable_backup_import = true

4. **backup_format** (804)
   - Description: "Backup format: 'sql', 'tar', 'gz', 'tgz', 'tar.gz', 'zip', or 'auto'"
   - Type: String (dropdown)
   - Default: "sql"
   - Condition: Only shown if enable_backup_import = true

**Rationale**: Backup/import is an optional feature. Only show these options when the user enables backup import to reduce UI complexity.

---

## Group 8: CI/CD & Automation (Order: 901-910)

**Purpose**: Continuous integration and deployment configuration.

**Variables** (in display order):

1. **enable_cicd_trigger** (901)
   - Description: "Enable automated Cloud Build CI/CD pipeline"
   - Type: Boolean
   - Default: false
   - Rationale: Automation toggle

2. **github_repository_url** (902)
   - Description: "GitHub repository URL (e.g., 'https://github.com/username/repo')"
   - Type: String
   - Default: ""
   - Condition: Only shown if enable_cicd_trigger = true

3. **github_token** (903)
   - Description: "GitHub Personal Access Token (PAT)"
   - Type: String (sensitive)
   - Default: ""
   - Condition: Only shown if enable_cicd_trigger = true

**Rationale**: CI/CD is an advanced feature. Only show these options when explicitly enabled to keep the UI clean for users who don't need automation.

---

## Group 9: Advanced Database (Order: 1001-1010)

**Purpose**: Advanced database customization for power users.

**Variables** (in display order):

1. **enable_custom_sql_scripts** (1001)
   - Description: "Execute custom SQL scripts during initialization"
   - Type: Boolean
   - Default: false
   - Rationale: Advanced data seeding

2. **custom_sql_scripts_bucket** (1002)
   - Description: "GCS bucket containing SQL scripts"
   - Type: String
   - Default: ""
   - Condition: Only shown if enable_custom_sql_scripts = true

3. **custom_sql_scripts_path** (1003)
   - Description: "Path prefix in bucket (scripts executed in alphabetical order)"
   - Type: String
   - Default: ""
   - Condition: Only shown if enable_custom_sql_scripts = true

4. **custom_sql_scripts_use_root** (1004)
   - Description: "Execute scripts as database root user (for elevated privileges)"
   - Type: Boolean
   - Default: false
   - Condition: Only shown if enable_custom_sql_scripts = true

**Rationale**: Custom SQL execution is an advanced feature for specific use cases. Conditional display keeps this from cluttering the UI for typical users.

---

## Summary Table: Recommended Group Structure

| Group | Name | Purpose | Typical # of Variables | Display |
|-------|------|---------|------------------------|---------|
| 0 | Hidden/Advanced | Internal config, auto-detected values, sensible defaults | 50-80 | Never shown |
| 1 | Project & Access | Project selection and user access | 3 | Always shown |
| 2 | Application Configuration | Core app settings | 5-7 | Always shown |
| 3 | Application-Specific | Module-specific options | 3-10 | Always shown |
| 4 | Security & Access Control | Security features and IAP | 10-13 | Always shown (conditional within) |
| 5 | Scaling & Performance | Resource limits and scaling | 4 | Always shown |
| 6 | Environment Variables | App environment config | 2 | Always shown |
| 7 | Backup & Data | Backup import options | 4 | Conditional (if backup enabled) |
| 8 | CI/CD & Automation | Build automation | 3 | Conditional (if CI/CD enabled) |
| 9 | Advanced Database | Custom SQL scripts | 4 | Conditional (if scripts enabled) |

---

## UI/UX Recommendations

### Progressive Disclosure
1. **Basic Mode** (default): Show groups 1-6 only
2. **Advanced Mode** (toggle): Also show groups 7-9
3. **Expert Mode** (configuration file): Access to group 0 variables

### Conditional Display Rules
- Use conditional rendering to show/hide related variables based on feature toggles
- Examples:
  - IAP variables only appear when `enable_iap = true`
  - Backup variables only appear when `enable_backup_import = true`
  - CI/CD variables only appear when `enable_cicd_trigger = true`

### Input Validation
- Provide real-time validation with helpful error messages
- Use input masks for formatted fields (e.g., CIDR ranges, email addresses)
- Suggest defaults and common values where applicable

### Help Text
- Each variable should have:
  - **Short description**: One-line summary (shown inline)
  - **Long description**: Detailed explanation (shown in tooltip/help panel)
  - **Example values**: Concrete examples to guide users
  - **Related documentation**: Links to docs for complex features

### Grouping Visual Design
- Use collapsible sections for each group
- Provide a group-level description explaining the section's purpose
- Use icons to indicate:
  - 🔒 Security-related settings
  - ⚡ Performance/scaling settings
  - 🔧 Advanced/optional features
  - ⚠️ Required fields

---

## Implementation Notes

### For GKE Modules
- All recommendations apply
- Additional GKE-specific variables in group 0: `gke_cluster_name`, `namespace_name`, `configure_service_mesh`, `service_type`, `workload_type`, StatefulSet configurations
- GKE has additional IAP fields: `iap_support_email`, `iap_oauth_client_id`, `iap_oauth_client_secret` (manual OAuth setup)
- Session affinity is more relevant for GKE (stateful applications)

### For CloudRun Modules
- All recommendations apply
- CloudRun-specific in group 0: `execution_environment`, `vpc_egress_setting`
- CloudRun has simpler IAP integration (native support)
- `ingress_settings` is CloudRun-specific (in group 4)

### Common Patterns Across All Modules
1. **Project selection first** - Always start with group 1
2. **Feature toggles** - Use boolean flags to enable/disable feature groups
3. **Sensible defaults** - Every variable should have a production-ready default
4. **Security opt-in** - Security features (IAP, VPC-SC, Cloud Armor) default to `false` to avoid surprising users
5. **Scaling defaults** - Conservative defaults (min=0, max=3) to control costs

---

## Benefits of This Approach

### For End Users
✅ **Reduced Complexity**: Only see ~20-30 variables instead of 80-100
✅ **Intuitive Flow**: Logical progression from project → app config → security → scaling
✅ **Progressive Disclosure**: Advanced features available when needed, hidden when not
✅ **Clear Choices**: Well-documented options with helpful defaults
✅ **Flexibility**: Can still access advanced settings when required

### For Platform
✅ **Consistency**: Same grouping across all modules
✅ **Maintainability**: Clear convention for adding new variables
✅ **User Experience**: Better onboarding and reduced support burden
✅ **Scalability**: Easy to add new modules following the same pattern

---

## Migration Path

### Phase 1: Audit
- Review all existing modules and verify variable assignments
- Ensure all variables have appropriate `{{UIMeta group=X order=Y}}` annotations

### Phase 2: Standardize
- Apply this grouping recommendation to all modules
- Update variable descriptions for clarity and consistency
- Add conditional display logic to UI

### Phase 3: UI Implementation
- Implement collapsible group sections
- Add progressive disclosure (Basic/Advanced/Expert modes)
- Implement conditional rendering based on feature toggles
- Add inline help and validation

### Phase 4: Documentation
- Create user guides showing the logical flow through configuration
- Provide examples for common deployment scenarios
- Document all conditional display logic

---

## Appendix: Variable Cross-Reference

### Variables to ALWAYS Show (Groups 1-6)

**Group 1: Project & Access**
- existing_project_id
- trusted_users
- tenant_deployment_id

**Group 2: Application Configuration**
- application_name
- application_database_name
- application_database_user
- enable_custom_domain (GKE)
- application_domains
- enable_cdn

**Group 3: Application-Specific**
- (Varies by module - WordPress: PHP settings, Ghost: theme settings, etc.)

**Group 4: Security & Access Control**
- enable_iap
- iap_authorized_users (conditional)
- iap_authorized_groups (conditional)
- iap_support_email (conditional, GKE only)
- iap_oauth_client_id (conditional)
- iap_oauth_client_secret (conditional)
- enable_vpc_sc
- admin_ip_ranges (conditional)
- ingress_settings (CloudRun only)
- enable_cloud_armor
- cloud_armor_policy_name (conditional)
- reserve_static_ip
- session_affinity (GKE only)

**Group 5: Scaling & Performance**
- container_image
- min_instance_count
- max_instance_count
- container_resources

**Group 6: Environment Variables**
- environment_variables
- secret_environment_variables

### Variables to Show CONDITIONALLY (Groups 7-9)

**Group 7: Backup & Data** (show if enable_backup_import = true)
- enable_backup_import (always show toggle)
- backup_source
- backup_uri
- backup_format

**Group 8: CI/CD** (show if enable_cicd_trigger = true)
- enable_cicd_trigger (always show toggle)
- github_repository_url
- github_token

**Group 9: Advanced Database** (show if enable_custom_sql_scripts = true)
- enable_custom_sql_scripts (always show toggle)
- custom_sql_scripts_bucket
- custom_sql_scripts_path
- custom_sql_scripts_use_root

### Variables to NEVER Show (Group 0)
- All module metadata variables
- All auto-detected service accounts
- All technical/advanced configuration with sensible defaults
- See "Group 0: Hidden/Advanced" section above for complete list

---

## Conclusion

This variable grouping recommendation balances simplicity with flexibility by:

1. **Hiding 60-70% of variables** that have sensible defaults or are auto-detected
2. **Exposing 20-30 essential variables** in logical groups
3. **Using progressive disclosure** for advanced features
4. **Maintaining consistency** across all GKE and CloudRun modules

The result is a streamlined user experience that doesn't overwhelm users while still providing the flexibility needed for advanced use cases.
