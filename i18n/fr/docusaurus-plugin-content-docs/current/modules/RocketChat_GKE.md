---
title: "Rocket.Chat sur GKE Autopilot"
description: "Référence de configuration pour déployer Rocket.Chat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/RocketChat_GKE.md @ 3055034 sha256:b9834e45fbb7 -->

# Rocket.Chat sur GKE Autopilot {#rocketchat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/RocketChat_GKE.png" alt="Rocket.Chat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rocket.Chat est une plateforme open source et auto-hébergée de communication d'équipe —
une alternative à Slack/Teams construite sur Node.js et Meteor, avec des canaux, des
messages directs, des fils de discussion, la voix/vidéo et une couche
omnicanal/LiveChat. Ce module déploie Rocket.Chat sur **GKE Autopilot** au-dessus du
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Rocket.Chat et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Rocket.Chat s'exécute comme un **StatefulSet** Node.js/Meteor dont le stockage de données
est intégré au même pod. Le déploiement assemble un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js/Meteor, 1 vCPU / 2 GiB par défaut ; un seul réplica de StatefulSet |
| Stockage de données | Replica set MongoDB 6.0 intégré | Intégré à l'image — pas de Cloud SQL. Replica set à nœud unique (`rs0`) via `127.0.0.1` |
| Persistance | PVC Persistent Disk (stockage bloc) | Le répertoire de données MongoDB `/data/db` se trouve sur un PVC `ReadWriteOnce` — requis pour WiredTiger |
| Secrets | Secret Manager | Jeton d'API facultatif (`enable_api_key`) |
| Entrée | LoadBalancer / Cloud Load Balancing | Externe par défaut (application de chat publique) ; domaine personnalisé + certificat géré + Gateway facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MongoDB est intégré, pas géré.** La réactivité en temps réel de Meteor suit l'oplog
  MongoDB, que seul un **replica set** fournit. Aucun stockage de données géré ici ne
  propose de replica set MongoDB ; le module intègre donc un replica set à nœud unique
  (`rs0`) dans l'image du pod. Il n'y a pas d'instance Cloud SQL.
- **MongoDB 6.0 depuis le dépôt Debian bullseye.** L'image de base
  `rocketchat/rocket.chat` est une Debian **bullseye** (glibc 2.31) ; le Dockerfile
  installe MongoDB 6.0 depuis le dépôt APT bullseye, car le paquet bookworm/7.0 exige
  glibc ≥ 2.34.
- **`stateful_pvc_enabled = true` est obligatoire.** Le moteur de stockage WiredTiger de
  MongoDB exige un véritable système de fichiers bloc — un montage `gcsfuse` le corrompt.
  Les valeurs par défaut du déploiement GKE activent un PVC de StatefulSet sur
  `/data/db` (correspondant à `MONGO_DBPATH`). Définir `stateful_pvc_enabled = true`
  résout automatiquement `workload_type` en `StatefulSet`.
- **Un seul réplica.** `min_instance_count = 1` et `max_instance_count = 1`. Le PVC est
  en `ReadWriteOnce` et la base MongoDB intégrée n'a qu'un seul rédacteur ; un second
  réplica ne peut pas attacher le disque.
- **Port 3000.** Rocket.Chat écoute sur le port 3000 ; le point d'entrée définit
  `PORT=3000`.
- **Santé sur `/api/info`.** Les sondes de démarrage et d'activité ainsi que les tests
  de disponibilité ciblent `/api/info`, qui ne renvoie 200 qu'une fois le serveur et son
  replica set prêts.
- **LoadBalancer par défaut.** Rocket.Chat est une application de chat publique ; le
  Service obtient donc une IP externe d'emblée ; un domaine personnalisé + Gateway (et
  IAP en option) est disponible pour un nom d'hôte stable et un certificat géré.
- **La première exécution est un assistant de configuration en 4 étapes.** Aucun
  administrateur n'est pré-créé — la première visite dans le navigateur guide la création
  du compte administrateur et de l'organisation.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Rocket.Chat {#a-gke-autopilot--the-rocketchat-workload}

Rocket.Chat s'exécute comme un pod de StatefulSet planifié sur Autopilot, qui facture le
CPU/la mémoire que demande le pod. Comme le jeu de données MongoDB réside sur un PVC
`ReadWriteOnce` et que l'application n'a qu'un seul rédacteur, la charge de travail ne
compte qu'un seul réplica.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet Rocket.Chat
  pour voir le pod, le PVC et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, des StatefulSets et des PVC.

### B. MongoDB intégré (pas de Cloud SQL) {#b-embedded-mongodb-no-cloud-sql}

Il n'y a **aucune instance Cloud SQL** — `database_type = "NONE"`. MongoDB s'exécute dans
le pod Rocket.Chat comme un replica set à nœud unique (`rs0`) via `127.0.0.1:27017`, avec
ses données sur le PVC du StatefulSet dans `/data/db`. Le point d'entrée démarre
`mongod`, initialise le replica set au premier démarrage, attend l'état `PRIMARY`, puis
lance Rocket.Chat.

