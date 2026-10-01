---
title: "Mautic sur GKE Autopilot"
description: "Référence de configuration pour déployer Mautic sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mautic_GKE.md @ 3055034 sha256:c48e3889a3e8 -->

# Mautic sur GKE Autopilot {#mautic-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_GKE.png" alt="Mautic sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme open source d'automatisation marketing pour les campagnes
d'e-mailing, la gestion des contacts, les pages d'atterrissage et la notation des
prospects. Ce module déploie Mautic sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Mautic et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) : ils ne sont pas répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Mautic s'exécute sous forme de charge de travail web PHP/Apache. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias et ressources téléversés partagés entre tous les réplicas |
| Stockage objet | Cloud Storage | Un bucket dédié aux médias |
| Cache et sessions | Redis | Activé par défaut ; se rabat sur l'IP de l'hôte NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de la base de données générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; choisir
  PostgreSQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Avec plus d'un réplica, un cache partagé est
  nécessaire pour garder la cohérence de l'état des sessions et des campagnes.
- **L'affinité de session est `ClientIP`.** Mautic s'appuie sur les sessions PHP ; les
  requêtes d'un même navigateur sont donc dirigées vers un seul pod.
- **Les migrations de la base de données s'exécutent à chaque démarrage de pod** (de
  façon idempotente), de sorte que les montées de version s'appliquent automatiquement.
  La sonde de démarrage accorde environ 90 secondes à la configuration du premier démarrage.
- Le **mot de passe administrateur** de Mautic est généré automatiquement et stocké
  dans Secret Manager ; vous ne le définissez jamais en clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Mautic {#a-gke-autopilot--the-mautic-workload}

Les pods Mautic sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'Horizontal Pod Autoscaling dimensionne le
déploiement entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Mautic pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données de l'application (contacts, campagnes, segments) dans
une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de manière privée via
le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est donc
exposée. Lors du premier déploiement, un Job d'initialisation crée la base de données
et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans chaque
pod, de sorte que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud
Storage** dédié est également provisionné pour les médias ; l'accès est accordé
automatiquement au compte de service de la charge de travail.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket des médias.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache de Mautic et, dans les déploiements
multi-réplica, maintient la cohérence du cache et des verrous. Lorsqu'aucun hôte Redis
externe n'est configuré et que NFS est activé, l'IP de l'hôte NFS sert de point de
terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de données sont
stockés sous forme de secrets Secret Manager et injectés dans les pods à l'exécution ;
aucune valeur en clair n'apparaît dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI
et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN
et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation crée la base de données et l'utilisateur de Mautic et accorde les
  privilèges avant le démarrage de l'application. Il est idempotent et peut être
  relancé sans risque.
- **Migrations au démarrage.** Chaque pod exécute les migrations de base de données de
  Mautic pendant son démarrage, de sorte qu'une montée de version de l'application
  applique automatiquement les modifications de schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'envoi des e-mails et
  la mise à jour des segments de Mautic reposent sur des commandes planifiées. Sans
  elles, aucune campagne ne se déclenche et aucun e-mail n'est envoyé. Configurez-les
  comme tâches planifiées ; les commandes attendues par Mautic :

  | Commande | Rôle | Fréquence type |
  |---|---|---|
  | `mautic:segments:update` | Actualise l'appartenance aux segments | toutes les 15 min |
  | `mautic:campaigns:trigger` | Déclenche les événements de campagne planifiés | toutes les 15 min |
  | `mautic:campaigns:messages` | Envoie les messages de campagne en file d'attente | toutes les 15 min |
  | `mautic:queue:process` | Traite la file d'envoi des e-mails | toutes les 5 min |
  | `mautic:maintenance:cleanup` | Purge les anciennes données | chaque semaine |

  Inspectez les tâches planifiées et leurs exécutions :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Chemin de santé.** Les sondes de disponibilité (readiness) et de vivacité utilisent la page de
  connexion de Mautic, qui ne renvoie HTTP 200 que lorsque l'application est
  entièrement initialisée.
- **Connexion administrateur.** Le nom d'utilisateur et l'adresse e-mail de
  l'administrateur initial sont configurables ; le mot de passe se récupère dans
  Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Mautic ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la console. |
| `application_description` | `Mautic Marketing Automation on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `5` | Tag de version de l'image Mautic ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour Mautic. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (évite les OOM PHP lors des imports). |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 afin que les tâches planifiées disposent d'une cible. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs `MAUTIC_*` principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant nécessaire aux sessions PHP de Mautic. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est nécessaire à la connectivité NFS. |

### Groupe 7 — Quota de ressources {#group-7--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers sans suffixe sont lus comme des octets et bloquent la planification. |

### Groupe 8 — Règles de fiabilité {#group-8--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Portez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 9 — Observabilité et santé {#group-9--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | Remplacées par HTTP `/healthz` | Le module détourne les deux sondes de la page de connexion de Mautic : `/index.php/s/login` renvoie HTTP 500 (redirection vers l'installateur) tant que la base de données n'est pas configurée ; les kube-probes ciblent donc plutôt le fichier statique `/healthz`, qui renvoie 200 quel que soit l'état de l'application. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 10 — Jobs et tâches planifiées {#group-10--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré de configuration de la base de données. |
| `cron_jobs` | `[]` | **Configurez les commandes planifiées de Mautic décrites au §3** — indispensables aux campagnes et aux e-mails. |

### Groupe 11 — CI/CD et intégration GitHub {#group-11--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias de Mautic (à laisser activé en multi-réplica). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket des médias. |
| `storage_buckets` / `gcs_volumes` | _(définie)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le cache et les sessions. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS ; définissez-le explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne le modifiez pas. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Mautic. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définie)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Identifiant de l'administrateur initial. |
| `mautic_admin_email` | `admin@example.com` | Adresse e-mail de l'administrateur — **indiquez une adresse réelle** (les notifications système y sont envoyées). |
| `mailer_from_name` | `Mautic` | Nom affiché sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expédition — **utilisez un domaine doté d'enregistrements SPF/DKIM valides**, sinon les e-mails sont rejetés ou classés en spam. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsque le déploiement réussit ; c'est le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Mautic. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Mautic nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `cron_jobs` | configurés (§3) | Critique | Sans les commandes planifiées, aucune campagne ne se déclenche et aucun e-mail n'est envoyé. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les fichiers téléversés sont perdus au redémarrage et ne sont pas partagés entre les réplicas. |
| `application_database_name` / `_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers sans suffixe sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Élevé | Avec plus d'un réplica, des caches isolés par pod provoquent des incohérences. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison valide si Redis est activé alors que NFS est désactivé et qu'aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Une mémoire insuffisante provoque des OOM PHP pendant les imports et les envois. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions en multi-réplica perdent l'état de session. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | Élevé | Les valeurs d'exemple n'aboutissent nulle part et sont rejetées ou classées en spam. |
| `min_instance_count` | `1` | Élevé | `0` laisse les tâches planifiées sans pod sur lequel s'exécuter. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'accès d'administration | Moyen | Sinon, l'interface d'administration est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de rétention liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | prévoir de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Mautic partagée avec
la variante Cloud Run est décrite dans **[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mautic sur GKE Autopilot](../labs/Mautic_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur Google Cloud Run](Mautic_CloudRun.md) — la même application sur Cloud Run, si vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration applicative partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
