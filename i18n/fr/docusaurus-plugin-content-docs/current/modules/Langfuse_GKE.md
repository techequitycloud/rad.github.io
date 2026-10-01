---
title: "Langfuse sur GKE Autopilot"
description: "Référence de configuration pour déployer Langfuse sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Langfuse_GKE.md @ 3055034 sha256:aa515fb67e3e -->

# Langfuse sur GKE Autopilot {#langfuse-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_GKE.png" alt="Langfuse sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse est une plateforme open source d'ingénierie et d'observabilité des LLM, sous licence MIT —
traçage, gestion des prompts, évaluations et métriques pour les applications fondées sur de grands
modèles de langage. Ce module déploie Langfuse sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Langfuse et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Langfuse s'exécute comme une charge de travail web Next.js. Ce module déploie la **branche v2** (PostgreSQL uniquement) ;
Langfuse v3 nécessite en plus ClickHouse, Redis et S3 et sort du périmètre. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Langfuse v2 ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket dédié provisionné automatiquement ; partage NFS facultatif pour les exports |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `SALT` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Langfuse v2 (PostgreSQL uniquement) est figé.** L'image est construite `FROM langfuse/langfuse:2`
  via l'ARG de build `LANGFUSE_VERSION` ; `application_version = "latest"` se résout en `2`.
- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la couche applicative
  partagée ; choisir un autre moteur empêche le démarrage.
- **`NEXTAUTH_SECRET` et `SALT` sont générés automatiquement** et stockés dans Secret Manager,
  matérialisés dans l'espace de noms et injectés comme variables d'environnement. La validation zod de l'environnement de Langfuse
  refuse de démarrer sans les deux — `NEXTAUTH_SECRET` signe les JWT de session, `SALT` hache les clés d'API.
- **Les migrations Prisma s'exécutent à chaque démarrage.** Le point d'entrée cloud compose `DATABASE_URL` à partir
  des variables `DB_*` injectées, puis passe la main au démarrage propre de Langfuse, qui exécute
  `prisma migrate deploy`. Le job `db-init` crée uniquement le rôle et la base de données.
- **Le premier utilisateur qui s'inscrit devient le propriétaire.** `AUTH_DISABLE_SIGNUP = "false"` est injecté ;
  il n'existe aucun identifiant administrateur prédéfini.
- **L'affinité de session est `ClientIP` par défaut** afin que les requêtes d'un client atteignent le même pod.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro) ; un PodDisruptionBudget maintient
  le service disponible pendant les mises à niveau des nœuds.
