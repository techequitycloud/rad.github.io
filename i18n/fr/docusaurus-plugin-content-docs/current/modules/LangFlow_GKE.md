---
title: "LangFlow sur GKE Autopilot"
description: "Référence de configuration pour déployer LangFlow sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LangFlow_GKE.md @ 3055034 sha256:c0cb049ad223 -->

# LangFlow sur GKE Autopilot {#langflow-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_GKE.png" alt="LangFlow sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow est un outil visuel open source et low-code de création d'agents et de
workflows d'IA, basé sur LangChain — vous assemblez des chaînes de modèles de
langage, des pipelines RAG et des agents en glissant et en reliant des composants
sur un canevas, puis vous les exposez sous forme d'API. Ce module déploie LangFlow
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par LangFlow et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LangFlow s'exécute comme une charge de travail web Python unique (FastAPI + React).
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python sur le port **7860**, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — LangFlow conserve l'ensemble des flux, composants et identifiants dans Postgres |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié est provisionné par défaut ; l'état applicatif de LangFlow réside lui-même dans PostgreSQL |
| Cache et file d'attente | Redis (facultatif) | Non requis par LangFlow ; câblé uniquement par souci de compatibilité future |
| Secrets | Secret Manager | `LANGFLOW_SECRET_KEY` et `LANGFLOW_SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée (`database_type = "POSTGRES_15"`) ; choisir un autre
  moteur empêche le démarrage.
- **`LANGFLOW_SECRET_KEY` est généré automatiquement** et stocké dans Secret
  Manager. Il chiffre chaque identifiant stocké intégré dans un flux. Il ne doit
  jamais faire l'objet d'une rotation après le premier démarrage — sa rotation casse
  définitivement tous les identifiants stockés, qu'il faut alors ressaisir dans
  chaque flux.
- **Le compte administrateur est provisionné à partir d'un mot de passe généré.**
  `LANGFLOW_AUTO_LOGIN = "false"` active l'authentification ; LangFlow crée
  l'administrateur initial (`admin` par défaut) à l'aide du secret
  `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez-le dans Secret Manager pour vous
  connecter.
- **La base de données se connecte via le sidecar Cloud SQL Auth Proxy** sur
  `127.0.0.1` ; le point d'entrée compose `LANGFLOW_DATABASE_URL` via TCP avec
  `sslmode=disable` (le proxy termine le TLS).
- **L'affinité de session est `ClientIP` par défaut.** LangFlow conserve un état de
  session et d'éditeur de flux en mémoire de processus ; le routage persistant
  maintient un client sur le même pod.
- **Un seul pod par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  GKE ne descend pas à zéro ; l'état en mémoire de processus de LangFlow fait d'un
  réplica unique la valeur par défaut sûre.
