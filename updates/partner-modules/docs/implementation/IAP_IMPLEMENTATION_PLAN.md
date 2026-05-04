# Identity-Aware Proxy (IAP) Implementation Plan

## Overview

Add Identity-Aware Proxy (IAP) support to both Cloud Run and GKE modules, enabling enterprise-grade authentication and authorization without modifying application code.

---

## What is Identity-Aware Proxy?

IAP verifies user identity and context of the request to determine if a user should be allowed access to a resource. It provides:

- **Zero-trust security model**: Authenticate users before granting access
- **Integration with Google Workspace**: Use existing organizational identities
- **Context-aware access**: Control based on user identity, IP address, device security
- **No VPN required**: Secure remote access without traditional VPN
- **OAuth 2.0 based**: Industry-standard authentication protocol

---

## Implementation Scope

### CloudRun Modules (13)
- Enable IAP on the Global Load Balancer backend service
- OAuth consent screen configuration
- IAM policy bindings for authorized users/groups
- Support for external identities (Google, Microsoft, etc.)

### GKE Modules (13)
- Enable IAP on Gateway API backend policies
- BackendConfig or GCPBackendPolicy for IAP settings
- OAuth consent screen configuration
- IAM policy bindings for authorized users/groups

---

## Technical Architecture

### Cloud Run IAP Implementation

```
Internet → Global LB (IAP Enabled) → Cloud Run Service
                ↓
         OAuth2 Verification
         Identity Check
         IAM Authorization
```

Resources needed:
1. `google_iap_brand` - OAuth consent screen
2. `google_iap_client` - OAuth client credentials
3. `google_compute_backend_service` - with IAP configuration
4. `google_iap_web_backend_service_iam_binding` - IAM policy for authorized users

### GKE IAP Implementation

```
Internet → Gateway/Ingress (IAP Enabled) → GKE Service → Pods
                ↓
         OAuth2 Verification
         Identity Check
         IAM Authorization
```

Resources needed:
1. `google_iap_brand` - OAuth consent screen
2. `google_iap_client` - OAuth client credentials
3. `GCPBackendPolicy` - Kubernetes CRD with IAP settings
4. `google_iap_web_backend_service_iam_binding` - IAM policy for authorized users

---

## User Interface Design

### Simple 3-Variable Interface (consistent with custom domain/CDN)

```hcl
# Minimal IAP configuration
enable_iap = true
iap_authorized_users = [
  "user:alice@example.com",
  "user:bob@example.com"
]
iap_authorized_groups = [
  "group:engineering@example.com"
]
```

### Advanced Configuration (optional)

```hcl
# Full IAP configuration with OAuth settings
enable_iap = true

iap_config = {
  oauth_consent_screen = {
    support_email = "support@example.com"
    application_title = "My Application"
  }

  authorized_users = [
    "user:alice@example.com",
    "user:bob@example.com"
  ]

  authorized_groups = [
    "group:engineering@example.com"
  ]

  authorized_service_accounts = [
    "serviceAccount:ci-cd@project.iam.gserviceaccount.com"
  ]

  # Optional: External identity providers
  external_identities = [
    "principalSet://iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/my-pool/*"
  ]
}
```

---

## Variables to Add

### CloudRun Modules

```hcl
variable "enable_iap" {
  description = "Enable Identity-Aware Proxy for authentication and authorization. Requires enable_custom_domain to be true. {{UIMeta group=3 order=XXX updatesafe }}"
  type        = bool
  default     = false
}

variable "iap_authorized_users" {
  description = "List of user emails authorized to access via IAP (e.g., ['user:alice@example.com']). {{UIMeta group=3 order=XXX updatesafe }}"
  type        = list(string)
  default     = []
}

variable "iap_authorized_groups" {
  description = "List of Google Groups authorized to access via IAP (e.g., ['group:team@example.com']). {{UIMeta group=3 order=XXX updatesafe }}"
  type        = list(string)
  default     = []
}

variable "iap_support_email" {
  description = "Support email for OAuth consent screen. Required when enable_iap is true. {{UIMeta group=3 order=XXX updatesafe }}"
  type        = string
  default     = ""
}
```

