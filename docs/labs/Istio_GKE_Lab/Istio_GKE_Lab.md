---
title: "Istio Service Mesh on GKE — Lab Guide"
sidebar_label: "Istio GKE Lab"
---

# Istio Service Mesh on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Istio_GKE)**

This lab guide walks you through the full lifecycle of deploying, configuring, and observing a
service mesh on Google Kubernetes Engine using **Cloud Service Mesh (CSM)** — Google's managed
distribution of Istio. You will use the **Services_GCP** and **App_GKE** modules to provision the
platform, then explore traffic management, security, and observability capabilities hands-on.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Verify the Service Mesh Installation](#exercise-1--verify-the-service-mesh-installation)
6. [Exercise 2 — Sidecar Injection and Envoy Proxy](#exercise-2--sidecar-injection-and-envoy-proxy)
7. [Exercise 3 — Traffic Management (Canary and Weighted Routing)](#exercise-3--traffic-management-canary-and-weighted-routing)
8. [Exercise 4 — Mutual TLS and PeerAuthentication](#exercise-4--mutual-tls-and-peerauthentication)
9. [Exercise 5 — Authorization Policies (L7 Access Control)](#exercise-5--authorization-policies-l7-access-control)
10. [Exercise 6 — Observability: Metrics, Tracing, and Kiali](#exercise-6--observability-metrics-tracing-and-kiali)
11. [Exercise 7 — Gateway API: Managed External Ingress](#exercise-7--gateway-api-managed-external-ingress)
12. [Exercise 8 — Network Segmentation with Kubernetes NetworkPolicies](#exercise-8--network-segmentation-with-kubernetes-networkpolicies)
13. [Exercise 9 — Cloud Armor WAF on the GKE Gateway](#exercise-9--cloud-armor-waf-on-the-gke-gateway)
14. [Exercise 10 — Multi-Cluster Service Mesh](#exercise-10--multi-cluster-service-mesh)
15. [Cleanup](#15-cleanup)
16. [Reference](#16-reference)

---

## 1. Overview

### What Is Istio?

Istio is an open-source **service mesh** that adds a transparent layer of infrastructure to
distributed applications. It manages service-to-service communication in Kubernetes clusters
without requiring changes to application code. Every pod in an Istio-enabled namespace gets an
**Envoy** sidecar proxy injected automatically. All traffic flows through this sidecar, giving the
mesh control plane visibility and enforcement capabilities across the entire fleet.

Key capabilities:

| Capability | What It Enables |
|---|---|
| **Traffic Management** | Canary releases, A/B testing, circuit breaking, fault injection, retries |
| **Security** | Mutual TLS (mTLS) between all services, L7 authorization policies, JWT validation |
| **Observability** | Automatic telemetry: request metrics, distributed traces, service topology |
| **Resilience** | Timeouts, health-aware load balancing, outlier detection |

### Cloud Service Mesh on GKE

Google Cloud's **Cloud Service Mesh (CSM)** is a fully managed Istio control plane delivered via
Fleet Hub. When enabled through the `Services_GCP` module, Google manages:

- Istio installation and upgrades on the cluster
- Certificate management and rotation (Workload Identity–based)
- Multi-cluster service discovery when multiple clusters are Fleet members
- Integration with Google Cloud Monitoring, Trace, and the Cloud Service Mesh dashboard

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Google Cloud Fleet                                                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Cloud Service Mesh (servicemesh Fleet Feature)               │ │
│  │  Management: MANAGEMENT_AUTOMATIC                              │ │
│  └────────────────┬───────────────────────────────────────────────┘ │
│                   │ Fleet Hub membership                            │
│  ┌────────────────▼───────────────────────────────────────────────┐ │
│  │  GKE Autopilot Cluster (Services_GCP)                         │ │
│  │                                                                │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │  App Namespace (label: istio.io/rev=asm-managed)         │ │ │
│  │  │                                                          │ │ │
│  │  │  ┌─────────────────────┐   ┌─────────────────────────┐  │ │ │
│  │  │  │  Pod (app container)│   │  Pod (app container)    │  │ │ │
│  │  │  │  + Envoy sidecar    │◄──►  + Envoy sidecar        │  │ │ │
│  │  │  │  (mTLS enforced)    │   │  (mTLS enforced)        │  │ │ │
│  │  │  └──────────┬──────────┘   └────────────┬────────────┘  │ │ │
│  │  └─────────────│───────────────────────────│───────────────┘ │ │
│  │                │ Envoy data plane           │                  │ │
│  │  ┌─────────────▼───────────────────────────▼───────────────┐ │ │
│  │  │  GKE Gateway (L7 Global External Managed)               │ │ │
│  │  │  Certificate Manager + Cloud Armor WAF                  │ │ │
│  │  └────────────────────────────────────────────────────────── │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Services_GCP
    configure_cloud_service_mesh = true   →  Fleet Hub servicemesh feature
                                             MANAGEMENT_AUTOMATIC per cluster

  App_GKE
    configure_service_mesh       = true   →  istio.io/rev=asm-managed label
                                             on the application namespace
                                             (triggers Envoy sidecar injection)
    enable_network_segmentation  = true   →  Kubernetes NetworkPolicies
    enable_cloud_armor           = true   →  Cloud Armor WAF on Gateway
    enable_iap                   = true   →  Identity-Aware Proxy
```

### Data Plane vs Control Plane

| Component | Location | Managed by |
|---|---|---|
| **Envoy sidecars** | Inside each pod (data plane) | CSM (auto-injected) |
| **istiod** | `asm-system` namespace | Google Cloud (managed) |
| **Mesh CA** | Fleet / Workload Identity | Google Cloud |
| **Telemetry** | Cloud Monitoring / Trace | Google Cloud |

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `istioctl` | 1.20+ | `curl -L https://istio.io/downloadIstio | sh -` |
| `curl` / `jq` | Any | System package manager |

**Access to the RAD UI** with permission to deploy modules (`Services_GCP` and `App_GKE`) in the target GCP project.

### GCP Permissions

Your identity (user or service account) needs these roles on the project:

```
roles/owner                        # or the following fine-grained set:
roles/container.admin
roles/gkehub.admin
roles/iam.serviceAccountAdmin
roles/compute.networkAdmin
roles/certificatemanager.owner
roles/iap.admin                    # if using IAP exercises
roles/cloudarmor.admin             # if using Cloud Armor exercises
```

### Environment Variables

Set these once; all commands in this lab reference them:

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER_NAME="csm-lab-cluster"
export APP_NAMESPACE="sample-app"
export MESH_REV="asm-managed"

gcloud config set project "${PROJECT_ID}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Enable Required APIs

**gcloud:**
```bash
gcloud services enable \
  container.googleapis.com \
  gkehub.googleapis.com \
  mesh.googleapis.com \
  meshconfig.googleapis.com \
  meshtelemetry.googleapis.com \
  anthos.googleapis.com \
  multiclusteringress.googleapis.com \
  certificatemanager.googleapis.com \
  iap.googleapis.com \
  --project="${PROJECT_ID}"
```

**REST API equivalent:**
```bash
for api in \
  container.googleapis.com \
  gkehub.googleapis.com \
  mesh.googleapis.com \
  meshconfig.googleapis.com; do
  curl -s -X POST \
    "https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/${api}:enable" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json"
done
```

### 4.2 Deploy the Platform (Services_GCP)

Deploy the `Services_GCP` module via the RAD UI. In the variable form, set the following key variables:

| Variable | Value |
|---|---|
| `project_id` | `your-gcp-project-id` |
| `region` | `us-central1` |
| `create_google_kubernetes_engine` | `true` |
| `configure_cloud_service_mesh` | `true` (enables Fleet Hub CSM feature) |
| `gke_cluster_name` | `csm-lab-cluster` |

Click **Deploy** and wait for provisioning to complete.

> **What this provisions:** A GKE Autopilot cluster registered as a Fleet member, the
> `servicemesh` Fleet feature enabled with `MANAGEMENT_AUTOMATIC`, and (if multi-cluster) the
> Multi-Cluster Ingress feature. Google's control plane automatically installs the Istio control
> plane (`istiod`) in the `asm-system` namespace.

### 4.3 Deploy the Application (App_GKE)

Deploy the `App_GKE` module via the RAD UI. In the variable form, set the following key variables:

| Variable | Value |
|---|---|
| `project_id` | `your-gcp-project-id` |
| `region` | `us-central1` |
| `application_name` | `sample` |
| `deploy_application` | `true` |
| `configure_service_mesh` | `true` (adds istio.io/rev label to namespace) |
| `enable_network_segmentation` | `true` |
| `container_image` | `us-docker.pkg.dev/google-samples/containers/gke/hello-app:1.0` |
| `container_port` | `8080` |
| `service_type` | `ClusterIP` |

Click **Deploy** and wait for provisioning to complete.

### 4.4 Configure kubectl

**gcloud:**
```bash
gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}"
```

**REST API equivalent** (retrieve cluster endpoint and CA):
```bash
CLUSTER_ENDPOINT=$(curl -s \
  "https://container.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/clusters/${CLUSTER_NAME}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq -r '.endpoint')

echo "Cluster endpoint: https://${CLUSTER_ENDPOINT}"
```

---

## Exercise 1 — Verify the Service Mesh Installation

### Objective

Confirm that Cloud Service Mesh is active on the cluster, the Istio control plane is healthy, and
the Fleet Hub membership is correctly configured.

### Step 1.1 — Check Fleet Hub Membership

**gcloud:**
```bash
gcloud container fleet memberships list --project="${PROJECT_ID}"
```

Expected output (abbreviated):
```
NAME               EXTERNAL_ID                            LOCATION
csm-lab-cluster    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   global
```

**REST API:**
```bash
curl -s \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/memberships" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.resources[] | {name, state: .state.code}'
```

### Step 1.2 — Check the Service Mesh Fleet Feature

**gcloud:**
```bash
gcloud container fleet mesh describe --project="${PROJECT_ID}"
```

Expected output:
```
membershipSpecs:
  projects/.../locations/global/memberships/csm-lab-cluster:
    mesh:
      management: MANAGEMENT_AUTOMATIC
membershipStates:
  projects/.../locations/global/memberships/csm-lab-cluster:
    servicemesh:
      controlPlaneManagement:
        state: ACTIVE
      dataPlaneManagement:
        state: ACTIVE
```

**REST API:**
```bash
curl -s \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/features/servicemesh" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{state: .state.state, membershipStates: .membershipStates}'
```

### Step 1.3 — Verify Istio Control Plane Pods

```bash
kubectl get pods -n asm-system
```

Expected (managed CSM runs without local `istiod` — look for the webhook instead):
```bash
kubectl get mutatingwebhookconfigurations | grep -i istio
```

You should see `istiod-asm-managed` or `istio-sidecar-injector` — this confirms the managed
control plane is wired to the cluster's admission controllers.

### Step 1.4 — Inspect Mesh Configuration with istioctl

```bash
istioctl version
istioctl proxy-status          # lists all enrolled Envoy proxies
istioctl analyze -n "${APP_NAMESPACE}"   # reports any mesh configuration issues
```

---

## Exercise 2 — Sidecar Injection and Envoy Proxy

### Objective

Understand how the `istio.io/rev=asm-managed` namespace label triggers automatic Envoy sidecar
injection, and inspect the injected sidecar inside a running pod.

### Step 2.1 — Verify the Namespace Label

The App_GKE module sets this label when `configure_service_mesh = true`:

```bash
kubectl get namespace "${APP_NAMESPACE}" --show-labels
```

Expected:
```
NAME          STATUS   AGE   LABELS
sample-app    Active   5m    istio.io/rev=asm-managed, ...
```

If you need to label an existing namespace manually:

**kubectl:**
```bash
kubectl label namespace "${APP_NAMESPACE}" \
  istio.io/rev="${MESH_REV}" \
  --overwrite
```

**REST API equivalent:**
```bash
curl -s -X PATCH \
  "https://container.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/clusters/${CLUSTER_NAME}/resourceLabels" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"resourceLabels": {"istio.io/rev": "asm-managed"}}'
```

> Note: The REST approach above patches cluster-level labels. Namespace labels in Kubernetes are
> managed through the Kubernetes API, not the GKE API. Use `kubectl patch` or `kubectl label` for
> namespace-level operations.

### Step 2.2 — Restart Pods to Trigger Injection

Existing pods must be restarted after the label is added to receive a sidecar:

```bash
kubectl rollout restart deployment -n "${APP_NAMESPACE}"
```

### Step 2.3 — Confirm Two Containers Per Pod

```bash
kubectl get pods -n "${APP_NAMESPACE}" -o wide
```

The `READY` column should show `2/2` — the app container plus the injected Envoy sidecar:

```
NAME                      READY   STATUS    RESTARTS   AGE
sample-xxxxxxxxx-xxxxx    2/2     Running   0          2m
```

### Step 2.4 — Inspect the Sidecar

```bash
POD=$(kubectl get pod -n "${APP_NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

# View all containers in the pod
kubectl get pod "${POD}" -n "${APP_NAMESPACE}" \
  -o jsonpath='{.spec.containers[*].name}' | tr ' ' '\n'

# Check Envoy proxy version
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  pilot-agent request GET server_info | jq '.version'

# Inspect active Envoy listeners (what the sidecar intercepts)
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  pilot-agent request GET listeners | jq '.[] | .name'
```

### Step 2.5 — View Envoy Proxy Configuration via istioctl

```bash
# Full proxy configuration dump
istioctl proxy-config all "${POD}" -n "${APP_NAMESPACE}"

# Just the clusters (upstream services known to this sidecar)
istioctl proxy-config cluster "${POD}" -n "${APP_NAMESPACE}"

# Active routes
istioctl proxy-config route "${POD}" -n "${APP_NAMESPACE}"
```

---

## Exercise 3 — Traffic Management (Canary and Weighted Routing)

### Objective

Deploy two versions of a service and use Istio `VirtualService` and `DestinationRule` resources to
split traffic between them — demonstrating canary releases and blue/green deployments without
infrastructure changes.

### Background: Istio Traffic Management Resources

| Resource | Purpose |
|---|---|
| `DestinationRule` | Defines named subsets of a service (e.g., v1, v2) and load balancing policy |
| `VirtualService` | Attaches routing rules to a Kubernetes Service — weight, headers, retry, timeout |
| `Gateway` (Istio) | Manages inbound/outbound traffic at the mesh boundary (not the GKE Gateway API) |

### Step 3.1 — Deploy Two Application Versions

```yaml
# deploy-v1.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-v1
  namespace: sample-app
  labels:
    app: sample
    version: v1
spec:
  replicas: 2
  selector:
    matchLabels:
      app: sample
      version: v1
  template:
    metadata:
      labels:
        app: sample
        version: v1
    spec:
      containers:
      - name: sample
        image: us-docker.pkg.dev/google-samples/containers/gke/hello-app:1.0
        ports:
        - containerPort: 8080
---
# deploy-v2.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-v2
  namespace: sample-app
  labels:
    app: sample
    version: v2
spec:
  replicas: 2
  selector:
    matchLabels:
      app: sample
      version: v2
  template:
    metadata:
      labels:
        app: sample
        version: v2
    spec:
      containers:
      - name: sample
        image: us-docker.pkg.dev/google-samples/containers/gke/hello-app:2.0
        ports:
        - containerPort: 8080
```

```bash
kubectl apply -f deploy-v1.yaml
kubectl apply -f deploy-v2.yaml
kubectl get pods -n "${APP_NAMESPACE}" -L version
```

### Step 3.2 — Define a DestinationRule

```yaml
# destination-rule.yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: sample-dr
  namespace: sample-app
spec:
  host: sample           # matches the Kubernetes Service name
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 1000
    outlierDetection:    # circuit breaking
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

```bash
kubectl apply -f destination-rule.yaml
kubectl get destinationrules -n "${APP_NAMESPACE}"
```

### Step 3.3 — Create a VirtualService (90/10 Canary Split)

```yaml
# virtual-service-canary.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: sample-vs
  namespace: sample-app
spec:
  hosts:
  - sample
  http:
  - match:
    - headers:
        x-canary:
          exact: "true"
    route:
    - destination:
        host: sample
        subset: v2
      weight: 100
  - route:
    - destination:
        host: sample
        subset: v1
      weight: 90
    - destination:
        host: sample
        subset: v2
      weight: 10
    retries:
      attempts: 3
      perTryTimeout: 5s
      retryOn: "5xx,reset,connect-failure"
    timeout: 15s
```

```bash
kubectl apply -f virtual-service-canary.yaml
```

### Step 3.4 — Test the Traffic Split

Launch a test pod in the same namespace:

```bash
kubectl run curl-test \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n "${APP_NAMESPACE}" \
  -- sh

# Inside the pod — send 20 requests and count which version responds
for i in $(seq 1 20); do
  curl -s http://sample:8080 | grep "Hello"
done

# Test canary header routing (always goes to v2)
curl -s -H "x-canary: true" http://sample:8080
```

### Step 3.5 — Shift to 100% v2 (Promotion)

```bash
kubectl patch virtualservice sample-vs \
  -n "${APP_NAMESPACE}" \
  --type='merge' \
  -p '{
    "spec": {
      "http": [{
        "route": [{
          "destination": {"host": "sample", "subset": "v2"},
          "weight": 100
        }]
      }]
    }
  }'
```

### Step 3.6 — Inject a Fault (Chaos Engineering)

```yaml
# virtual-service-fault.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: sample-vs
  namespace: sample-app
spec:
  hosts:
  - sample
  http:
  - fault:
      delay:
        percentage:
          value: 10.0
        fixedDelay: 3s
      abort:
        percentage:
          value: 5.0
        httpStatus: 503
    route:
    - destination:
        host: sample
        subset: v2
```

```bash
kubectl apply -f virtual-service-fault.yaml

# Observe retry behaviour kicking in
kubectl exec curl-test -n "${APP_NAMESPACE}" -- \
  sh -c 'for i in $(seq 1 50); do curl -s -o /dev/null -w "%{http_code}\n" http://sample:8080; done'
```

---

## Exercise 4 — Mutual TLS and PeerAuthentication

### Objective

Enforce strict mutual TLS (mTLS) between all services in the namespace, verify encrypted
communication using Envoy proxy stats, and understand how CSM's managed CA issues workload
certificates via Workload Identity.

### Background

Cloud Service Mesh issues X.509 certificates to each workload sidecar, signed by the Fleet-level
mesh CA. mTLS is negotiated transparently by the Envoy sidecars — application code has no
awareness of the encryption.

```
Service A Pod                     Service B Pod
┌─────────────────────┐           ┌─────────────────────┐
│  App container      │           │  App container      │
│  (plain HTTP)       │           │  (plain HTTP)       │
├─────────────────────┤           ├─────────────────────┤
│  Envoy sidecar      │◄─mTLS────►│  Envoy sidecar      │
│  (cert: spiffe://   │           │  (cert: spiffe://   │
│   .../sa/service-a) │           │   .../sa/service-b) │
└─────────────────────┘           └─────────────────────┘
```

### Step 4.1 — Check Current mTLS Mode

```bash
istioctl x authz check "${POD}" -n "${APP_NAMESPACE}"

# View certificate details on the sidecar
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  openssl s_client -connect sample:8080 -showcerts 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates
```

### Step 4.2 — Apply Strict PeerAuthentication (Namespace-Wide)

In permissive mode (default), both mTLS and plaintext are accepted. Strict mode rejects any
non-mTLS connection.

```yaml
# peer-auth-strict.yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: sample-app
spec:
  mtls:
    mode: STRICT
```

```bash
kubectl apply -f peer-auth-strict.yaml

# Verify the policy is active
kubectl get peerauthentication -n "${APP_NAMESPACE}"
```

### Step 4.3 — Test mTLS Enforcement

```bash
# This should FAIL — plain HTTP from outside the mesh
kubectl run plain-curl \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n default \
  -- curl -v http://sample.sample-app.svc.cluster.local:8080

# This should SUCCEED — sidecar-equipped pod in the same namespace
kubectl run mesh-curl \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n sample-app \
  -- curl -s http://sample:8080
```

### Step 4.4 — Check the Workload Certificate (SPIFFE Identity)

```bash
POD=$(kubectl get pod -n "${APP_NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

# Retrieve the leaf certificate from the running sidecar
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  cat /var/run/secrets/workload-spiffe-credentials/certificates.pem \
  | openssl x509 -noout -text \
  | grep -E "Subject Alternative Name|URI"
```

Expected: `URI:spiffe://PROJECT_ID.svc.id.goog/ns/sample-app/sa/default`

### Step 4.5 — View mTLS Stats on the Envoy Proxy

```bash
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  pilot-agent request GET stats | grep -E "ssl\.(handshake|connection_error|fail)"
```

---

## Exercise 5 — Authorization Policies (L7 Access Control)

### Objective

Use Istio `AuthorizationPolicy` resources to enforce fine-grained, per-route access control
between services — without touching application code or firewall rules.

### Background

`AuthorizationPolicy` operates at Layer 7 inside the Envoy sidecar. Policies can match on:

- Source service account (SPIFFE identity)
- Source namespace
- HTTP method, path, headers
- JWT claims (when combined with `RequestAuthentication`)

### Step 5.1 — Deny All Traffic by Default

```yaml
# deny-all.yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: sample-app
spec:
  {}   # empty spec = deny all
```

```bash
kubectl apply -f deny-all.yaml

# Confirm all requests are now rejected
kubectl run test-curl \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n sample-app \
  -- curl -s -o /dev/null -w "%{http_code}" http://sample:8080
# Expected: 403
```

### Step 5.2 — Allow GET Requests from a Specific Service Account

```yaml
# allow-frontend.yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-frontend
  namespace: sample-app
spec:
  selector:
    matchLabels:
      app: sample
  rules:
  - from:
    - source:
        principals:
        - "cluster.local/ns/sample-app/sa/frontend"
    to:
    - operation:
        methods: ["GET"]
        paths: ["/", "/health", "/api/*"]
    when:
    - key: request.headers[x-request-id]
      notValues: [""]   # require a correlation ID header
```

```bash
kubectl apply -f allow-frontend.yaml
```

### Step 5.3 — Allow Health Checks from Any Source

```yaml
# allow-health.yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-health
  namespace: sample-app
spec:
  selector:
    matchLabels:
      app: sample
  rules:
  - to:
    - operation:
        methods: ["GET"]
        paths: ["/health", "/ready"]
```

```bash
kubectl apply -f allow-health.yaml
```

### Step 5.4 — JWT Validation with RequestAuthentication

```yaml
# request-authn.yaml
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: sample-app
spec:
  selector:
    matchLabels:
      app: sample
  jwtRules:
  - issuer: "https://accounts.google.com"
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs"
    audiences:
    - "your-oauth-client-id.apps.googleusercontent.com"
    forwardOriginalToken: true
```

```bash
kubectl apply -f request-authn.yaml

# Test with a valid Google ID token
TOKEN=$(gcloud auth print-identity-token)
kubectl run jwt-test \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n sample-app \
  -- curl -s -H "Authorization: Bearer ${TOKEN}" http://sample:8080
```

### Step 5.5 — Audit Policy Decisions

```bash
# Check Envoy RBAC filter stats (allowed vs denied)
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  pilot-agent request GET stats \
  | grep -E "rbac\.(allowed|denied|shadow)"
```

---

## Exercise 6 — Observability: Metrics, Tracing, and Kiali

### Objective

Explore the telemetry stack automatically provisioned by Cloud Service Mesh: RED metrics (Rate,
Errors, Duration), distributed traces, and the service topology graph.

### Step 6.1 — Cloud Service Mesh Dashboard

**gcloud (open in browser):**
```bash
gcloud container fleet mesh describe \
  --project="${PROJECT_ID}" \
  --format="value(membershipStates)"

# Navigate to: Console > Anthos > Service Mesh
echo "https://console.cloud.google.com/anthos/meshes?project=${PROJECT_ID}"
```

The dashboard shows:
- **Service topology** — which services communicate with which
- **Goldilocks metrics** — request rate, error rate, latency P50/P90/P99
- **SLO windows** — current error budget against configured objectives

### Step 6.2 — Query Mesh Metrics in Cloud Monitoring

**gcloud (MQL query):**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:istio" \
  --project="${PROJECT_ID}" \
  | grep -E "request_count|request_duration|request_bytes"
```

**REST API — run an instant MQL query:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch istio_canonical_service::istio.io/service/server/request_count | within 1h | group_by [resource.service_name], sum(val())"
  }' | jq '.timeSeriesData[].labelValues'
```

### Step 6.3 — Distributed Tracing via Cloud Trace

CSM auto-instruments traces using the W3C `traceparent` header. No application code change is
needed.

**gcloud (list recent traces):**
```bash
gcloud trace traces list \
  --project="${PROJECT_ID}" \
  --start-time="$(date -d '1 hour ago' --utc +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time="$(date --utc +%Y-%m-%dT%H:%M:%SZ)" \
  --limit=10
```

**REST API:**
```bash
START=$(date -d '1 hour ago' --utc +%Y-%m-%dT%H:%M:%SZ)
curl -s \
  "https://cloudtrace.googleapis.com/v1/projects/${PROJECT_ID}/traces?startTime=${START}&pageSize=5" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.traces[] | {traceId, spans: (.spans | length)}'
```

**Generate load to produce traces:**
```bash
kubectl run trace-gen \
  --image=fortio/fortio:latest \
  --restart=Never \
  --rm -it \
  -n "${APP_NAMESPACE}" \
  -- load -c 5 -qps 10 -t 60s http://sample:8080
```

### Step 6.4 — Access Kiali (Service Topology)

Kiali is not deployed by managed CSM by default; Google's dashboard is the primary UI. If you
have a self-managed Istio layer or want Kiali for deeper exploration:

```bash
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/kiali.yaml -n istio-system

# Port-forward to Kiali
kubectl port-forward svc/kiali 20001:20001 -n istio-system &

# Open: http://localhost:20001
```

### Step 6.5 — Prometheus Metrics (Local Scrape)

```bash
# Port-forward to the Envoy admin interface
kubectl port-forward "${POD}" 15000:15000 -n "${APP_NAMESPACE}" &

# Query Envoy stats directly
curl -s http://localhost:15000/stats/prometheus \
  | grep -E "istio_requests_total|istio_request_duration"
```

---

## Exercise 7 — Gateway API: Managed External Ingress

### Objective

Expose the mesh-enabled application externally using the **GKE Gateway API** — a Kubernetes-native
ingress layer that manages a Google Cloud L7 External Load Balancer, TLS certificates, and
optionally Cloud Armor WAF and IAP.

The App_GKE module provisions all of this via `gateway.tf` when `enable_custom_domain = true`.

### Step 7.1 — Enable the Gateway via RAD UI Update

Return to the RAD UI, navigate to your `App_GKE` deployment, update the following variables, and click **Update**:

| Variable | Value |
|---|---|
| `enable_custom_domain` | `true` |
| `application_domains` | `["app.example.com"]` |
| `service_type` | `ClusterIP` (Gateway handles external exposure) |

This creates:
- A `Certificate Manager` certificate (Google-managed, auto-renewed)
- A `Certificate Map` and `Certificate Map Entry`
- A GKE `Gateway` resource (`gke-l7-global-external-managed` class)
- An `HTTPRoute` pointing to the application Service
- A `GCPBackendPolicy` for timeout, IAP, and Cloud Armor attachment

### Step 7.2 — Retrieve the Gateway's External IP

**kubectl:**
```bash
kubectl get gateway -n "${APP_NAMESPACE}" -o wide

GATEWAY_IP=$(kubectl get gateway -n "${APP_NAMESPACE}" \
  -o jsonpath='{.items[0].status.addresses[0].value}')
echo "Gateway IP: ${GATEWAY_IP}"
```

**gcloud (via reserved address):**
```bash
gcloud compute addresses list \
  --filter="name~sample" \
  --project="${PROJECT_ID}"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT_ID}/global/addresses" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | select(.name | test("sample")) | {name, address, status}'
```

### Step 7.3 — Test HTTP and HTTPS Endpoints

```bash
# HTTP (port 80)
curl -v "http://${GATEWAY_IP}"

# HTTPS (requires DNS A record pointing app.example.com → GATEWAY_IP)
curl -v "https://app.example.com"
```

### Step 7.4 — Inspect the HTTPRoute

```bash
kubectl describe httproute -n "${APP_NAMESPACE}"
```

### Step 7.5 — Cross-Namespace Backend with ReferenceGrant

When Cloud Deploy stages are active, the backend Service lives in a per-stage namespace. The
module creates a `ReferenceGrant` to permit the cross-namespace `backendRef`:

```bash
kubectl get referencegrant -A
kubectl describe referencegrant -n "${APP_NAMESPACE}"
```

---

## Exercise 8 — Network Segmentation with Kubernetes NetworkPolicies

### Objective

Understand how Kubernetes `NetworkPolicy` resources (backed by GKE Dataplane V2) complement Istio's
L7 enforcement with L3/L4 restrictions, creating a defence-in-depth posture.

The App_GKE module creates these policies when `enable_network_segmentation = true`.

### Step 8.1 — Review the Generated NetworkPolicies

```bash
kubectl get networkpolicies -n "${APP_NAMESPACE}"
kubectl describe networkpolicy "${APP_NAMESPACE}-namespace-isolation" -n "${APP_NAMESPACE}"
```

The policy enforces:

| Direction | Rule | Purpose |
|---|---|---|
| Ingress | Same-namespace pods | Intra-service communication |
| Ingress | `35.191.0.0/16`, `130.211.0.0/22` | GFE health checks from load balancer |
| Ingress | `35.235.240.0/20` | GKE control plane health probes |
| Egress | Port 53 UDP/TCP | DNS resolution |
| Egress | `199.36.153.4/30`, `199.36.153.8/30` | GCP APIs via Private Google Access |
| Egress | Same-namespace pods | Sidecar and service-to-service mesh traffic |

### Step 8.2 — Test Policy Enforcement

```bash
# This should be BLOCKED (cross-namespace, no matching ingress rule)
kubectl run blocked-test \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n default \
  -- curl -v --max-time 5 http://sample.sample-app.svc.cluster.local:8080
# Expected: connection timeout

# This should SUCCEED (same-namespace)
kubectl run allowed-test \
  --image=curlimages/curl:latest \
  --restart=Never \
  --rm -it \
  -n sample-app \
  -- curl -s http://sample:8080
```

### Step 8.3 — Add a Cross-Namespace Allow Rule

If you have a legitimate service in another namespace that needs access:

```yaml
# allow-from-monitoring.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: sample-app
spec:
  podSelector:
    matchLabels:
      app: sample
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
      podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 15090   # Envoy Prometheus scrape port
```

```bash
kubectl apply -f allow-from-monitoring.yaml
```

### Step 8.4 — Verify with GKE Dataplane V2 Policy Logging

GKE Dataplane V2 can log NetworkPolicy decisions to Cloud Logging:

**gcloud (enable policy logging):**
```bash
gcloud container clusters update "${CLUSTER_NAME}" \
  --enable-network-policy-logging \
  --region "${REGION}" \
  --project "${PROJECT_ID}"
```

**Query logs:**
```bash
gcloud logging read \
  "resource.type=k8s_node AND jsonPayload.\"@type\"=\"type.googleapis.com/google.cloud.networkpolicy.v1.NetworkPolicyEvent\"" \
  --project="${PROJECT_ID}" \
  --limit=20 \
  --format=json \
  | jq '.[] | {pod: .jsonPayload.reporter, disposition: .jsonPayload.disposition, dest: .jsonPayload.dest}'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT_ID}\"],
    \"filter\": \"resource.type=k8s_node jsonPayload.@type=type.googleapis.com/google.cloud.networkpolicy.v1.NetworkPolicyEvent\",
    \"pageSize\": 10
  }" | jq '.entries[] | {disposition: .jsonPayload.disposition}'
```

---

## Exercise 9 — Cloud Armor WAF on the GKE Gateway

### Objective

Enable Cloud Armor Web Application Firewall on the GKE Gateway backend, observe OWASP Top 10
rule enforcement, and test rate limiting.

The App_GKE module creates an inline Cloud Armor security policy when `enable_cloud_armor = true`
and attaches it to the Gateway via `GCPBackendPolicy`.

### Step 9.1 — Enable Cloud Armor via RAD UI Update

Return to the RAD UI, navigate to your `App_GKE` deployment, update the following variables, and click **Update**:

| Variable | Value |
|---|---|
| `enable_cloud_armor` | `true` |
| `admin_ip_ranges` | `["YOUR_CIDR/32"]` (bypass WAF for testing) |

This creates a policy with:
- OWASP Top 10 preconfigured rules (SQLi, XSS, LFI, RCE)
- Adaptive Protection (AI-based DDoS)
- Rate limiting: 500 requests/minute per IP, 5-minute ban

### Step 9.2 — Verify the Policy Attachment

**gcloud:**
```bash
gcloud compute security-policies list --project="${PROJECT_ID}"

gcloud compute security-policies describe "sample-waf-policy" \
  --project="${PROJECT_ID}" \
  --format="table(rules[].priority,rules[].action,rules[].description)"
```

**REST API:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT_ID}/global/securityPolicies/sample-waf-policy" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.rules[] | {priority, action, description}'
```

### Step 9.3 — Test SQL Injection Blocking

```bash
# This should return HTTP 403 (rule priority 1000)
curl -v "https://app.example.com/?id=1' OR '1'='1"

# This should return HTTP 403 (XSS — rule priority 1001)
curl -v "https://app.example.com/?q=<script>alert(1)</script>"

# Legitimate request — should succeed
curl -v "https://app.example.com/"
```

### Step 9.4 — Monitor Cloud Armor Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=http_load_balancer AND jsonPayload.enforcedSecurityPolicy.outcome=DENY" \
  --project="${PROJECT_ID}" \
  --limit=20 \
  --format=json \
  | jq '.[] | {
    timestamp: .timestamp,
    ip: .httpRequest.remoteIp,
    url: .httpRequest.requestUrl,
    rule: .jsonPayload.enforcedSecurityPolicy.name
  }'
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT_ID}\"],
    \"filter\": \"resource.type=http_load_balancer jsonPayload.enforcedSecurityPolicy.outcome=DENY\",
    \"pageSize\": 10
  }" | jq '.entries[].jsonPayload.enforcedSecurityPolicy'
```

### Step 9.5 — Test Rate Limiting

```bash
# Send 600 rapid requests (threshold is 500/minute)
kubectl run rate-test \
  --image=fortio/fortio:latest \
  --restart=Never \
  --rm -it \
  -n "${APP_NAMESPACE}" \
  -- load -c 10 -qps 100 -t 10s https://app.example.com

# Check for 429 responses — IPs exceeding the limit are banned for 5 minutes
```

### Step 9.6 — Adaptive Protection Events

**gcloud:**
```bash
gcloud compute security-policies get-rule 0 \
  --security-policy="sample-waf-policy" \
  --project="${PROJECT_ID}"
```

**REST API — list Adaptive Protection events:**
```bash
curl -s \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT_ID}/global/securityPolicies/sample-waf-policy" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.adaptiveProtectionConfig'
```

---

## Exercise 10 — Multi-Cluster Service Mesh

### Objective

Register a second GKE cluster to the Fleet, enable Cloud Service Mesh across both clusters, and
observe automatic cross-cluster service discovery — traffic from Cluster A can reach services in
Cluster B without any extra configuration.

### Prerequisites

A second GKE cluster, or re-apply `Services_GCP` with a second cluster configuration block.

### Step 10.1 — Register the Second Cluster

**gcloud:**
```bash
gcloud container clusters get-credentials "${CLUSTER_NAME}-2" \
  --region "${REGION}" \
  --project "${PROJECT_ID}"

gcloud container fleet memberships register "${CLUSTER_NAME}-2" \
  --gke-cluster="${REGION}/${CLUSTER_NAME}-2" \
  --enable-workload-identity \
  --project="${PROJECT_ID}"
```

**REST API — create Fleet membership:**
```bash
curl -s -X POST \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/memberships?membershipId=${CLUSTER_NAME}-2" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"endpoint\": {
      \"gkeCluster\": {
        \"resourceLink\": \"//container.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/clusters/${CLUSTER_NAME}-2\"
      }
    },
    \"authority\": {
      \"issuer\": \"https://container.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/clusters/${CLUSTER_NAME}-2\"
    }
  }"
```

### Step 10.2 — Enable CSM on the Second Cluster

Via the RAD UI, update the `Services_GCP` deployment to include the second cluster in the Fleet Hub CSM feature. The module's `for_each` over `cluster_network_config` creates a Fleet Hub feature membership for every cluster automatically when `configure_cloud_service_mesh = true`.

Or apply the mesh feature membership directly:

**gcloud:**
```bash
gcloud container fleet mesh update \
  --membership="${CLUSTER_NAME}-2" \
  --management=automatic \
  --project="${PROJECT_ID}"
```

**REST API:**
```bash
curl -s -X PATCH \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/features/servicemesh" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"membershipSpecs\": {
      \"projects/${PROJECT_ID}/locations/global/memberships/${CLUSTER_NAME}-2\": {
        \"mesh\": {\"management\": \"MANAGEMENT_AUTOMATIC\"}
      }
    }
  }"
```

### Step 10.3 — Verify Cross-Cluster Service Discovery

```bash
# On Cluster 1 — confirm service endpoint from Cluster 2 is visible
kubectl exec "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -- \
  pilot-agent request GET clusters | grep "${CLUSTER_NAME}-2"

# Inspect the ServiceEntry created by Fleet multi-cluster
kubectl get serviceentries -A
```

### Step 10.4 — Multi-Cluster Ingress

When `configure_cloud_service_mesh = true` and multiple clusters are registered, the
`Services_GCP` module creates the `multiclusteringress` Fleet feature, designating one cluster
as the config cluster:

**gcloud:**
```bash
gcloud container fleet ingress describe --project="${PROJECT_ID}"
```

**REST API:**
```bash
curl -s \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/features/multiclusteringress" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.spec.multiclusteringress'
```

---

## 15. Cleanup

When you are finished, return to the RAD UI and undeploy in the following order to avoid ongoing charges:

1. Navigate to the `App_GKE` deployment and click **Undeploy** (or **Delete**).
2. Once App_GKE is fully removed, navigate to the `Services_GCP` deployment and click **Undeploy** (or **Delete**).

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Remove Fleet memberships
gcloud container fleet memberships delete "${CLUSTER_NAME}" \
  --project="${PROJECT_ID}" --quiet
gcloud container fleet memberships delete "${CLUSTER_NAME}-2" \
  --project="${PROJECT_ID}" --quiet

# Delete GKE clusters
gcloud container clusters delete "${CLUSTER_NAME}" \
  --region "${REGION}" --project "${PROJECT_ID}" --quiet

# Delete Cloud Armor policy
gcloud compute security-policies delete "sample-waf-policy" \
  --project="${PROJECT_ID}" --quiet

# Delete Certificate Manager resources
gcloud certificate-manager certificates list --project="${PROJECT_ID}"
gcloud certificate-manager maps list --project="${PROJECT_ID}"
```

**REST API — delete Fleet membership:**
```bash
curl -s -X DELETE \
  "https://gkehub.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/memberships/${CLUSTER_NAME}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

**REST API — delete GKE cluster:**
```bash
curl -s -X DELETE \
  "https://container.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/clusters/${CLUSTER_NAME}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## 16. Reference

### Key Module Variables

#### Services_GCP

| Variable | Type | Default | Description |
|---|---|---|---|
| `configure_cloud_service_mesh` | bool | `false` | Enables Fleet Hub Cloud Service Mesh feature with `MANAGEMENT_AUTOMATIC` |
| `create_google_kubernetes_engine` | bool | `false` | Creates a GKE Autopilot cluster |

#### App_GKE

| Variable | Type | Default | Description |
|---|---|---|---|
| `configure_service_mesh` | bool | `false` | Labels the app namespace `istio.io/rev=asm-managed` to enable sidecar injection |
| `enable_network_segmentation` | bool | `false` | Creates Kubernetes NetworkPolicies restricting pod ingress/egress |
| `enable_cloud_armor` | bool | `false` | Creates a Cloud Armor WAF policy and attaches it via GCPBackendPolicy |
| `enable_iap` | bool | `false` | Attaches Identity-Aware Proxy to the Gateway backend |
| `enable_custom_domain` | bool | `false` | Deploys the GKE Gateway API stack (Certificate Manager, Gateway, HTTPRoute) |
| `application_domains` | list(string) | `[]` | Domains for Certificate Manager and HTTPRoute hostnames |
| `service_type` | string | `LoadBalancer` | Use `ClusterIP` when Gateway API handles external exposure |

### Istio Resource Reference

| Resource | API Group | Purpose |
|---|---|---|
| `VirtualService` | `networking.istio.io/v1beta1` | Traffic routing rules (weight, headers, fault injection) |
| `DestinationRule` | `networking.istio.io/v1beta1` | Subsets, load balancing, circuit breaking |
| `PeerAuthentication` | `security.istio.io/v1beta1` | mTLS mode per namespace or workload |
| `AuthorizationPolicy` | `security.istio.io/v1beta1` | L7 allow/deny based on identity, path, method |
| `RequestAuthentication` | `security.istio.io/v1beta1` | JWT issuer validation |

### Useful Commands Reference

```bash
# Mesh status
gcloud container fleet mesh describe --project="${PROJECT_ID}"

# Fleet membership list
gcloud container fleet memberships list --project="${PROJECT_ID}"

# Proxy status for all sidecars
istioctl proxy-status

# Analyse mesh configuration for issues
istioctl analyze -n "${APP_NAMESPACE}"

# Check effective policy for a pod
istioctl x authz check "${POD}" -n "${APP_NAMESPACE}"

# View Envoy config for a pod
istioctl proxy-config all "${POD}" -n "${APP_NAMESPACE}"

# Tail Envoy access logs
kubectl logs "${POD}" -n "${APP_NAMESPACE}" -c istio-proxy -f

# Generate load for metric/trace generation
kubectl run fortio --image=fortio/fortio --restart=Never --rm -it \
  -n "${APP_NAMESPACE}" \
  -- load -c 5 -qps 20 -t 120s http://sample:8080
```

### Further Reading

- [Cloud Service Mesh documentation](https://cloud.google.com/service-mesh/docs)
- [Istio traffic management concepts](https://istio.io/latest/docs/concepts/traffic-management/)
- [Istio security concepts (mTLS, AuthorizationPolicy)](https://istio.io/latest/docs/concepts/security/)
- [GKE Tutorial: Secure services with Istio](https://cloud.google.com/kubernetes-engine/docs/tutorials/secure-services-istio)
- [Fleet-based service mesh setup](https://cloud.google.com/service-mesh/docs/configure-managed-anthos-service-mesh)
- [GKE Gateway API overview](https://cloud.google.com/kubernetes-engine/docs/concepts/gateway-api)
- [Cloud Armor WAF with GKE](https://cloud.google.com/armor/docs/configure-security-policies)