```bash
# Confirm the embedded MongoDB reached PRIMARY on boot:
kubectl logs -n "$NAMESPACE" statefulset/<service-name> | grep -i "replica set rs0 is PRIMARY"
# Open a mongosh shell inside the pod (for maintenance / mongodump):
kubectl exec -it -n "$NAMESPACE" <pod> -- mongosh "mongodb://127.0.0.1:27017/rocketchat?replicaSet=rs0"
```

### C. PVC Persistent Disk (données MongoDB) {#c-persistent-disk-pvc-mongodb-data}

Le jeu de données MongoDB réside sur un PVC de StatefulSet (PD équilibré `standard-rwo`
par défaut) monté sur `/data/db`. C'est ce volume bloc qui rend WiredTiger sûr — ne le
remplacez **pas** par un montage `gcsfuse`.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute Engine
  → Disks.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~pvc"
  ```

Consultez [App_GKE](App_GKE.md) pour les StorageClasses, le dimensionnement des PVC et
CMEK.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour les sauvegardes et le stockage des
fichiers téléversés, en complément du PVC. Le compte de service de la charge de travail
y reçoit l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

### E. Secret Manager {#e-secret-manager}

Lorsque `enable_api_key = true`, un jeton d'API aléatoire est généré et stocké dans
Secret Manager pour les intégrations externes, puis matérialisé dans l'espace de noms
via le pilote Secret Store CSI. Aucun autre secret applicatif n'est créé ici —
Rocket.Chat crée et stocke ses propres clés dans MongoDB pendant la configuration
initiale.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  kubectl get secrets -n "$NAMESPACE"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est un Service **LoadBalancer** (IP externe), accessible
depuis un navigateur sans configuration supplémentaire. Pour un nom d'hôte stable et un
TLS géré, activez un domaine personnalisé avec un certificat géré par Google (Gateway
API) et, en option, IAP. Une IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Lorsque vous associez un domaine personnalisé, définissez `ROOT_URL` sur ce nom d'hôte.
Consultez [App_GKE](App_GKE.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (Rocket.Chat et le `mongod` intégré) sont envoyées à
Cloud Logging ; les métriques GKE sont envoyées à Cloud Monitoring. Un test de
disponibilité facultatif cible `/api/info`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Rocket.Chat {#3-rocketchat-application-behaviour}

- **Amorçage du replica set intégré.** À chaque démarrage du pod, le point d'entrée
  démarre `mongod --replSet rs0`, initialise le replica set une seule fois (de manière
  idempotente), attend que le nœud soit `PRIMARY`, puis exporte `MONGO_URL` /
  `MONGO_OPLOG_URL` et démarre Rocket.Chat. L'URL de l'oplog active les mises à jour en
  temps réel de Meteor.
- **Assistant de configuration initiale.** La première visite dans le navigateur ouvre
  un assistant en 4 étapes : (1) **Admin Info** — créez le compte administrateur (nom,
  nom d'utilisateur, e-mail, mot de passe) ; (2) **Organization Info** — nom, type,
  secteur, taille, pays ; (3) **Register Server** — enregistrez le serveur auprès de
  Rocket.Chat Cloud ou gardez-le autonome ; (4) **Complete**. Aucun administrateur n'est
  pré-créé.
- **Persistance des données.** Tout l'état (messages, utilisateurs, paramètres) réside
  dans la base MongoDB intégrée, sur le PVC dans `/data/db`. Supprimer le PVC supprime
  l'espace de travail.
- **Exactitude de `ROOT_URL`.** Le point d'entrée définit par défaut `ROOT_URL` sur l'URL
  de service calculée. Si vous servez Rocket.Chat sur un domaine personnalisé, définissez
  `ROOT_URL` (via `environment_variables`) sur cette URL, sinon les liens et les
  redirections OAuth pointent vers le mauvais hôte.
- **Les mises à jour recréent l'unique pod.** Avec un seul réplica de StatefulSet sur un
  PVC `RWO`, un déploiement progressif arrête l'ancien pod avant que le nouveau n'attache
  le disque — une brève interruption est attendue lors des mises à niveau de version.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/api/info`.
  Prévoyez quelques minutes au premier démarrage pour l'élection du replica set et les
  migrations initiales de Rocket.Chat.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Rocket.Chat ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez `gke` pour une exécution aux côtés d'une variante Cloud Run. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rocketchat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `RocketChat Vector Database` | Nom lisible affiché dans la console (la valeur par défaut porte un libellé hérité ; remplacez-la par quelque chose comme `Rocket.Chat Team Chat`). |