### GKE Modules

Same variables as CloudRun, with appropriate descriptions mentioning Gateway API.

---

## Implementation Files

### New Files to Create

#### App_CloudRun/iap.tf
```hcl
# OAuth Consent Screen (Brand)
resource "google_iap_brand" "app_brand" {
  count             = local.deploy_application && var.enable_iap ? 1 : 0
  support_email     = var.iap_support_email
  application_title = local.application_display_name
  project           = local.project.project_id
}

# OAuth Client
resource "google_iap_client" "app_client" {
  count        = local.deploy_application && var.enable_iap ? 1 : 0
  display_name = "${local.application_display_name} IAP Client"
  brand        = google_iap_brand.app_brand[0].name
}

# IAM Bindings for authorized users
resource "google_iap_web_backend_service_iam_binding" "authorized_users" {
  count               = local.deploy_application && var.enable_iap && length(var.iap_authorized_users) > 0 ? 1 : 0
  project             = local.project.project_id
  web_backend_service = google_compute_backend_service.default[0].name
  role                = "roles/iap.httpsResourceAccessor"
  members             = var.iap_authorized_users
}

# IAM Bindings for authorized groups
resource "google_iap_web_backend_service_iam_binding" "authorized_groups" {
  count               = local.deploy_application && var.enable_iap && length(var.iap_authorized_groups) > 0 ? 1 : 0
  project             = local.project.project_id
  web_backend_service = google_compute_backend_service.default[0].name
  role                = "roles/iap.httpsResourceAccessor"
  members             = var.iap_authorized_groups
}
```

#### App_CloudRun/lb.tf (modifications)
```hcl
resource "google_compute_backend_service" "default" {
  # ... existing configuration ...

  # IAP Configuration
  dynamic "iap" {
    for_each = var.enable_iap ? [1] : []
    content {
      oauth2_client_id     = google_iap_client.app_client[0].client_id
      oauth2_client_secret = google_iap_client.app_client[0].secret
    }
  }
}
```

#### App_GKE/iap.tf
Similar to CloudRun, but using Gateway API backend policies.

#### App_GKE/gateway.tf (modifications)
```hcl
# GCPBackendPolicy with IAP
resource "kubernetes_manifest" "backend_policy_iap" {
  count = local.deploy_application && local.use_gateway && var.enable_iap ? 1 : 0

  manifest = {
    apiVersion = "networking.gke.io/v1"
    kind       = "GCPBackendPolicy"
    metadata = {
      name      = "${local.resource_prefix}-iap-policy"
      namespace = local.namespace_name
    }
    spec = {
      default = {
        iap = {
          enabled = true
          oauthclientCredentials = {
            secretName = kubernetes_secret.iap_credentials[0].metadata[0].name
          }
        }
      }
      targetRef = {
        group = ""
        kind  = "Service"
        name  = local.service_name
      }
    }
  }
}

# Kubernetes Secret for IAP OAuth credentials
resource "kubernetes_secret" "iap_credentials" {
  count = local.deploy_application && var.enable_iap ? 1 : 0

  metadata {
    name      = "${local.service_name}-iap-oauth"
    namespace = local.namespace_name
  }

  data = {
    client_id     = google_iap_client.app_client[0].client_id
    client_secret = google_iap_client.app_client[0].secret
  }
}
```

---

## Dependencies and Prerequisites

### IAP Requires:
1. **Custom domain enabled**: IAP only works with custom domains (not with run.app URLs)
2. **HTTPS enabled**: OAuth2 requires secure connections
3. **Load balancer/Gateway**: IAP is configured on the load balancer, not the backend

### Automatic Dependency Chain:
```
enable_iap = true
  ↓
REQUIRES: enable_custom_domain = true
  ↓
AUTOMATICALLY PROVISIONS: static IP, load balancer, SSL certificates
  ↓
THEN ENABLES: IAP on backend service
```

