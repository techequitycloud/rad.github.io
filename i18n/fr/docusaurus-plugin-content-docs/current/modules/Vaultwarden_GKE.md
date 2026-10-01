---
title: "Vaultwarden sur GKE Autopilot"
description: "Référence de configuration pour déployer Vaultwarden sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Vaultwarden_GKE.md @ 3055034 sha256:c96517106566 -->

# Vaultwarden sur GKE Autopilot {#vaultwarden-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vaultwarden_GKE.png" alt="Vaultwarden sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vaultwarden est un gestionnaire de mots de passe léger, auto-hébergé et compatible
avec Bitwarden, écrit en Rust. Ce module déploie Vaultwarden sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Vaultwarden et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Vaultwarden s'exécute sous forme de binaire Rust compilé dans un StatefulSet. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods du binaire Rust, 500m CPU / 512 Mi par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 (par défaut) ou MySQL 8.0 | Moteur configurable ; la tâche d'initialisation s'adapte automatiquement |
| Stockage par pod | PersistentVolumeClaim Kubernetes | 10 Gi sur `/data` pour les données du coffre-fort, les clés RSA et les pièces jointes |
| Stockage d'objets | Cloud Storage | Un bucket `vaultwarden-attachments` dédié |
| Secrets | Secret Manager | Mot de passe de la base de données ; Vaultwarden gère lui-même son jeton d'administration en interne |
| Entrée | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Un StatefulSet avec un PVC de 10 Gi est la valeur par défaut.** Les données du
  coffre-fort (`/data`) persistent lors des redémarrages et des mises à niveau des
  pods. Ne passez pas à un Deployment tant que `stateful_pvc_enabled =
  true`.
- **Les inscriptions sont fermées par défaut.** `signups_allowed = false` empêche
  la création anonyme de comptes. Activez-les uniquement pendant la configuration
  initiale de l'administrateur, puis désactivez-les.
- **Aucun jeton d'administration n'est généré automatiquement.** Le panneau `/admin`
  est désactivé tant que vous ne fournissez pas `ADMIN_TOKEN` dans
  `environment_variables`. C'est la valeur par défaut sécurisée.
- **`domain` doit être défini pour WebAuthn et TOTP.** Sans l'URL publique complète,
  les codes QR de 2FA pointent vers `localhost` et les e-mails d'invitation à une
  organisation contiennent des liens cassés.
- **Les sondes de santé ciblent `/alive`**, le point de terminaison de santé léger
  dédié de Vaultwarden. En tant que binaire Rust, Vaultwarden démarre rapidement ; la
  sonde de démarrage utilise un délai initial de 30 s.
