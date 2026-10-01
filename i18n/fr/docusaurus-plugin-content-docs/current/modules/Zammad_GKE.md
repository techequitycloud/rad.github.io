---
title: "Zammad sur GKE Autopilot"
description: "Référence de configuration pour déployer Zammad sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Zammad_GKE.md @ 3055034 sha256:149640abd0db -->

# Zammad sur GKE Autopilot {#zammad-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zammad_GKE.png" alt="Zammad sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zammad est une plateforme open source de helpdesk et de support client — une
alternative conforme au RGPD à Zendesk et Freshdesk. Ce module déploie Zammad sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Zammad et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zammad s'exécute sous forme de charge de travail Ruby on Rails (railsserver). Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Zammad ne prend pas en charge MySQL |
| Stockage des pièces jointes | Filestore (NFS) | Pièces jointes des tickets dans `/opt/zammad/storage`, partagées entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket `zammad-attachments` dédié, toujours provisionné |
| Cache et file de tâches | Redis | Activé par défaut ; requis pour le pub/sub WebSocket d'ActionCable et pour Sidekiq |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; MySQL
  n'est pas pris en charge et est rejeté lors du plan.
- **Redis est obligatoire.** Zammad utilise Redis pour les mises à jour des tickets en
  temps réel (ActionCable) et le traitement des tâches en arrière-plan (Sidekiq). Sans
  lui, Zammad ne démarre pas.
- **Une image personnalisée est construite via Cloud Build.** `container_image_source = "custom"`
  est la valeur par défaut — Cloud Build enveloppe l'image officielle `zammad/zammad`
  de Docker Hub avec un `entrypoint.sh` spécifique à GCP qui fait correspondre les
  variables `DB_*` du socle à la convention `POSTGRESQL_*` de Zammad.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod**
  (de manière idempotente via `zammad-init`). La sonde de démarrage laisse amplement
  le temps à la migration du premier démarrage.
- **L'affinité de session est `ClientIP`, mais la diffusion en temps réel par
  WebSocket ActionCable ne fonctionne pas réellement.** `additional_services` est vide
  par défaut pour ce module, si bien que le processus `zammad-websocket` (port 6042)
  n'est jamais exposé via un Service Kubernetes — la négociation WebSocket du
  navigateur ne peut pas l'atteindre, la même lacune que celle documentée pour Cloud
  Run dans `Zammad_Common/scripts/entrypoint.sh`. L'affinité de session ne fait
  qu'épingler les requêtes HTTP ordinaires à un pod ; l'interface se rabat sur
  l'interrogation périodique pour les mises à jour des tickets en direct.
