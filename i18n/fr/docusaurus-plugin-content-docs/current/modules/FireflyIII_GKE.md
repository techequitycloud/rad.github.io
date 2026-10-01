---
title: "Firefly III sur GKE Autopilot"
description: "Référence de configuration pour déployer Firefly III sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FireflyIII_GKE.md @ 3055034 sha256:888187488baf -->

# Firefly III sur GKE Autopilot {#firefly-iii-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_GKE.png" alt="Firefly III sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III est un gestionnaire de finances personnelles auto-hébergé, gratuit, open
source et sous licence AGPL. Il suit les comptes, les transactions, les budgets, les
factures, les catégories et les transactions récurrentes, et expose une API REST
complète. Ce module déploie Firefly III sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Firefly III et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Firefly III s'exécute comme une charge de travail web Laravel/PHP (Apache). Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Moteur fixe — `DB_CONNECTION = pgsql` ; MySQL n'est pas utilisé |
| Stockage objet | Cloud Storage | Un bucket `fireflyiii-uploads` dédié provisionné automatiquement |
| Fichiers persistants | Filestore (NFS, facultatif) | Pièces jointes et données d'exécution montées sur `/var/lib/fireflyiii` |
| Secrets | Secret Manager | `APP_KEY` Laravel et `STATIC_CRON_TOKEN` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur est fixé par la couche applicative
  partagée. Sur GKE, le pod atteint Cloud SQL via le **sidecar Cloud SQL Auth Proxy**
  sur `127.0.0.1:5432` (`DB_HOST = 127.0.0.1`), qui assure la terminaison TLS vers
  Cloud SQL — le saut en boucle locale est donc en clair et `PGSQL_SSL_MODE = prefer`
  (ne forcez pas `require`).
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager, puis
  matérialisé dans l'espace de noms via le pilote Secret Store CSI. Cette clé Laravel
  chiffre les champs sensibles et **ne doit jamais faire l'objet d'une rotation après
  le premier démarrage**.
- **`STATIC_CRON_TOKEN` est généré automatiquement.** Firefly n'effectue aucune
  planification en arrière-plan par lui-même ; appelez `GET /api/v1/cron/<STATIC_CRON_TOKEN>`
  chaque jour (un CronJob Kubernetes ou Cloud Scheduler) pour exécuter les transactions
  récurrentes, les factures et les budgets automatiques.
- **Exposé via un LoadBalancer externe** avec `session_affinity = ClientIP` afin que la
  session d'un utilisateur reste sur un même pod.
- **Définissez `APP_URL` sur l'hôte externe.** L'URL n'est pas connue au moment du
  plan ; définissez `application_domains` (ou `APP_URL` via `environment_variables`)
  une fois l'IP du LoadBalancer attribuée afin que Firefly construise des liens absolus
  corrects.
- **Le premier lancement passe par `/register`.** Aucun administrateur n'est créé à
  l'avance — le premier compte créé devient le propriétaire/administrateur. Désactivez
  ensuite l'inscription ouverte.
- **NFS est activé par défaut** pour conserver les pièces jointes et les données
  d'exécution dans `/var/lib/fireflyiii`.
- **Un minimum d'une réplique est maintenu** (GKE ne permet pas la mise à zéro).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Firefly III {#a-gke-autopilot--the-firefly-iii-workload}