- **L'affinité de session est `ClientIP` par défaut** afin d'acheminer un client
  Bitwarden donné de manière cohérente vers le même pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Vaultwarden {#a-gke-autopilot--the-vaultwarden-workload}

Les pods Vaultwarden sont planifiés sur Autopilot, qui facture le CPU et la mémoire
que les pods demandent réellement. Un StatefulSet avec un PersistentVolumeClaim
soutient le répertoire `/data`, afin que les données du coffre-fort survivent aux
redémarrages et aux mises à niveau des pods. L'autoscaling horizontal des pods
dimensionne la charge de travail entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Vaultwarden pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  kubectl describe pvc -n "$NAMESPACE"          # per-pod storage status
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail StatefulSet.

### B. Cloud SQL — PostgreSQL 15 ou MySQL 8.0 {#b-cloud-sql--postgresql-15-or-mysql-80}

Vaultwarden stocke toutes les données du coffre-fort dans une instance Cloud SQL
gérée. Le moteur par défaut est **PostgreSQL 15** ; définissez
`database_type = "MYSQL_8_0"` pour utiliser MySQL à la place. Les pods se connectent
de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune
IP publique n'est donc exposée. Lors du premier déploiement, une tâche
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. PersistentVolumeClaim et Cloud Storage {#c-persistentvolumeclaim-and-cloud-storage}

Les données du coffre-fort (l'état de repli SQLite de Vaultwarden, les clés de
signature RSA, les métadonnées des pièces jointes et la configuration 2FA) sont
écrites dans un **PersistentVolumeClaim** propre à chaque pod, sur `/data`. Un bucket
**Cloud Storage** dédié (`vaultwarden-attachments`) est également provisionné pour
les pièces jointes ; le compte de service de la charge de travail y reçoit l'accès
automatiquement.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims ; Cloud
  Storage → Buckets pour le bucket des pièces jointes.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/      # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données est stocké sous forme de secret Secret Manager
et injecté dans les pods à l'exécution. Vaultwarden gère lui-même son jeton
d'administration interne et ses clés de signature RSA dans le volume `/data` —
ceux-ci ne sont pas stockés dans Secret Manager.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret
Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.
Cloud Armor est vivement recommandé pour protéger les points de terminaison de
connexion de Vaultwarden contre les attaques par force brute.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud Armor et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Un test de disponibilité
ciblant `/alive` peut être activé.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Vaultwarden {#3-vaultwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation crée la base de données et l'utilisateur Vaultwarden et accorde
  les privilèges avant le démarrage de l'application. Elle est idempotente et peut
  être relancée sans risque. L'image de tâche appropriée est sélectionnée
  automatiquement : `postgres:15-alpine` pour PostgreSQL, `mysql:8.0-debian` pour
  MySQL.
- **Aucune migration de schéma au démarrage.** Vaultwarden gère automatiquement
  l'évolution de son schéma interne. La tâche d'initialisation crée seulement la base
  de données et l'utilisateur ; aucune commande de migration n'est nécessaire.
- **Aucune tâche planifiée requise.** Contrairement à de nombreuses applications web,
  Vaultwarden n'a aucune tâche cron obligatoire. Toutes les opérations du coffre-fort
  sont déclenchées par des requêtes.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent toutes deux
  `/alive`, qui renvoie `OK` lorsque le serveur est prêt. Le délai initial est de
  30 s, en phase avec le démarrage rapide de Vaultwarden en Rust.
- **Panneau d'administration.** Le panneau `/admin` est désactivé tant que
  `ADMIN_TOKEN` n'est pas fourni via `environment_variables`. Générez un jeton
  sécurisé et transmettez-le sous forme de variable d'environnement non secrète (ou
  référencez-le depuis Secret Manager via `secret_environment_variables`).
- **SMTP pour les notifications.** Vaultwarden utilise SMTP pour la vérification des
  comptes, les codes de récupération 2FA et les e-mails d'accès d'urgence. Configurez
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME` et `SMTP_PASSWORD` (via
  `secret_environment_variables`) comme un ensemble complet — une configuration SMTP
  partielle provoque des échecs de distribution silencieux.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Vaultwarden ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application et paramètres Vaultwarden {#group-3--application-identity--vaultwarden-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Vaultwarden Password Manager` | Nom convivial affiché dans la console. |
| `application_description` | _(set)_ | Annotation de description de la charge de travail. |
| `application_version` | `1.32.7` | Tag de version de l'image Vaultwarden ; incrémentez-le pour déployer une nouvelle version. |
| `domain` | `""` | **URL publique complète** (par exemple `https://vault.example.com`). Requise pour WebAuthn, les codes QR TOTP, les invitations à une organisation et les liens des pièces jointes. |
| `signups_allowed` | `false` | Autoriser l'auto-inscription de nouveaux utilisateurs. Activez-la uniquement pendant la configuration initiale ; désactivez-la immédiatement après avoir créé les comptes administrateurs. |
| `web_vault_enabled` | `true` | Servir l'interface web de Vaultwarden. Désactivez-la pour un accès uniquement par API via les clients natifs. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` effectue le build à partir du Dockerfile ; `prebuilt` utilise une URI d'image existante. |
| `cpu_limit` | `500m` | CPU par pod. Vaultwarden est un binaire Rust léger. |
| `memory_limit` | `512Mi` | Mémoire par pod. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter l'indisponibilité du coffre-fort lors d'un démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `80` | Port HTTP Rocket de Vaultwarden. Doit correspondre à `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. Requis. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(SMTP/log defaults)_ | Paramètres en texte clair. Les variables principales `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER` et, en option, `DOMAIN` sont injectées automatiquement. Les valeurs par défaut incluent `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false` et des valeurs SMTP fictives. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `workload_type` | `StatefulSet` | Utilisez un StatefulSet pour un stockage `/data` persistant (valeur par défaut recommandée). |
| `session_affinity` | `ClientIP` | Achemine un client donné de manière cohérente vers le même pod. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods pour les règles de pare-feu. |
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laissez vide pour le générer automatiquement. |

### Groupe 7 — Stockage persistant du StatefulSet {#group-7--statefulset-persistent-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionner un PVC pour le répertoire `/data` de Vaultwarden. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. Augmentez-la pour les grands coffres-forts comportant de nombreuses pièces jointes. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage, correspondant à la variable d'environnement `DATA_FOLDER`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes. |
| `stateful_headless_service` | `null` | Créer un Service headless pour le DNS du StatefulSet. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup défini dans le contexte de sécurité du pod. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/alive`, délai de 30 s, 6 échecs | Chemin de santé dédié de Vaultwarden ; 30 s correspond au démarrage rapide en Rust. |
| `health_check_config` | HTTP `/alive`, délai de 30 s, 3 échecs | Sonde d'activité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif ciblant `/alive`. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Automatisation de la charge de travail (tâches et tâches planifiées) {#group-11--workload-automation-jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche de configuration de base de données intégrée (qui sélectionne automatiquement l'image appropriée pour PostgreSQL ou MySQL). |
| `cron_jobs` | `[]` | Vaultwarden n'a aucune tâche planifiée requise ; ajoutez ici des CronJobs personnalisés si nécessaire. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume NFS Filestore facultatif. Non requis pour Vaultwarden avec un seul réplica (le PVC couvre `/data`). Activez-le pour un stockage complémentaire partagé entre réplicas. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket des pièces jointes. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (par défaut) ou `MYSQL_8_0`. L'image de la tâche d'initialisation est sélectionnée automatiquement. |
| `application_database_name` | `vaultwarden` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `vaultwarden` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `30` | Durée de rétention ; la valeur par défaut de 30 jours reflète l'importance de la récupération du coffre-fort. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + un certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôte à servir. Définissez également `domain` sur l'URL `https://` complète. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre ; recommandée pour la stabilité du DNS. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google. Remarque : IAP placé devant Vaultwarden peut empêcher les clients Bitwarden natifs de se connecter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommandé pour Vaultwarden.** Associe une règle WAF Cloud Armor pour protéger le point de terminaison de connexion contre la force brute. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Vaultwarden. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `signups_allowed` | `false` | Critical | Tant que la valeur est `true`, n'importe quel internaute peut s'inscrire lui-même sur le coffre-fort. Désactivez-la immédiatement après avoir créé les comptes administrateurs. |
| `enable_cloudsql_volume` | `true` | Critical | Vaultwarden se connecte à Cloud SQL par socket Unix ; la désactivation provoque immédiatement un CrashLoopBackOff. |
| `application_database_name` / `_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et Vaultwarden voit un coffre-fort vide. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont des octets et bloquent toute planification. |
| `workload_type` + `stateful_pvc_enabled` | StatefulSet / true | Critical | Définir `workload_type = "Deployment"` en même temps que `stateful_pvc_enabled = true` échoue au moment du plan. |
| `domain` | URL `https://` complète | High | Sans elle, les codes QR TOTP pointent vers `localhost`, les e-mails d'invitation à une organisation contiennent des liens cassés et les URL des pièces jointes sont invalides. |
| `database_type` | défini une seule fois | High | Le modifier après le premier déploiement amène Vaultwarden à se connecter à une base de données vide ; tous les identifiants semblent perdus. |
| `container_port` | `80` | High | Doit correspondre à `ROCKET_PORT` ; en cas de discordance, la sonde de disponibilité échoue et le pod ne devient jamais Ready. |
| `min_instance_count` | `1` | High | `0` met à l'échelle à zéro ; un gestionnaire de mots de passe devient indisponible pendant plusieurs secondes lors d'un démarrage à froid — les clients Bitwarden affichent des erreurs de connexion. |
| `stateful_pvc_size` | `10Gi` | High | Une taille trop petite se remplit lorsque les utilisateurs stockent des pièces jointes, ce qui provoque des erreurs d'écriture. Augmentez-la avant qu'il ne soit plein. |
| `session_affinity` | `ClientIP` | Medium | Sans affinité, les opérations de synchronisation du coffre-fort en cours peuvent être acheminées vers différents pods et rencontrer un état obsolète. |
| `enable_cloud_armor` | activer en production | Medium | Sans Cloud Armor, le point de terminaison de connexion de Vaultwarden est exposé aux attaques par force brute depuis Internet. |
| `backup_retention_days` | `30` (par défaut, à augmenter en production) | Medium | Un gestionnaire de mots de passe sans rétention de sauvegarde suffisante entraîne une perte d'identifiants en cas de défaillance de la base de données. |
| `pdb_min_available` vs `min_instance_count` | conserver une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_iap` avec des clients natifs | à utiliser avec précaution | Medium | IAP exige une authentification OAuth dans un navigateur ; les clients Bitwarden natifs ne peuvent pas mener à bien le flux IAP. |
| variables d'environnement `smtp_*` | à configurer comme un ensemble complet | High | Une configuration SMTP partielle provoque des échecs silencieux d'envoi d'e-mails — les codes de récupération 2FA et les e-mails d'invitation ne sont jamais envoyés. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Vaultwarden partagée
avec la variante Cloud Run est décrite dans
**[Vaultwarden_Common](Vaultwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vaultwarden sur GKE Autopilot](../labs/Vaultwarden_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vaultwarden Common — Configuration applicative partagée](Vaultwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