- **Le PodDisruptionBudget est activé par défaut.** Au moins un pod Zammad reste
  actif pendant la maintenance des nœuds.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Zammad {#a-gke-autopilot--the-zammad-workload}

Les pods Zammad sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Zammad pour voir les pods, les événements et l'utilisation des ressources.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zammad stocke toutes les données du helpdesk (tickets, utilisateurs, canaux,
enregistrements de SLA) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods
s'y connectent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix —
aucune adresse IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application. À chaque
démarrage de pod ultérieur, `zammad-init` applique les migrations de schéma en attente.

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
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les pièces jointes des tickets et les fichiers téléversés sont écrits sur un partage
**Filestore (NFS)** monté sur `/opt/zammad/storage` dans chaque pod, de sorte que
toutes les répliques voient les mêmes fichiers. Un bucket **Cloud Storage** dédié
(`zammad-attachments`) est également provisionné automatiquement ; l'accès est
accordé au compte de service de la charge de travail.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket des pièces jointes.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis et file de tâches {#d-redis-cache-and-job-queue}

Redis est obligatoire pour Zammad et remplit deux rôles essentiels :

1. **Pub/sub ActionCable** — transmet les mises à jour des tickets en temps réel aux
   agents répartis sur plusieurs pods.
2. **Sidekiq** — traite les tâches en arrière-plan (envoi d'e-mails, notifications de
   SLA, synchronisation LDAP, tâches du planificateur).

Lorsqu'aucun `redis_host` externe n'est configuré et que NFS est activé, l'adresse IP
de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  redis-cli -h <redis-host> client list    # active Sidekiq/ActionCable connections
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké sous forme de secret Secret Manager
et injecté dans les pods à l'exécution ; il n'apparaît jamais en clair dans la
configuration. Zammad gère ses propres clés de signature internes au démarrage —
aucun secret au niveau de l'application n'est généré automatiquement.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur les adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte sont disponibles en option.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Zammad {#3-zammad-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) s'exécute avant le démarrage de l'application. Il se
  connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente la base de
  données Zammad, l'utilisateur et les privilèges. Il peut être relancé sans risque.
- **Migrations à chaque démarrage.** Le `entrypoint.sh` personnalisé appelle
  `zammad-init` (migration + seed de la base Rails) avant de lancer le railsserver à
  chaque démarrage de pod. Les migrations en attente sont appliquées ; celles déjà
  exécutées sont ignorées.
- **Pont entre variables.** Le module socle injecte les identifiants de la base de
  données sous la forme `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. Le `entrypoint.sh`
  personnalisé les fait correspondre à la convention `POSTGRESQL_*` de Zammad à
  l'exécution.
- **Connectivité WebSocket — la diffusion en temps réel ne fonctionne pas non plus
  réellement sur GKE.** Le processus `zammad-websocket` (ActionCable) démarre sur le
  port 6042 à côté du railsserver, mais `main.tf` transmet
  `additional_services = var.additional_services` (vide par défaut, jamais renseigné
  avec une entrée 6042 pour ce module), si bien qu'aucun Service Kubernetes n'expose
  ce port — la négociation WebSocket du navigateur ne peut pas l'atteindre.
  L'interface se rabat proprement sur l'interrogation périodique, la même limitation
  que celle documentée pour Cloud Run dans `Zammad_Common/scripts/entrypoint.sh`.
  `enable_redis = true` reste obligatoire en production, car Sidekiq (tâches en
  arrière-plan) en dépend, que ActionCable soit joignable ou non.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/`
  par défaut, qui ne renvoie HTTP 200 que lorsque Zammad est entièrement initialisé
  (`path` peut être remplacé, par exemple par `/api/v1/ping`). La sonde de démarrage
  offre une tolérance généreuse (délai initial de 60 secondes, jusqu'à 30 tentatives)
  pour laisser le temps à la migration du schéma au premier démarrage.
- **Intégration e-mail.** Zammad envoie des notifications par e-mail pour les
  événements de tickets et les réinitialisations de mot de passe. Configurez SMTP après
  la première connexion dans **Admin → Channels → Email**. Les identifiants SMTP
  peuvent être injectés en tant que variables d'environnement secrètes.
- **Inspecter les jobs en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Zammad ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `elasticsearch_url` | `""` | Point de terminaison HTTP Elasticsearch pour la recherche en texte intégral. Laissez vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laissez vide lorsque la sécurité est désactivée. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zammad` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Zammad Helpdesk` | Nom convivial affiché dans la console. |
| `application_description` | `Zammad Open-source Helpdesk on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `6.4.1` | Tag de version de l'image Zammad ; incrémentez-le pour déployer un nouveau build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build (requis pour le point d'entrée GCP) ; `prebuilt` ignore le build. |
| `container_image` | `""` | Remplace l'URI de l'image du conteneur. Laissez vide pour laisser Cloud Build la gérer. |
| `container_resources` | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | Limites CPU/mémoire et demandes facultatives. Validées lors du plan. |
| `container_port` | `3000` | Port du railsserver Zammad. Doit correspondre à `ZAMMAD_RAILSSERVER_PORT`. |
| `min_instance_count` | `1` | Nombre minimal de répliques. Conservez ≥ 1 pour épargner aux agents de longs démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal de répliques (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Ne le désactivez pas. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Réplique l'image Docker Hub de Zammad dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `POSTGRESQL_*` et `RAILS_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple pour les mots de passe SMTP). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour la continuité des sessions WebSocket. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Durée pendant laquelle Kubernetes attend après SIGTERM avant d'arrêter de force le conteneur. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC ; sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC du StatefulSet. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC propre à chaque pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Portez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones pour résister à la défaillance d'une zone. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/`, délai de 120 s, 15 tentatives (remplacez `path` pour `/api/v1/ping`) | Tolérance généreuse pour la migration du schéma au premier démarrage. |
| `liveness_probe` / `health_check_config` | `/`, délai de 60 s (remplacez `path` pour `/api/v1/ping`) | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé, `path = "/"` | Test de disponibilité Cloud Monitoring facultatif ; remplacez `path` si vous l'activez avec `/api/v1/ping`. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Une liste non vide le remplace entièrement. |
| `cron_jobs` | `[]` | CronJobs planifiés — Zammad gère sa propre planification interne ; ajoutez ici vos jobs de maintenance personnalisés. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Zammad. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le stockage des pièces jointes de Zammad (à laisser activé). |
| `nfs_mount_path` | `/opt/zammad/storage` | Chemin de montage dans le conteneur. Doit correspondre à la configuration de stockage de Zammad. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. Le bucket `zammad-attachments` est toujours créé. |
| `storage_buckets` / `gcs_volumes` | _(définies)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis et file de tâches {#group-15--redis-cache--job-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Utilise Redis pour ActionCable et Sidekiq. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP de l'hôte NFS ; définissez-le explicitement pour Memorystore ou un serveur Redis dédié. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Zammad requiert PostgreSQL. |
| `application_database_name` | `zammad` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `zammad` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Installe des extensions PostgreSQL supplémentaires après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, adresse IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Zammad. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Zammad. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `zammad-attachments`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High**
> (élevé : service dégradé) — **Medium** (moyen : coût ou dégradation partielle) —
> **Low** (faible : mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Zammad requiert PostgreSQL ; MySQL est rejeté lors du plan. |
| `container_image_source` | `custom` (par défaut) | Critical | Utiliser `prebuilt` sans le point d'entrée personnalisé signifie que la correspondance `DB_*` → `POSTGRESQL_*` n'a pas lieu et que toutes les connexions à la base de données échouent au démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver supprime le socket de l'Auth Proxy ; toutes les connexions à la base de données échouent. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données / l'utilisateur et détruit toutes les données du helpdesk. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import ; l'activer à chaque apply écrase les données en production. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Critical | Sans Redis, ActionCable et Sidekiq ne parviennent pas à s'initialiser ; Zammad ne démarre pas. |
| `redis_host` | explicite ou adresse IP NFS | Critical | Vide avec NFS désactivé, aucun point de terminaison Redis valide n'existe — Zammad ne démarre pas. |
| `container_resources.memory_limit` | `4Gi` | High | En dessous de 2 GiB, Zammad manque de mémoire (OOM) pendant la migration du schéma ou sous charge. |
| `nfs_mount_path` | `/opt/zammad/storage` | High | Le modifier entraîne l'écriture des pièces jointes sur le stockage éphémère du pod ; les pièces jointes NFS existantes deviennent inaccessibles. |
| `enable_nfs` | `true` | High | Sans NFS, toutes les pièces jointes téléversées sont perdues au redémarrage d'un pod ou lors d'une mise à jour progressive. |
| `min_instance_count` | `1` | High | `0` provoque des démarrages à froid de 60 à 90 secondes pour le premier agent qui ouvre un ticket. |
| `session_affinity` | `ClientIP` | Medium | N'affecte que le routage des requêtes HTTP ordinaires entre les répliques ; n'active PAS ActionCable — `additional_services` est vide par défaut, si bien que le port 6042 n'est jamais exposé via un Service Kubernetes et que la diffusion en temps réel par WebSocket ne fonctionne pas, quel que soit ce paramètre. Ne comptez pas sur lui pour les mises à jour des tickets en direct. |
| `stateful_pvc_enabled = true` avec `workload_type = "Deployment"` | à éviter | High | Cette combinaison échoue lors du plan. |
| `startup_probe.initial_delay_seconds` | `60` (ou plus) | High | Une valeur trop courte provoque des boucles de redémarrage au premier démarrage pendant la migration du schéma. |
| `max_instance_count` > 1 sans Redis | configurez d'abord Redis | Medium | Plusieurs pods sans Redis provoquent des situations de concurrence sur l'attribution des tickets et une divergence de l'état en temps réel. |
| `enable_topology_spread` | à activer avec plusieurs répliques | Medium | Sans répartition, tous les pods peuvent se retrouver dans une seule zone ; une défaillance de zone met le helpdesk hors service. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'administration | Medium | Sinon, l'interface d'administration de Zammad est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Zammad, partagée avec
la variante Cloud Run, est décrite dans **[Zammad_Common](Zammad_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zammad sur GKE Autopilot](../labs/Zammad_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Zammad sur Google Cloud Run](Zammad_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zammad Common — configuration applicative partagée](Zammad_Common.md) — la configuration partagée par les deux cibles de déploiement.