- **L'état applicatif réside dans PostgreSQL ; NFS est désactivé par défaut.** Un
  bucket Cloud Storage `data` est provisionné par défaut (`storage_buckets`), mais
  LangFlow conserve lui-même les flux, composants et identifiants dans la base de
  données.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LangFlow {#a-gke-autopilot--the-langflow-workload}

Les pods LangFlow sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  LangFlow pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LangFlow stocke toutes les données applicatives (flux, composants, identifiants,
historique d'exécution, utilisateurs) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent de façon privée via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1` ; aucune IP publique n'est exposée. Au premier déploiement,
un job d'initialisation crée la base de données applicative, le rôle et les
droits.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Redis (facultatif — non utilisé par LangFlow) {#c-redis-optional--not-used-by-langflow}

Redis est **désactivé par défaut** et LangFlow n'en a pas besoin ; les entrées
`enable_redis` sont câblées uniquement par souci de compatibilité future. Laissez
`enable_redis = false`, sauf si une fonctionnalité future le requiert.

- **CLI (uniquement s'il est activé) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`LANGFLOW_SECRET_KEY` (chiffre tous les identifiants stockés) et
`LANGFLOW_SUPERUSER_PASSWORD` (le mot de passe de connexion de l'administrateur
initial). Ils sont fournis aux pods via l'intégration Secret Store CSI. Le mot de
passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
et Cloud SQL à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatives sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LangFlow {#3-langflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` à l'aide de
  `postgres:15-alpine`. Il attend PostgreSQL, puis crée de manière idempotente le
  rôle applicatif et la base de données, définit le propriétaire et accorde les
  privilèges sur la base et sur le schéma `public`, puis signale au sidecar Cloud
  SQL Auth Proxy de s'arrêter (`POST /quitquitquit`) afin que le pod de la tâche se
  termine proprement. Il peut être relancé sans risque.
- **Migrations de schéma au démarrage.** LangFlow exécute ses **migrations Alembic à
  chaque démarrage du conteneur** ; les tables sont donc créées et mises à niveau par
  l'application elle-même — la tâche `db-init` ne gère que le rôle, la base et les
  droits. Prévoyez un délai supplémentaire au premier démarrage.
- **`LANGFLOW_SECRET_KEY` est immuable après le premier démarrage.** Il est généré
  une seule fois et écrit dans Secret Manager. Le modifier casse définitivement
  chaque identifiant stocké intégré dans un flux ; ceux-ci ne peuvent plus être
  déchiffrés. Ne procédez à une rotation que pendant une fenêtre de maintenance
  planifiée, avec un plan de ressaisie des identifiants.
- **Compte administrateur initial.** Avec `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow
  crée le superutilisateur (`admin` par défaut, défini via `langflow_username`) à
  l'aide du secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez le mot de passe et
  connectez-vous :
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **L'URL de la base de données est composée à l'exécution.** Le point d'entrée
  construit `LANGFLOW_DATABASE_URL` à partir des variables `DB_*` injectées, via TCP.
  Sur GKE, `DB_HOST = 127.0.0.1` (le sidecar Auth Proxy) ; `sslmode=disable` est
  donc utilisé — ne définissez pas le DSN manuellement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent **`/health`**,
  le point de terminaison public de vivacité de LangFlow, qui renvoie `200` dès que le
  serveur est opérationnel. Au premier démarrage, prévoyez le temps des migrations
  Alembic avant que le pod ne devienne Ready.
- **Affinité de session.** `session_affinity = ClientIP` maintient chaque client sur
  le même pod — important, car LangFlow conserve l'état de l'éditeur de flux en
  mémoire de processus.
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LangFlow ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langflow` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `LangFlow` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image LangFlow ; épingle l'image de base `1.10.2` lorsque la valeur est `latest`. Épinglez explicitement en production. |
| `langflow_username` | `admin` | Nom d'utilisateur du superutilisateur initial (administrateur) ; le mot de passe est généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | LangFlow est construit à partir de l'image encapsulée via Cloud Build. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne descend pas à zéro. |
| `max_instance_count` | `1` | Gardez `1` — LangFlow conserve un état en mémoire de processus. |
| `enable_vertical_pod_autoscaling` | `false` | VPA d'Autopilot pour un dimensionnement ajusté. |
| `container_port` | `7860` | LangFlow écoute sur le port 7860. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Limites et demandes de CPU/mémoire par pod. Relevé depuis `1Gi` après un bug confirmé d'OOMKilled au démarrage — ne descendez pas en dessous de `2Gi`. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base LangFlow dans Artifact Registry avant le build personnalisé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés par-dessus les valeurs par défaut de LangFlow. Ne définissez pas ici `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` ni `LANGFLOW_DATABASE_URL`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple, clés d'API de fournisseurs de LLM). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` (découvert automatiquement) | Cluster Autopilot cible (provenant de Services_GCP). |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes de la charge de travail. |
| `workload_type` | `null` | Se résout en `Deployment` (par défaut) ; `StatefulSet` lorsqu'un PVC est activé. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `ClientIP` | Routage persistant pour l'état de l'éditeur de flux en mémoire de processus. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente entre SIGTERM et SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC. Inutile — LangFlow stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | _(définies)_ | Dimensionnement et montage du PVC par pod (uniquement s'il est activé). |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | _(définies)_ | Comportement du StatefulSet (uniquement s'il est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Applique un ResourceQuota à l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(définies)_ | Quota de CPU pour l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(définies)_ | **Doivent utiliser des suffixes d'unité binaires** (`4Gi`, `8192Mi`) — les entiers nus sont interprétés comme des octets. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | À activer pour protéger la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors des interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | _(définies)_ | Répartit les pods entre zones/nœuds. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage. Prévoyez le temps des migrations Alembic du premier démarrage. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (aucun n'est requis par LangFlow). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de LangFlow. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; LangFlow conserve son état dans PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (lorsque NFS est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée un bucket `data` dédié. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis (facultatif) {#group-15--redis-cache-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par LangFlow ; câblé uniquement par souci de compatibilité future. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Paramètres de connexion Redis (uniquement s'il est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — LangFlow requiert PostgreSQL 15. |
| `application_database_name` | `langflowdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langflowuser` | Utilisateur de la base de données applicative. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions Postgres facultatives. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données sans interruption de service. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques Cloud SQL (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** activer IAP exige une authentification par identité Google pour
> **toutes** les requêtes entrantes, y compris les appels à l'API programmatique de
> LangFlow.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant LangFlow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à disposer d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à LangFlow. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'importation (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), complété d'un garde-fou `validation.tf` qui vérifie les valeurs *et leurs combinaisons* au moment du plan — `min_instance_count > max_instance_count`, Redis activé sans source d'hôte, IAP sans identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Sa rotation casse définitivement chaque identifiant stocké intégré dans un flux — ceux-ci ne peuvent plus être déchiffrés et doivent être ressaisis. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base et l'utilisateur et détruit tous les flux et identifiants. |
| `database_type` | `POSTGRES_15` | Critique | LangFlow requiert PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans source de sauvegarde valide fait échouer la tâche d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `LANGFLOW_SUPERUSER_PASSWORD` (généré automatiquement) | Le récupérer dans Secret Manager | Élevé | C'est l'identifiant de connexion de l'administrateur ; le perdre signifie qu'il est impossible de se connecter tant qu'il n'est pas réinitialisé. |
| `max_instance_count` | `1` | Élevé | LangFlow conserve un état de session et de flux en mémoire de processus ; dépasser 1 répartit l'état entre les pods et provoque un comportement incohérent. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes sont acheminées vers des pods différents, ce qui perturbe l'éditeur de flux en mémoire de processus. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le garde-fou de validation rejette les valeurs supérieures à `max_instance_count`. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; le désactiver avec une vraie base de données casse toutes les connexions. |
| `container_port` | `7860` | Élevé | LangFlow écoute sur 7860 ; un port différent fait échouer toutes les sondes de santé. |
| `enable_iap` | uniquement lorsque l'authentification de l'API n'est pas nécessaire depuis l'extérieur | Élevé | IAP place la connexion Google devant l'ensemble du service, y compris son API programmatique. |
| `container_resources.memory_limit` | ≥ `2Gi` | Élevé | OOMKilled au démarrage confirmé en dessous de 2 GiB — LangFlow charge tous les composants et crée les projets de démarrage avant que le serveur n'écoute ; `1Gi` a tué le pod au moment même où il démarrait. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et construction des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à LangFlow
partagée avec la variante Cloud Run est décrite dans
**[LangFlow_Common](LangFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LangFlow sur GKE Autopilot](../labs/LangFlow_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LangFlow sur Google Cloud Run](LangFlow_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LangFlow Common — Configuration applicative partagée](LangFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