- **Pas de Redis.** Langfuse v2 utilise une file d'attente et un cache adossés à PostgreSQL ; `enable_redis` reste
  à `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Langfuse {#a-gke-autopilot--the-langfuse-workload}

Les pods Langfuse sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Langfuse pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou
StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Langfuse stocke toutes les données applicatives (traces, observations, scores, prompts, utilisateurs, projets,
clés d'API) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de manière privée via
le sidecar **Cloud SQL Auth Proxy** sur un écouteur en boucle locale ; aucune IP publique n'est exposée. Au
premier déploiement, un job d'initialisation crée le rôle et la base de données de l'application ; Langfuse
applique ensuite son schéma via `prisma migrate deploy` au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques
et la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement ; le compte de service de la charge de travail
reçoit l'accès. Langfuse v2 conserve toutes les données de traces et d'observabilité dans PostgreSQL ;
le bucket (et le partage NFS monté en option) servent aux exports et aux médias.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session) et `SALT` (hache les clés d'API). Tous deux sont matérialisés dans
l'espace de noms via le pilote Secret Store CSI et injectés comme variables d'environnement, et tous deux sont obligatoires
au démarrage. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md)
pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une IP statique est réservée par
défaut afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Langfuse {#3-langfuse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données de l'application, puis accorde les droits. Il ne crée **pas** les tables — le
  job peut être relancé sans risque.
- **Migrations Prisma au démarrage.** Le point d'entrée cloud compose `DATABASE_URL` et délègue au
  démarrage propre de Langfuse, qui exécute `prisma migrate deploy` avant de lancer le serveur.
  La montée de version de l'application applique les changements de schéma sans étape de migration distincte.
- **`NEXTAUTH_SECRET` et `SALT` sont immuables après le premier démarrage.** Ils sont générés une seule fois et
  écrits dans Secret Manager. Modifier `NEXTAUTH_SECRET` invalide toutes les sessions actives ; modifier
  `SALT` invalide définitivement toutes les clés d'API existantes (les clients SDK reçoivent alors `401`). N'effectuez de rotation
  que pendant une fenêtre de maintenance planifiée.
- **Le premier utilisateur est le propriétaire.** Lors de la première visite, la page d'inscription de Langfuse crée le compte
  initial, qui devient le propriétaire de l'instance. Après l'intégration initiale, définissez `AUTH_DISABLE_SIGNUP = "true"`
  dans `environment_variables` pour empêcher toute nouvelle inscription en libre-service.
- **IP externe pour l'ingestion.** La valeur par défaut `service_type = LoadBalancer` expose une IP externe
  afin que les clients SDK de votre application LLM puissent envoyer des traces par POST. Définissez `NEXTAUTH_URL` sur l'URL externe une fois
  l'IP du LoadBalancer ou le domaine personnalisé attribué :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"langfuse","env":[
      {"name":"NEXTAUTH_URL","value":"https://langfuse.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `environment_variables` dans la configuration du module avant le déploiement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut. Le large seuil d'échec
  de la sonde de démarrage (30 × 15s) laisse le temps aux migrations Prisma du premier démarrage.
- **Les déploiements NFS utilisent `Recreate`.** Lorsque NFS est activé et qu'un serveur partagé est découvert,
  `App_GKE` définit la stratégie de mise à jour `Recreate` afin que deux pods ne se disputent jamais le volume partagé
  pendant une mise à jour.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres
à Langfuse ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langfuse` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Langfuse Helpdesk` | Nom lisible affiché dans la console. **Reliquat de clonage connu dans la source** (copié depuis un modèle d'application de helpdesk) — remplacez-le par `"Langfuse"` pour un déploiement réel. |
| `application_description` | `Langfuse Open-source Helpdesk on GKE Autopilot` | Brève description. Même reliquat de clonage que `application_display_name` — remplacez-la pour un déploiement réel. |
| `application_version` | `2` | Tag de l'image Langfuse. Figé sur la branche v2 (PostgreSQL uniquement). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Langfuse construit une fine image de surcouche à partir de `langfuse/langfuse:2`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et demandes de CPU/mémoire ; 2 GiB de mémoire au minimum. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (borne supérieure du HPA). |
| `container_port` | `3000` | Langfuse (Next.js) écoute sur le port 3000. |
| `timeout_seconds` | `300` | Durée maximale de réponse du pod backend (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Langfuse dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `NEXTAUTH_SECRET`, `SALT` ni `DATABASE_URL` ici. Définissez `AUTH_DISABLE_SIGNUP = "true"` ici après l'intégration initiale. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `Deployment` (auto) | `Deployment` (sans état, par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant afin que les requêtes d'un client atteignent le même pod. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (auto) | Active les modèles de PVC. Non recommandé — Langfuse stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_headless_service` | `null` (auto) | Crée un Service headless pour des noms DNS de pods stables. |
| `stateful_pod_management_policy` | `null` (`OrderedReady`) | Ordre de création des pods. |
| `stateful_update_strategy` | `null` (`RollingUpdate`) | Stratégie de mise à jour. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Total des demandes/limites de CPU pour l'ensemble des pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Total des demandes/limites de mémoire (suffixe binaire, p. ex. `4Gi`). |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods uniformément entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, fenêtre d'échec de 30 × 15s | Sonde de démarrage. Couvre les migrations Prisma du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, sondes d'infrastructure au niveau d'App_GKE | Sondes structurées. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiées. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Langfuse. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez [App_GKE](App_GKE.md). Entrées
principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un partage NFS sur `/opt/langfuse/storage` pour les exports/médias facultatifs. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume du montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 utilise une file d'attente et un cache adossés à PostgreSQL — laissez `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisés uniquement en cas d'externalisation vers Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé — Langfuse nécessite PostgreSQL 15 ou supérieur. |
| `application_database_name` | `langfuse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langfuse` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP impose une authentification par identité Google pour **toutes** les requêtes
> entrantes, y compris l'ingestion de traces par les SDK. N'activez IAP que si l'ingestion publique n'est pas nécessaire.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Langfuse. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Langfuse. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives et oblige tout le monde à se reconnecter immédiatement. |
| `SALT` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation invalide définitivement toutes les clés d'API existantes — chaque client SDK qui les utilise reçoit `401` jusqu'à l'émission de nouvelles clés. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données de traces. |
| `application_version` | `2` (branche v2) | Critique | Un tag v3 oriente le build vers une image qui nécessite ClickHouse + Redis + S3, que ce module ne provisionne pas — le pod ne démarre pas. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans sauvegarde valide fait échouer le job d'import. |
| `container_resources.memory_limit` | `4Gi` (≥ 2Gi) | Élevé | En dessous de 2 GiB, Langfuse est arrêté pour dépassement de mémoire (OOM) pendant les migrations du premier démarrage ou sous charge d'ingestion. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions de l'interface peuvent passer d'un pod à l'autre. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. Conserver 1 garantit que l'ingestion est toujours disponible. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `AUTH_DISABLE_SIGNUP` (injecté automatiquement à `"false"`) | Désactiver après le premier propriétaire | Élevé | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `enable_iap` | uniquement lorsque l'ingestion par SDK n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion de traces par les SDK. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de rétention liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique,
entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Langfuse
partagée avec la variante Cloud Run est décrite dans **[Langfuse_Common](Langfuse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Langfuse sur GKE Autopilot](../labs/Langfuse_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Langfuse Common — Configuration applicative partagée](Langfuse_Common.md) — la configuration partagée par les deux cibles de déploiement.