### Validation Logic:
```hcl
# In variables.tf
validation {
  condition     = !var.enable_iap || var.enable_custom_domain
  error_message = "IAP requires enable_custom_domain to be true. IAP only works with custom domains and HTTPS."
}

validation {
  condition     = !var.enable_iap || var.iap_support_email != ""
  error_message = "iap_support_email is required when enable_iap is true."
}

validation {
  condition     = !var.enable_iap || (length(var.iap_authorized_users) > 0 || length(var.iap_authorized_groups) > 0)
  error_message = "At least one of iap_authorized_users or iap_authorized_groups must be specified when enable_iap is true."
}
```

---

## Implementation Steps

### Phase 1: Base Module Implementation (App_CloudRun, App_GKE)

1. **Create IAP resource files**
   - App_CloudRun/iap.tf
   - App_GKE/iap.tf

2. **Add IAP variables to base modules**
   - App_CloudRun/variables.tf (add 4 IAP variables)
   - App_GKE/variables.tf (add 4 IAP variables)

3. **Modify existing load balancer configuration**
   - App_CloudRun/lb.tf (add IAP block to backend_service)
   - App_GKE/gateway.tf (add GCPBackendPolicy for IAP)

4. **Add validation rules**
   - Ensure enable_custom_domain is true when IAP enabled
   - Ensure support_email is provided
   - Ensure at least one authorized principal

### Phase 2: Wrapper Module Enablement (26 modules)

1. **Create symlinks**
   - CloudRun: ln -s ../App_CloudRun/iap.tf iap.tf
   - GKE: ln -s ../App_GKE/iap.tf iap.tf

2. **Add IAP variables to wrapper modules**
   - Add 4 variables to each module's variables.tf

3. **Create automation script**
   - enable-iap-feature.sh (similar to custom domain script)

### Phase 3: Testing

1. **Test CloudRun IAP**
   - Deploy Sample_CloudRun with IAP enabled
   - Verify OAuth consent screen
   - Verify user authorization
   - Test unauthorized access (should show Google sign-in)

2. **Test GKE IAP**
   - Deploy Sample_GKE with IAP enabled
   - Verify Gateway API integration
   - Verify Backend Policy application
   - Test user authorization

3. **Test edge cases**
   - IAP without custom domain (should fail validation)
   - IAP with no authorized users (should fail validation)
   - IAP with external identities

---

## Usage Examples

### Example 1: Basic IAP with User List
```hcl
module "cyclos" {
  source = "./modules/Cyclos_CloudRun"

  # Custom domain (required for IAP)
  enable_custom_domain = true
  application_domains  = ["banking.example.com"]

  # IAP Configuration
  enable_iap              = true
  iap_support_email       = "support@example.com"
  iap_authorized_users    = [
    "user:alice@example.com",
    "user:bob@example.com"
  ]

  # ... other required variables
}
```

### Example 2: IAP with Google Groups
```hcl
module "wordpress" {
  source = "./modules/Wordpress_CloudRun"

  # Custom domain + CDN
  enable_custom_domain = true
  application_domains  = ["blog.example.com"]
  enable_cdn          = true

  # IAP with groups (easier management)
  enable_iap              = true
  iap_support_email       = "support@example.com"
  iap_authorized_groups   = [
    "group:engineering@example.com",
    "group:management@example.com"
  ]

  # ... other required variables
}
```

### Example 3: IAP with Service Accounts (for automation)
```hcl
module "moodle" {
  source = "./modules/Moodle_GKE"

  enable_custom_domain = true
  application_domains  = ["learn.example.com"]

  enable_iap              = true
  iap_support_email       = "support@example.com"
  iap_authorized_users    = [
    "user:admin@example.com",
    "serviceAccount:ci-cd@project.iam.gserviceaccount.com"
  ]

  # ... other required variables
}
```

---

## Security Considerations

### Benefits:
- **Zero-trust security**: No access without authentication
- **Centralized access control**: Manage at infrastructure level
- **Audit logging**: All access attempts logged
- **No application changes**: Works transparently

### Limitations:
- **Requires Google accounts**: Users need Google identity
- **Cannot use with Cloud Run default URLs**: Custom domain required
- **OAuth consent screen required**: Must be configured per project
- **IAM propagation delay**: May take a few minutes for changes