Les pods Firefly III sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Firefly III pour voir les pods et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Firefly III stocke toutes les données applicatives dans une instance Cloud SQL for
PostgreSQL 15 gérée. Les pods l'atteignent de manière privée via le **sidecar Cloud
SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du
premier déploiement, un Job d'initialisation crée le rôle et la base de données de
l'application et accorde les privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags
  et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent dans les [Outputs](#5-outputs). Pour le modèle de
connexion, les sauvegardes et la rotation du mot de passe, consultez
[App_GKE](App_GKE.md).

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de téléversement **Cloud Storage** dédié est provisionné automatiquement.
Lorsque NFS est activé (par défaut), le répertoire des pièces jointes et d'exécution de
Firefly III est monté depuis un volume Filestore/NFS sur `/var/lib/fireflyiii`.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement : l'`APP_KEY` Laravel et le
`STATIC_CRON_TOKEN`. Ils sont matérialisés dans l'espace de noms via le pilote Secret
Store CSI. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -E 'APP_KEY|STATIC_CRON_TOKEN'
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Cron (transactions récurrentes) {#e-cron-recurring-transactions}

Firefly III n'exécute les transactions récurrentes, les rappels de factures et les
budgets automatiques que lorsqu'un appelant sollicite son point de terminaison cron. Il
n'existe pas de planificateur intégré au processus.

- Planifiez un **CronJob Kubernetes** quotidien (ou Cloud Scheduler) qui exécute
  `curl -s https://<host>/api/v1/cron/<STATIC_CRON_TOKEN>` — définissez-le via
  l'entrée `cron_jobs`.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et
Cloud SQL alimentent Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Firefly III {#3-firefly-iii-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il crée de manière
  idempotente le rôle et la base de données de l'application et accorde les privilèges
  sur la base et le schéma `public`. Le job peut être relancé sans risque.
- **Schéma créé au démarrage du conteneur.** Il n'y a **pas de job de migration
  distinct**. L'image `fireflyiii/core` exécute `php artisan migrate --force` et
  `firefly-iii:upgrade-database` à chaque démarrage, de sorte que la mise à niveau de
  `application_version` applique automatiquement les changements de schéma une fois que
  `db-init` a provisionné la base de données.
- **`APP_KEY` est immuable après le premier démarrage.** Le faire tourner rend
  illisibles tous les champs chiffrés auparavant.
- **Définissez `APP_URL` sur l'hôte externe** une fois l'IP du LoadBalancer attribuée :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"fireflyiii","env":[
      {"name":"APP_URL","value":"https://firefly.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `application_domains` / `environment_variables` avant le déploiement.
- **Le premier lancement passe par `/register`.** Créez le compte propriétaire, puis
  désactivez les inscriptions suivantes dans **Administration → Settings**.
- **Le point de terminaison cron pilote les éléments récurrents.** Planifiez un appel
  quotidien `GET <host>/api/v1/cron/<STATIC_CRON_TOKEN>`.
- **Chemin de santé.** La sonde de démarrage est une sonde TCP sur le port 8080. La
  sonde de vivacité est une sonde HTTP sur le point de terminaison JSON `/status` non
  authentifié de Firefly III (HTTP 200, sans connexion).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Firefly III ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fireflyiii` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `fireflyiii/core` ; épinglez une version (par ex. `version-6.1.21`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `fireflyiii/core`. |
| `min_instance_count` | `1` | Nombre minimal de répliques (GKE exige ≥ 1). |
| `max_instance_count` | `1` | Nombre maximal de répliques. |
| `container_port` | `8080` | Firefly III (Apache) écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy ; requis pour la connectivité en boucle locale vers Cloud SQL. |
| `enable_image_mirroring` | `true` | Duplique l'image dans Artifact Registry avant le déploiement. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs de base (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `DB_HOST=127.0.0.1`) sont définies automatiquement ; ajoutez `APP_URL`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. `APP_KEY` et `STATIC_CRON_TOKEN` sont injectés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en `Deployment` si non défini ; définissez explicitement `StatefulSet` si nécessaire. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient la session d'un utilisateur sur un même pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Non requis — Firefly III stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Paramètres de PVC par pod. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Désactivé par défaut car `max_instance_count = 1` (un PDB égal au nombre de répliques bloque le drainage des nœuds). |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 8080 | Sonde de démarrage. |
| `liveness_probe` | HTTP `/status`, délai de 300 s | Point de terminaison de santé JSON non authentifié de Firefly III. |
| `health_check_config` / `startup_probe_config` | Sondes au niveau d'App_GKE | Sondes d'infrastructure. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Définissez un CronJob quotidien appelant `/api/v1/cron/<STATIC_CRON_TOKEN>`. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Firefly III. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Conserve les pièces jointes et les données d'exécution dans `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/lib/fireflyiii` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires en plus du bucket de téléversement. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache/session facultatif ; Firefly III utilise la base de données par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison et authentification Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `"POSTGRES_15"` | Défini explicitement, en cohérence avec le moteur que `FireflyIII_Common` fixe pour cette application. |
| `application_database_name` | `fireflyiii` | Nom de la base de données, injecté en tant que `DB_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `fireflyiii` | Utilisateur applicatif, injecté en tant que `DB_USERNAME`. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir ; définit aussi `APP_URL`. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Recommandé pour des données de finances personnelles.** Firefly III contient des
> données financières sensibles — placer IAP en frontal restreint l'accès aux identités
> Google authentifiées et autorisées.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Firefly III. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 8 / 22 — Quota de ressources, VPC-SC et journalisation d'audit {#group-8--22--resource-quota-vpc-sc--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | ResourceQuota de l'espace de noms. Les valeurs de mémoire nécessitent des suffixes binaires (`4Gi`). |
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Firefly III. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Sa rotation rend illisibles tous les champs chiffrés auparavant — les données sont de fait perdues. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `PGSQL_SSL_MODE` (`prefer` automatique) | Laisser tel quel | High | Forcer `require` sur la boucle locale en clair de l'Auth Proxy échoue (« SSL is not enabled on the server »). |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité en boucle locale vers Cloud SQL. |
| `APP_URL` | URL externe du LoadBalancer / du domaine | High | Une URL absente ou erronée casse les liens absolus, les redirections et les callbacks OAuth. |
| `STATIC_CRON_TOKEN` / job cron | Planifier un appel quotidien | High | Sans appel cron planifié, les transactions récurrentes, les factures et les budgets automatiques ne se déclenchent jamais. |
| `enable_nfs` | `true` | High | Le désactiver place les pièces jointes sur le stockage éphémère du pod — les fichiers disparaissent au redémarrage du pod. |
| `session_affinity` | `ClientIP` | High | Sans persistance de session, l'état de session peut être routé vers différents pods et perturber l'interface. |
| `enable_iap` | à activer pour des données privées | High | Firefly III contient des données financières ; le laisser accessible publiquement les expose. |
| Inscription au premier lancement | La désactiver après le premier administrateur | High | Laisser l'inscription ouverte permet à toute personne disposant de l'URL de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont des octets et bloquent l'ordonnancement de tous les pods de l'espace de noms. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Firefly III, partagée
avec la variante Cloud Run, est décrite dans
**[FireflyIII_Common](FireflyIII_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Firefly III sur GKE Autopilot](../labs/FireflyIII_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Firefly III Common — Configuration applicative partagée](FireflyIII_Common.md) — la configuration partagée par les deux cibles de déploiement.