| `application_version` | `latest` | Tag de l'image Rocket.Chat ; `latest` épingle le build sur `6.12.1`. Épinglez une version précise en production. |
| `enable_api_key` | `false` | Génère un jeton d'API aléatoire dans Secret Manager pour les intégrations externes. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `4Gi` | Mémoire par pod ; Rocket.Chat et la base MongoDB intégrée se la partagent. |
| `min_instance_count` | `1` | Conservez 1 — GKE exige min ≥ 1 et la base MongoDB intégrée n'a qu'un seul rédacteur. |
| `max_instance_count` | `1` | **Conservez 1** — le PVC `RWO` et la base MongoDB à rédacteur unique interdisent un second réplica. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Sans objet — Rocket.Chat n'a pas de base de données SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Rocket.Chat dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `MONGO_URL`/`MONGO_OPLOG_URL`/`MONGO_DBPATH` — le point d'entrée les gère. Utilisez `OVERWRITE_SETTING_*` pour pré-remplir les paramètres d'administration ; définissez `ROOT_URL` pour un domaine personnalisé. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes ; externe par défaut, Rocket.Chat étant une application de chat publique. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (obligatoire). |
| `session_affinity` | `None` | Définissez `ClientIP` pour un routage WebSocket stable derrière un équilibreur de charge. |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL — laissez MongoDB vider ses tampons et s'arrêter proprement. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Définissez `true` (obligatoire).** Le moteur WiredTiger de MongoDB a besoin d'un stockage bloc — `gcsfuse` le corrompt. Sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; dimensionnez-la pour contenir le jeu de données MongoDB. Ne peut pas être réduite. |
| `stateful_pvc_mount_path` | `/data/db` | **Doit être égal à `MONGO_DBPATH`** pour que le PVC contienne le jeu de données MongoDB. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (PD équilibré) ou `premium-rwo` (IOPS plus élevées pour MongoDB). |
| `stateful_fs_group` | `3000` | GID fsGroup pour l'accès en écriture au PVC (valeur par défaut du chart Helm Rocket.Chat). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Unités binaires uniquement** (`4Gi`, `8192Mi`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/info` délai 60s, 40 échecs | Sonde de démarrage. Prévoyez quelques minutes au premier démarrage. |
| `liveness_probe` | HTTP `/api/info` délai 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/api/info`. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation par défaut — la base MongoDB intégrée est amorcée par le point d'entrée. |
| `cron_jobs` | `[]` | CronJobs Kubernetes (par exemple, sauvegardes `mongodump`). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Rocket.Chat. |

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS désactivé par défaut ; MongoDB utilise le PVC bloc. À activer uniquement pour le partage des fichiers téléversés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket de sauvegarde/fichiers. |
| `gcs_volumes` | `[]` | Montages GCS Fuse — **pas** pour les données MongoDB (utilisez le PVC). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure un dump MongoDB au déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour les noms d'hôte personnalisés + certificat géré. Définissez `ROOT_URL` en conséquence. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Rocket.Chat (nécessite `enable_custom_domain`). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à l'interface web de Rocket.Chat. |
| `rocketchat_api_key_secret_id` | ID du secret Secret Manager du jeton d'API (vide lorsque `enable_api_key = false`). |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`, IAP sans identités autorisées, des unités de quota non binaires, un `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sur `gcsfuse` (la valeur par défaut lorsqu'il n'est pas défini), le jeu de données WiredTiger de MongoDB se corrompt — l'espace de travail est irrécupérable. |
| `stateful_pvc_mount_path` | `/data/db` | Critique | Tout autre chemin signifie que le PVC ne contient pas le jeu de données MongoDB ; les données résident sur le système de fichiers éphémère du pod et sont perdues au redémarrage. |
| `max_instance_count` | `1` | Critique | Le PVC `RWO` et la base MongoDB à rédacteur unique ne peuvent pas prendre en charge un second réplica ; le pod supplémentaire ne parvient pas à attacher le disque et corrompt l'état si on le force. |
| PVC / `/data/db` (auto) | Ne jamais supprimer | Critique | Supprimer le PVC supprime l'ensemble de l'espace de travail. |
| `workload_type` | laisser `null` | Élevé | Définir `Deployment` avec `stateful_pvc_enabled = true` échoue au moment du plan ; laissez-le non défini pour qu'il se résolve automatiquement en StatefulSet. |
| `ROOT_URL` (domaine personnalisé) | Correspondre au nom d'hôte servi | Élevé | Un `ROOT_URL` incorrect casse les liens d'invitation, les URL de fichiers et les rappels OAuth. |
| `memory_limit` | `4Gi` (par défaut) | Élevé | Rocket.Chat et MongoDB dans un même pod subissent un OOM en dessous d'environ 2 GiB sous une charge réelle. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `premium-rwo`) | Moyen | `premium-rwo` offre plus d'IOPS à MongoDB pour les espaces de travail chargés, pour un coût plus élevé. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer le pod pendant la maintenance sans aucune protection. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Rocket.Chat partagée avec la variante Cloud Run
est décrite dans **[RocketChat_Common](RocketChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Rocket.Chat sur GKE Autopilot](../labs/RocketChat_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Rocket.Chat Common — Configuration applicative partagée](RocketChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