### Best Practices:
1. **Use groups for authorization**: Easier to manage than individual users
2. **Rotate OAuth secrets**: Periodically refresh credentials
3. **Monitor access logs**: Track who accesses the application
4. **Test unauthorized access**: Verify IAP is working correctly
5. **Document support email**: Use a monitored address

---

## Testing Checklist

- [ ] CloudRun: IAP resources created successfully
- [ ] CloudRun: OAuth consent screen displayed
- [ ] CloudRun: Authorized user can access
- [ ] CloudRun: Unauthorized user blocked
- [ ] CloudRun: Service account can access (for automation)
- [ ] GKE: IAP resources created successfully
- [ ] GKE: GCPBackendPolicy applied
- [ ] GKE: OAuth consent screen displayed
- [ ] GKE: Authorized user can access
- [ ] GKE: Unauthorized user blocked
- [ ] Validation: IAP fails without custom domain
- [ ] Validation: IAP fails without support email
- [ ] Validation: IAP fails without authorized principals

---

## Documentation to Create

1. **IAP_IMPLEMENTATION.md**
   - Comprehensive guide for implementing IAP
   - User authentication flow
   - Troubleshooting guide

2. **IAP_USER_GUIDE.md**
   - How to grant access to users
   - How to revoke access
   - OAuth consent screen configuration
   - External identity federation

3. **enable-iap-feature.sh**
   - Automation script to add IAP support to all modules
   - Similar structure to enable-custom-domain-feature.sh

---

## Estimated Effort

| Task | Effort | Priority |
|------|--------|----------|
| Design and planning | 4 hours | ✅ Complete |
| Base module implementation (CloudRun) | 6 hours | High |
| Base module implementation (GKE) | 6 hours | High |
| Wrapper module enablement (26 modules) | 2 hours | High |
| Testing (both platforms) | 4 hours | High |
| Documentation | 3 hours | Medium |
| **Total** | **25 hours** | |

---

## Success Criteria

✅ IAP enabled on all 26 wrapper modules
✅ Simple 4-variable interface for module deployers
✅ Automatic dependency on custom domain
✅ OAuth consent screen auto-configured
✅ IAM policies auto-applied
✅ Works with both Cloud Run and GKE
✅ Validated with real user authentication
✅ Comprehensive documentation

---

## Next Actions

1. Review this implementation plan
2. Approve the approach and scope
3. Begin Phase 1: Base module implementation
4. Test with Sample modules
5. Roll out to all 26 wrapper modules
6. Create comprehensive documentation

---

## Questions to Resolve

1. **OAuth Consent Screen**:
   - Should we create one brand per module or share across modules?
   - Recommendation: One per project (shared)

2. **IAP Access Levels**:
   - Do we need to support Context-Aware Access policies?
   - Recommendation: Start simple, add advanced features later

3. **External Identities**:
   - Should we support federation with non-Google providers initially?
   - Recommendation: Start with Google identities, add federation later

4. **Service Account Access**:
   - How to handle automated access (CI/CD, monitoring)?
   - Recommendation: Support service accounts in authorized_users list

---

## Related Features

This IAP implementation complements:
- ✅ Custom Domain support (REQUIRED for IAP)
- ✅ CDN support (works with IAP)
- Future: WAF integration
- Future: Binary Authorization
- Future: Cloud Armor policies

---

## Cost Implications

**IAP Pricing:**
- First 1,000 users: Free
- Next 100,000 users: $5.00 per user per month
- Beyond 100,000 users: $2.50 per user per month

**Note:** For most deployments, IAP will be FREE or very low cost.

**Additional Costs:**
- OAuth consent screen: Free
- IAM policy evaluations: Free
- Load balancer (already required for custom domain): No additional cost

---

## References

- [Identity-Aware Proxy Documentation](https://cloud.google.com/iap/docs)
- [IAP for Cloud Run](https://cloud.google.com/iap/docs/enabling-cloud-run)
- [IAP for GKE](https://cloud.google.com/iap/docs/enabling-kubernetes-howto)
- [OAuth 2.0 for Server-to-Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
