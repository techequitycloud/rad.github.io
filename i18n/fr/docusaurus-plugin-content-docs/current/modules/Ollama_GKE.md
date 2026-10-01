---
title: "Ollama sur GKE Autopilot"
description: "Référence de configuration pour déployer Ollama sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ollama_GKE.md @ 3055034 sha256:bce0eece055a -->

# Ollama sur GKE Autopilot {#ollama-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ollama_GKE.png" alt="Ollama sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ollama est un serveur d'inférence de LLM open source qui sert de grands modèles de langage — Llama,
Mistral, Gemma, Phi et d'autres — via une API REST. Ce module déploie Ollama sur **GKE
Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Ollama et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toute application GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez
le [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Ollama s'exécute comme un serveur d'inférence conteneurisé. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Ollama, 8 vCPU / 16 GiB par défaut (modèles 7B), autoscaling horizontal |
| Stockage des modèles | Cloud Storage + GCS Fuse CSI | Bucket des modèles monté sur `/mnt/gcs` ; les poids persistent à travers les redémarrages de pods |
| Secrets | Secret Manager | Aucun secret géré par l'application — Ollama ne requiert aucun identifiant |
| Entrée | Kubernetes ClusterIP | Interne uniquement par défaut ; n'utilisez `LoadBalancer` que lorsqu'un accès externe est nécessaire |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Ollama est sans état au-delà de son cache de modèles adossé à GCS. Ni
  Cloud SQL ni Redis ne sont provisionnés.
- **GCS Fuse est la couche de persistance.** Les poids des modèles sont stockés dans un bucket GCS dédié
  et montés dans le pod sur `/mnt/gcs`. Au redémarrage, le pod charge les modèles depuis GCS au lieu
  de les retélécharger.
- **ClusterIP par défaut.** Ollama est conçu comme un point de terminaison d'inférence partagé au sein du cluster. Tout
  pod du même cluster l'atteint à l'adresse
  `http://<service-name>.<namespace>.svc.cluster.local:11434`. Définir `service_type =
  "LoadBalancer"` expose publiquement l'API non authentifiée — ne le faites pas sans IAP ou
  Cloud Armor.
- **Téléchargement automatique du modèle.** Lorsque `default_model` est défini et qu'aucun `initialization_jobs`
  personnalisé n'est fourni, un Job Kubernetes nommé `model-pull` est créé lors du premier déploiement et stocke
  le modèle dans le bucket GCS.
- **Trois variables d'environnement sont toujours injectées :** `OLLAMA_MODELS`, `OLLAMA_HOST` et
  `OLLAMA_KEEP_ALIVE`. Ne remplacez pas `OLLAMA_MODELS` ni `OLLAMA_HOST` dans
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ollama {#a-gke-autopilot--the-ollama-workload}

Les pods Ollama sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. L'autoscaling horizontal des pods fait varier le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Ollama pour voir les pods et
  les événements. Kubernetes Engine → Services & Ingress affiche le ClusterIP (ou l'IP externe lorsque
  `service_type = "LoadBalancer"`).
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Verify Ollama is responding inside the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://localhost:11434/api/tags | jq '.models[].name'
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud Storage — persistance des poids des modèles {#b-cloud-storage--model-weight-persistence}

Les poids des modèles Ollama sont stockés dans un bucket GCS dédié (nommé
`<resource_prefix>-models`) et montés dans chaque pod via le **pilote CSI GCS Fuse** sur
`/mnt/gcs`. La variable d'environnement `OLLAMA_MODELS` vaut
`/mnt/gcs/ollama/models`, de sorte qu'Ollama y découvre et y met en cache les modèles.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket des modèles pour parcourir les fichiers
  de modèles téléchargés.
- **CLI :**
  ```bash
  # Bucket name is in the Outputs (models_bucket)
  gcloud storage ls gs://<models-bucket>/ollama/models/
  gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
  # Confirm the GCS volume is mounted inside a running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/gcs/ollama/models/
  ```

Le nom du bucket est indiqué dans la sortie `models_bucket`. Consultez
[App_GKE](App_GKE.md) pour GCS Fuse, les options CMEK et les règles de cycle de vie des buckets.

### C. Secret Manager {#c-secret-manager}

Ollama ne requiert aucun identifiant géré par l'application — il n'y a ni mot de passe administrateur ni
mot de passe de base de données. Secret Manager reste disponible pour tout secret personnalisé que vous injectez via
`secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le service Ollama n'est exposé qu'au sein du cluster (ClusterIP). Lorsque
`service_type = "LoadBalancer"` est défini, une IP Cloud Load Balancing externe est provisionnée.
Un domaine personnalisé, le WAF Cloud Armor et IAP peuvent être ajoutés pour les scénarios d'accès externe.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services → Load balancing ;
  VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Internal cluster URL (printed as ollama_cluster_url output):
  echo "http://<service-name>.$NAMESPACE.svc.cluster.local:11434"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE à Cloud Monitoring. Des tests
de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ollama {#3-ollama-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Ollama n'a pas de base de données. Il n'y a ni job `db-init`
  ni instance Cloud SQL.
- **Téléchargement du modèle au premier déploiement.** Lorsque `default_model` est défini et que `initialization_jobs` est
  vide, un Job Kubernetes nommé `model-pull` s'exécute une fois. Il démarre un serveur Ollama local en
  arrière-plan, télécharge le modèle indiqué, le stocke dans le bucket GCS, puis s'arrête. Le
  job monte le volume GCS `ollama-models` afin que les poids persistent. Le délai d'expiration est contrôlé
  par `model_pull_timeout_seconds` (3600 secondes par défaut) ; les grands modèles (7B et plus) peuvent prendre 20–30
  minutes lors du premier téléchargement.
- **Chargement du modèle au démarrage à froid.** À chaque démarrage de pod, Ollama charge les poids du modèle depuis GCS Fuse.
  Cela prend généralement 30–120 secondes selon la taille du modèle. La sonde de démarrage utilise un délai
  initial de 30 s avec 20 tentatives en échec (environ 5 minutes) pour en tenir compte.
  `OLLAMA_KEEP_ALIVE` vaut `"24h"` afin que les modèles chargés restent en mémoire entre les
  requêtes. Remplacez-la via `environment_variables`.
- **Variables injectées automatiquement.** `OLLAMA_MODELS` (`/mnt/gcs/ollama/models`),
  `OLLAMA_HOST` (`0.0.0.0:11434`) et `OLLAMA_KEEP_ALIVE` (`24h`) sont injectées
  automatiquement. Ne remplacez pas les deux premières ; la troisième peut être remplacée.
- **Point de terminaison de santé.** Le chemin racine d'Ollama (`/`) répond `"Ollama is running"` une fois
  le serveur prêt. Les sondes de disponibilité et de vivacité ciblent ce chemin.
- **Réglages supplémentaires.** Utilisez `environment_variables` pour définir `OLLAMA_NUM_PARALLEL` (par défaut
  `1`, à augmenter pour des appelants simultanés), `OLLAMA_ORIGINS` (restreindre le CORS) et d'autres variables
  d'environnement Ollama.
- **Gestion manuelle des modèles.** Téléchargez des modèles supplémentaires ou supprimez-en directement :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama pull mistral
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama list
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama rm mistral
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Ollama ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ollama` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Ollama LLM Server` | Nom convivial affiché dans la console. |
| `application_description` | _(définie)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de l'image Ollama ; épinglez une version précise (par exemple `0.3.12`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner le stockage et l'IAM sans déployer la charge de travail. |
| `container_resources` | `{ cpu_limit="8", memory_limit="16Gi", cpu_request="4", mem_request="8Gi" }` | CPU et mémoire du conteneur. Modèles 3B : `cpu_limit="4"`, `memory_limit="8Gi"`. Modèles 7B : `cpu_limit="8"`, `memory_limit="16Gi"`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter la latence de chargement du modèle au démarrage à froid à chaque requête. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). Chaque pod charge le modèle en mémoire indépendamment — dimensionnez en conséquence. |
| `timeout_seconds` | `300` | Délai de grâce d'arrêt du pod. Augmentez-le pour les requêtes d'inférence longues. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend avant d'arrêter de force le pod après SIGTERM. |
| `service_type` | `ClusterIP` | Type de Service Kubernetes. `ClusterIP` garde l'API interne. `LoadBalancer` l'expose publiquement sans authentification. |
| `session_affinity` | `None` | Affinité de session du Service Kubernetes. `ClientIP` améliore la continuité du contexte sur plusieurs tours mais déséquilibre la répartition de la charge. |
| `enable_image_mirroring` | `true` | Duplique `ollama/ollama` dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `container_image_source` | `prebuilt` | `"prebuilt"` utilise directement `ollama/ollama` ; `"custom"` déclenche un Cloud Build. |
| `container_image` | `ollama/ollama` | URI complète de l'image lorsque `container_image_source = "prebuilt"`. |
| `enable_cloudsql_volume` | `false` | Inutile pour Ollama (pas de base de données). |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Recommandé lorsque `service_type = "LoadBalancer"`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé. |
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge. |
| `enable_custom_domain` | `true` | Configure un domaine personnalisé et un certificat géré. |
| `reserve_static_ip` | `true` | Réserve une adresse IP externe stable. |
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `OLLAMA_MODELS`, `OLLAMA_HOST` et `OLLAMA_KEEP_ALIVE` sont injectées automatiquement. Utilisez ici `OLLAMA_NUM_PARALLEL`, `OLLAMA_ORIGINS`, etc. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

Sans objet pour Ollama — les poids des modèles sont stockés durablement dans GCS. Ces variables ne sont
présentes que pour la compatibilité de l'interface. Consultez [App_GKE](App_GKE.md).

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

Également dans ce groupe : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`,
`quota_max_pvcs`. Lorsque `enable_resource_quota = true`, les valeurs de mémoire **doivent utiliser des suffixes
d'unités binaires** (`4Gi`, `8192Mi`) — les entiers nus sont interprétés comme des octets par Kubernetes et bloquent
toute planification de pods.

### Groupe 9 — Jobs et tâches planifiées {#group-9--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide et définissez `default_model` pour utiliser le job model-pull généré automatiquement. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents pour la gestion des modèles ou d'autres tâches. |
| `additional_services` | `[]` | Conteneurs supplémentaires déployés comme Deployments Kubernetes distincts (par exemple une base de données vectorielle Qdrant aux côtés d'Ollama). |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones pour une meilleure disponibilité. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS de `storage_buckets`. Le bucket des modèles est toujours créé, quoi qu'il arrive. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket des modèles. |
| `enable_nfs` | `false` | Non requis pour Ollama (utilise GCS Fuse). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires. Le bucket `ollama-models` sur `/mnt/gcs` est toujours ajouté automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Sans objet pour Ollama. `database_type` est fixé à `"NONE"` — aucune instance Cloud SQL n'est
provisionnée. Ces variables ne sont présentes que pour la compatibilité de l'interface.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type="HTTP", path="/", initial_delay_seconds=30, failure_threshold=20 }` | Le seuil de 20 tentatives laisse environ 5 minutes pour charger le modèle depuis GCS. |
| `liveness_probe` | `{ type="HTTP", path="/", initial_delay_seconds=60, failure_threshold=3 }` | Le délai de 60 s évite des redémarrages intempestifs pendant le chargement du modèle. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, à activer explicitement. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur métriques. |

### Groupe 15 — Redis {#group-15--redis}

Sans objet pour Ollama. `enable_redis` est codé en dur à `false`, quelle que soit la valeur de ce
paramètre.

### Groupe 16 — Backend GKE et cluster {#group-16--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la découverte automatique depuis Services_GCP. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement à partir du nom de l'application s'il est vide. |
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Assurez-vous que `max_instance_count ≥ 2` lorsque vous utilisez un PDB, afin que les mises à niveau progressives puissent avancer. |
| `deployment_timeout` | `600` | Nombre de secondes pendant lesquelles Terraform attend le déploiement progressif du Deployment. Passez à `1200` pour les grands modèles (13B et plus). |

### Groupe 17 — StatefulSet {#group-17--statefulset}

Ne s'applique que lorsque `workload_type = "StatefulSet"`. La charge de travail Deployment par défaut avec persistance
GCS Fuse est recommandée ; ces paramètres ne sont pas nécessaires dans le cas courant.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC pour le stockage local des modèles. Non requis lorsque GCS Fuse est utilisé. |
| `stateful_pvc_size` | `50Gi` | Taille du PVC (par exemple `"100Gi"` pour plusieurs grands modèles). |
| `stateful_pvc_mount_path` | `/mnt/data` | Chemin du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes. |

### Groupe 19 — Configuration des modèles Ollama {#group-19--ollama-model-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `default_model` | `""` | Modèle à télécharger lors du premier déploiement (par exemple `"llama3.2:3b"`, `"mistral"`, `"phi3:mini"`). Laissez vide pour ignorer le job de téléchargement automatique. |
| `model_pull_timeout_seconds` | `3600` | Délai d'expiration du Job Kubernetes model-pull. Les grands modèles (7B et plus) peuvent prendre 20–30 minutes. Plage valide : 300–7200. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `ollama_cluster_url` | URL Kubernetes interne : `http://<service-name>.<namespace>.svc.cluster.local:11434`. Utilisez-la dans d'autres pods pour appeler l'API Ollama. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = "LoadBalancer"` et qu'une IP statique est réservée). |
| `api_url` | URL du service. |
| `models_bucket` | Nom du bucket GCS dans lequel les poids des modèles Ollama sont conservés. |
| `storage_buckets` | Tous les buckets Cloud Storage provisionnés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs d'initialisation (y compris `model-pull` lorsqu'il est déclenché). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que les charges de travail sont déployées. `false` lors du premier apply d'un nouveau cluster inline — relancez l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` | `ClusterIP` | Critique | `LoadBalancer` expose publiquement l'API Ollama non authentifiée sur le port 11434. Ollama n'a aucune authentification intégrée. |
| `container_resources.memory_limit` | `16Gi` (7B) / `8Gi` (3B) | Critique | Une mémoire insuffisante provoque un arrêt OOM en pleine inférence et fait redémarrer le pod en boucle. Allouez au moins 2× la taille des poids quantifiés du modèle. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8Gi`) | Critique | Les entiers nus (par exemple `"4"`) sont interprétés comme des octets par Kubernetes et bloquent toute planification de pods dans l'espace de noms. |
| `enable_iap` | `true` si `service_type = "LoadBalancer"` | Critique | Sans IAP ni restriction VPC, l'API Ollama est non authentifiée et accessible publiquement. |
| `container_resources.cpu_limit` | `8` (7B) / `4` (3B) | Élevé | Trop peu de CPU rend la génération de tokens extrêmement lente. Pour une inférence 7B en production, 6–8 cœurs sont nécessaires. |
| `min_instance_count` | `1` | Élevé | `0` active la mise à l'échelle à zéro mais provoque des démarrages à froid de 60–120 s pendant le rechargement du modèle depuis GCS. |
| `model_pull_timeout_seconds` | `3600` | Élevé | Un délai trop court fait échouer le job model-pull avant la fin du téléchargement pour les modèles de plus de 2 GB. |
| `deployment_timeout` | `600` | Élevé | Trop court pour un grand modèle (13B et plus) chargé depuis GCS au premier démarrage. Passez à `1200`. |
| `max_instance_count` | `3` | Élevé | Chaque pod charge indépendamment le modèle complet en mémoire. Trois réplicas 7B requièrent environ 48 GiB. |
| `default_model` | le modèle souhaité | Moyen | Laisser vide est sans danger pour le déploiement initial, mais l'API renvoie une erreur sur toutes les requêtes d'inférence tant qu'aucun modèle n'a été téléchargé manuellement. |
| `environment_variables.OLLAMA_NUM_PARALLEL` | `2`–`4` pour un usage partagé | Moyen | La valeur par défaut `1` sérialise toutes les requêtes. Augmentez-la pour les déploiements de cluster partagés avec des appelants simultanés. |
| `environment_variables.OLLAMA_KEEP_ALIVE` | `24h` (injectée automatiquement) | Moyen | La valeur par défaut propre à Ollama (`5m`) évince les modèles de la mémoire après une période d'inactivité, ce qui entraîne des délais de rechargement de 30–60 s. Le module injecte automatiquement `24h`. |
| `enable_pod_disruption_budget` | `true` | Moyen | Avec `pdb_min_available = 1` et un seul réplica, les mises à niveau progressives des nœuds se bloquent. Assurez-vous que `max_instance_count ≥ 2`. |
| `enable_resource_quota` | à activer pour les clusters partagés | Moyen | Sans ResourceQuota, un pod mal configuré peut consommer toutes les ressources du cluster. |
| options de montage de `gcs_volumes` | inclure `implicit-dirs` | Moyen | Sans `implicit-dirs`, les listages de répertoires GCS Fuse échouent et Ollama ne peut pas découvrir les modèles en cache. |
| `enable_image_mirroring` | `true` | Moyen | La désactivation entraîne des téléchargements depuis Docker Hub, soumis à des limites de débit. Conservez `true` en production. |

---

Pour le comportement du socle évoqué tout au long de cette page — Workload Identity, autoscaling, entrée
et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative partagée propre à Ollama
est décrite dans **[Ollama_Common](Ollama_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ollama sur GKE Autopilot](../labs/Ollama_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Ollama sur Google Cloud Run](Ollama_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ollama Common — Configuration applicative partagée](Ollama_Common.md) — la configuration partagée par les deux cibles de déploiement.
