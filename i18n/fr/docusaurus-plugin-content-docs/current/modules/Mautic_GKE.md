---
title: "Mautic sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Mautic sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mautic_GKE.md @ 15fd4c7 sha256:21ad55b71b1f -->

# Mautic sur GKE Autopilot {#mautic-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_GKE.png" alt="Mautic sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme d'automatisation du marketing open source pour les
campagnes e-mail, la gestion des contacts, les pages de destination et la
notation des prospects. Ce module déploie Mautic sur **GKE Autopilot** en
s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services Google Cloud utilisés par Mautic et sur
la manière de les explorer et de les opérer depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mautic fonctionne comme une charge de travail web PHP/Apache. Le déploiement
combine un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias et ressources téléchargés partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket média dédié |
| Cache et sessions | Redis | Activé par défaut ; revient à l'IP de l'hôte NFS si aucun hôte Redis n'est spécifié |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de base de données générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ;
  sélectionner PostgreSQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Avec plus d'un réplica, un cache partagé est
  nécessaire pour maintenir la cohérence de l'état des sessions et des campagnes.
- **L'affinité de session est `ClientIP`.** Mautic s'appuie sur les sessions PHP,
  donc les requêtes d'un navigateur sont épinglées à un pod.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod**
  (idempotent), de sorte que les mises à niveau de version s'appliquent
  automatiquement. La sonde de démarrage alloue environ 90 secondes pour la
  configuration initiale.
- Le **mot de passe administrateur** de Mautic est généré automatiquement et
  stocké dans Secret Manager ; vous ne le définissez jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Mautic {#a-gke-autopilot--the-mautic-workload}

Les pods Mautic sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Mautic pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données d'application (contacts, campagnes, segments)
dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte
qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits dans un partage **Filestore (NFS)** monté
dans chaque pod afin que tous les réplicas voient les mêmes fichiers. Un bucket
**Cloud Storage** `media` est également provisionné, mais rien ne le monte ni
n'y écrit — il est conservé uniquement parce que le supprimer d'un déploiement
existant déclenche un cycle de dépendance Terraform.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket média.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache de Mautic et, dans les déploiements
multi-réplicas, maintient la cohérence de l'état du cache et des verrous.
Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'IP de
l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de
données sont stockés en tant que secrets Secret Manager et injectés dans les
pods au moment de l'exécution ; le texte clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des tests de disponibilité et des politiques
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur Mautic et accorde
  les privilèges avant le démarrage de l'application. Il est idempotent et peut
  être réexécuté en toute sécurité.
- **Migrations au démarrage.** Chaque pod exécute les migrations de base de
  données de Mautic pendant le démarrage, de sorte que la mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'attente
  d'e-mails et les mises à jour de segments de Mautic sont pilotées par des
  commandes planifiées. Sans elles, les campagnes ne se déclenchent jamais et
  aucun e-mail n'est envoyé. Mautic n'a pas de planificateur intégré, elles
  s'exécutent donc en tant que CronJobs Kubernetes :

  | Commande | Objectif | Cadence |
  |---|---|---|
  | `mautic:segments:update` | Actualiser l'appartenance aux segments | toutes les 15 min (`:00`, `:15`, …) |
  | `mautic:campaigns:update` | Reconstruire l'appartenance aux campagnes | toutes les 15 min (`:05`, `:20`, …) |
  | `mautic:campaigns:trigger` | Déclencher les événements de campagne planifiés | toutes les 15 min (`:10`, `:25`, …) |

  Ces trois commandes sont planifiées par le module lui-même, décalées pour ne
  jamais se chevaucher, et exécutées via `mautic-cron.sh` (qui mappe les paramètres de la
  base de données comme le fait le conteneur web et attend le proxy Cloud SQL).
  Tout ce que Mautic offre d'autre — par exemple `mautic:queue:process` si vous mettez en
  file d'attente des e-mails, ou `mautic:maintenance:cleanup` — est ajouté via `cron_jobs`, qui est
  ajouté aux trois commandes intégrées.

  Inspectez les tâches planifiées et leurs exécutions :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Chemin de santé.** La disponibilité/vivacité utilise la page de connexion de
  Mautic, qui renvoie HTTP 200 uniquement lorsque l'application est
  entièrement initialisée.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail de
  l'administrateur initial sont configurables ; le mot de passe est récupéré
  depuis Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mautic sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la console. |
| `application_description` | `Mautic Marketing Automation on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `5` | Tag de version de l'image Mautic ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour Mautic. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (évite les OOM PHP lors des importations). |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour que les tâches planifiées aient une cible. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `MAUTIC_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP de Mautic. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — Quota de ressources {#group-7--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 8 — Politiques de fiabilité {#group-8--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 9 — Observabilité et santé {#group-9--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | Remplacé par HTTP `/healthz` | Le module remplace les deux sondes de la page de connexion de Mautic : `/index.php/s/login` renvoie HTTP 500 (redirection de l'installateur) tant que la base de données n'est pas configurée, donc les sondes kube-probes atteignent plutôt le fichier statique `/healthz`, qui renvoie 200 quel que soit l'état de l'application. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 10 — Jobs et tâches planifiées {#group-10--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires, ajoutés aux trois commandes Mautic que le module planifie lui-même (§3). |

### Groupe 11 — CI/CD et intégration GitHub {#group-11--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Mautic (garder activé pour les multi-réplicas). |
| `nfs_mount_path` | `/var/www/html/docroot/media/files` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket média. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache/les sessions. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP de l'hôte NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Mautic. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Identifiant de l'administrateur initial. |
| `mautic_admin_email` | `admin@example.com` | E-mail de l'administrateur — **définir une adresse réelle** (les notifications système y sont envoyées). |
| `mailer_from_name` | `Mautic` | Nom d'affichage sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expéditeur — **utiliser un domaine avec SPF/DKIM valide** ou le courrier est rejeté/classé comme spam. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Mautic. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Mautic nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| Commandes planifiées intégrées (§3) | laisser en place | Critique | Aucune campagne ne se déclenche sans elles ; ajouter le traitement de la file d'attente d'e-mails via `cron_jobs` si vous mettez en file d'attente des e-mails. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements sont perdus au redémarrage et ne sont pas partagés entre les réplicas. |
| `application_database_name` / `_user` | définir une fois | Critique | Immuable après le premier déploiement ; renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Élevé | Avec >1 réplica, les caches isolés par pod entraînent une incohérence. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des OOM PHP pendant les importations/envois. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions multi-réplicas perdent l'état de session. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | Élevé | Les espaces réservés n'envoient nulle part et sont rejetés/classés comme spam. |
| `min_instance_count` | `1` | Élevé | `0` laisse les tâches planifiées sans pod pour s'exécuter. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface admin | Moyen | L'interface utilisateur admin est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Mautic
partagée avec la variante Cloud Run est décrite dans
**[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Mautic sur GKE Autopilot](../labs/Mautic_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur Google Cloud Run](Mautic_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration d'application partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
