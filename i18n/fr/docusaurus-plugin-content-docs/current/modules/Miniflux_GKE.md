---
title: "Miniflux sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Miniflux sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Miniflux_GKE.md @ 15fd4c7 sha256:4d93430555c2 -->

# Miniflux sur GKE Autopilot {#miniflux-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_GKE.png" alt="Miniflux sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un
simple binaire Go statique qui stocke tout son état dans PostgreSQL. Ce module
déploie Miniflux sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services Google Cloud que Miniflux utilise et
comment les explorer et les opérer depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme une charge de travail web Go à conteneur unique. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique dans un déploiement, mis à l'échelle horizontalement entre `min`/`max` réplicas |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Miniflux stocke **tout** son état ici ; pas de MySQL/autre moteur |
| Stockage d'objets | Cloud Storage (aucun) | Miniflux n'a pas besoin de bucket ; un montage NFS Filestore optionnel est disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux n'a pas de dépendance Redis et pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré (propriétaire initial) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec affinité de session `ClientIP`, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Le sondeur de flux s'exécute en interne.** Miniflux n'a pas de worker
  séparé — le même pod sert l'interface utilisateur et rafraîchit les flux sur
  `POLLING_FREQUENCY`. Gardez au moins un réplica en cours d'exécution pour que le
  sondage continue (GKE ne met pas à l'échelle à zéro).
- **Le propriétaire initial est amorcé, non auto-enregistré.** `CREATE_ADMIN = 1` amorce
  le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier démarrage ;
  l'inscription en libre-service reste désactivée. Récupérez le mot de passe
  de Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il n'y a pas
  de job de migration séparé, donc la mise à niveau de la version applique les
  modifications de schéma automatiquement.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé. Comme il n'y a pas de file
  d'attente partagée, l'exécution de plusieurs réplicas partage simplement la
  charge des requêtes (chacun sonde toujours indépendamment).
- **L'affinité de session est `ClientIP`.** Maintient un client lié à un pod
  pour une session d'interface utilisateur cohérente.
- **`DATABASE_URL` est composé à l'exécution** par le point d'entrée du conteneur
  (forme mot-clé/valeur libpq), se ramifiant sur la boucle locale du proxy
  d'authentification GKE (`127.0.0.1`, `sslmode=disable`) afin que la même image
  fonctionne sur Cloud Run et GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Miniflux {#a-gke-autopilot--the-miniflux-workload}

Les pods Miniflux s'exécutent en tant que déploiement sur Autopilot, écoutant
sur le port **8080**, facturés pour le CPU/la mémoire qu'ils demandent.
L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Miniflux pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données d'application (flux, entrées,
utilisateurs, sessions, catégories) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** sur la boucle locale (`127.0.0.1`) ; aucune IP publique n'est exposée.
Lors du premier déploiement, le job `db-init` crée la base de données `miniflux`
et le rôle et installe l'extension `hstore` appartenant au rôle de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe sont affichés dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage / NFS {#c-cloud-storage--nfs}

Miniflux n'a **pas** besoin de stockage d'objets — il conserve tout son état
dans PostgreSQL, donc aucun bucket de données n'est provisionné par la couche
d'application. Le montage Cloud Filestore optionnel (`enable_nfs`, à `/opt/miniflux/storage`)
est désactivé par défaut, car Miniflux n'y écrit jamais.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage →
  Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial amorcé dans Miniflux au premier démarrage. Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec affinité de session `ClientIP`. Un domaine personnalisé avec
un certificat géré par Google peut être activé, et une adresse IP statique
peut être réservée afin que l'adresse survive aux redéploiements. Lorsqu'un
domaine personnalisé est utilisé, définissez `BASE_URL` afin que Miniflux
émette des liens absolus corrects.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte optionnels sont disponibles. Le point
d'entrée enregistre son mode de connexion `DATABASE_URL` au démarrage — utile pour
diagnostiquer la connectivité de la base de données.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données
  `miniflux` et le rôle, accorde les privilèges, réattribue le schéma `public`
  et installe l'extension `hstore` **appartenant au rôle de l'application**
  (afin que la migration Miniflux `v119`, qui supprime `hstore`,
  réussisse). Le job envoie ensuite une requête au `/quitquitquit` du sidecar proxy
  afin que le pod du job se termine ; il peut être réexécuté en toute
  sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée définit `RUN_MIGRATIONS=1`,
  donc Miniflux applique ses propres migrations de schéma à chaque démarrage —
  pas d'étape de migration séparée. Prévoyez un temps supplémentaire au
  premier démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est amorcé.** `CREATE_ADMIN=1` amorce le compte
  `admin` (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. C'est idempotent —
  les démarrages ultérieurs enregistrent "l'utilisateur existe déjà".
  Récupérez le mot de passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité de ce module
  utilisent par défaut HTTP `/` (la page de connexion, un `200 OK` non
  authentifié). Miniflux sert également un `200 OK` non authentifié à
  `/healthcheck` si vous préférez un chemin de sonde dédié. Ne pointez pas les
  sondes vers des pages authentifiées.
- **Le sondeur de flux est en interne.** Les flux se rafraîchissent sur
  `POLLING_FREQUENCY` à l'intérieur de chaque pod. Gardez `min_instance_count >= 1` pour que le sondage
  s'exécute ; les réplicas supplémentaires sondent chacun indépendamment (il
  n'y a pas de file d'attente partagée pour les coordonner).
- **`BASE_URL` pilote les liens absolus.** Il utilise par défaut l'URL de
  service interne injectée ; définissez-le explicitement (via `environment_variables`) sur
  l'URL externe du LoadBalancer ou du domaine personnalisé une fois l'adresse
  connue.
- **Inspectez le job et les pods db-init :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Miniflux sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image Miniflux ; épingler à une version (par exemple `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenez à 1 pour que le sondeur de flux continue de fonctionner. |
| `max_instance_count` | `5` | Réplicas maximum. Miniflux n'a pas de file d'attente partagée — les pods supplémentaires partagent uniquement la charge des requêtes. |
| `container_port` | `8080` | Miniflux écoute sur 8080. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité (requis sur GKE). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Miniflux dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `BASE_URL`, `POLLING_FREQUENCY`). Ne définissez pas `DATABASE_URL` (composé à l'exécution). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout automatiquement en un déploiement sans état (Miniflux stocke tout son état dans PostgreSQL — pas besoin de StatefulSet). |
| `session_affinity` | `ClientIP` | Épingle un client à un pod pour une session d'interface utilisateur cohérente. |
| `container_protocol` | `http1` | HTTP/1.1 standard. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser désactivé — Miniflux conserve tout son état dans PostgreSQL, donc aucun PVC par pod n'est requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Stratégies de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, période de 15s, 30 échecs | Sonde de démarrage. Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s, période de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique optionnelles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés optionnels. |
| `additional_services` | `[]` | Sidecar ou services d'aide déployés avec Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux nécessite PostgreSQL. |
| `application_database_name` | `miniflux` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `miniflux` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un montage NFS Filestore à `/opt/miniflux/storage`. Laisser désactivé — Miniflux stocke l'état dans PostgreSQL et n'écrit jamais sur le montage. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste si vous en avez besoin de plus. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Stratégie de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inutilisé par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_uri`, `backup_format` — sauvegarde Cloud SQL automatisée et restauration au
déploiement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôte personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir (définissez `BASE_URL` pour correspondre). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige la connexion Google devant Miniflux (bloque les clients de jetons Fever/Reader-API). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
attache une politique WAF / CDN au backend Ingress. Voir
[App_GKE](App_GKE.md).

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — voir
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Miniflux. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`miniflux`). |
| `database_user` | Utilisateur de la base de données de l'application (`miniflux`). |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — une charge
> de travail `Deployment` avec `stateful_pvc_enabled = true`, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, une `database_type` qui ne
> correspond pas à une extension activée, des valeurs `quota_memory_*` entières
> nues. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois (`miniflux`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue au job d'importation. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager | Élevé | C'est la seule information d'identification du propriétaire amorcée au premier démarrage ; sans elle, vous ne pouvez pas vous connecter tant que vous ne la réinitialisez pas dans la base de données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver interrompt la connexion à la base de données. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; maintenir 1 garantit que le sondeur de flux interne continue de se rafraîchir. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer gaspille des ressources et ne change rien. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les requêtes d'un client sautent de pod en pod, perturbant la session de l'interface utilisateur. |
| `startup_probe.path` | `/healthcheck` | Élevé | Pointer la sonde vers une page authentifiée renvoie 401/403 et le pod ne devient jamais prêt. |
| `enable_iap` | désactivé sauf si l'interface utilisateur doit être protégée | Moyen | IAP protège l'interface utilisateur/API avec la connexion Google, bloquant les clients de jetons Fever/Reader-API. |
| `BASE_URL` (env) | LoadBalancer externe / URL de domaine | Moyen | Une URL de base obsolète/incorrecte entraîne des liens absolus et des URL d'image de proxy de flux cassés. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Miniflux
partagée avec la variante Cloud Run est décrite dans
**[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Miniflux sur GKE Autopilot](../labs/Miniflux_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Miniflux sur Google Cloud Run](Miniflux_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration d'application partagée](Miniflux_Common.md) — la configuration partagée par les deux cibles de déploiement.
