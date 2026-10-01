---
title: "n8n sur GKE Autopilot"
description: "Référence de configuration pour déployer n8n sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/N8N_GKE.md @ 3055034 sha256:29eca874cda2 -->

# n8n sur GKE Autopilot {#n8n-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_GKE.png" alt="n8n sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme d'automatisation de workflows « fair-code » qui connecte des API, des
bases de données et des services grâce à un éditeur visuel de nœuds. Ce module déploie n8n sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par n8n et sur la manière de les explorer
et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle
automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

n8n s'exécute comme une charge de travail Node.js. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — n8n utilise PostgreSQL pour toutes les données de workflows et d'identifiants |
| Fichiers partagés | Filestore (NFS) | Données de fichiers binaires partagées entre tous les réplicas ; sert aussi de point de terminaison Redis par défaut |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié |
| File d'attente et coordination | Redis | Activé par défaut ; active le mode file d'attente de n8n pour la mise à l'échelle horizontale |
| Secrets | Secret Manager | Clé de chiffrement générée automatiquement et valeur provisoire du mot de passe SMTP |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé ; choisir un autre
  moteur ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Le mode file d'attente permet à plusieurs réplicas n8n de se
  répartir l'exécution des workflows. Sans Redis, un seul réplica peut traiter les workflows de
  manière fiable.
- **La clé de chiffrement est irremplaçable.** `N8N_ENCRYPTION_KEY` est générée une seule fois
  et stockée dans Secret Manager. Tous les identifiants des workflows sont chiffrés avec elle.
  Si la clé fait l'objet d'une rotation ou est supprimée, chaque identifiant enregistré devient
  définitivement illisible.
- **L'affinité de session est `ClientIP`.** L'éditeur utilise des WebSockets ; les requêtes
  d'un navigateur sont donc attachées à un même pod.
- **`WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont prédéfinis** sur l'URL attendue du service
  avant le déploiement afin que les webhooks se résolvent correctement dès le premier démarrage.
- Le secret du **mot de passe SMTP** est initialisé avec une valeur factice ; mettez-le à jour
  dans Secret Manager avant de configurer l'envoi d'e-mails.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail n8n {#a-gke-autopilot--the-n8n-workload}

Les pods n8n sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres minimal et maximal de réplicas. L'affinité de session attache les sessions de l'éditeur
à un seul pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail n8n pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de workflows, l'historique des exécutions et les identifiants
chiffrés dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent en privé via
le sidecar **Cloud SQL Auth Proxy**, par un socket Unix ; aucune IP publique n'est donc exposée.
Le script `entrypoint.sh` convertit à l'exécution les variables `DB_*` injectées par la
plateforme en variables natives n8n `DB_POSTGRESDB_*`. Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez
[App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les fichiers binaires téléversés vers les workflows ou produits par eux sont écrits sur un
partage **Filestore (NFS)** monté dans chaque pod, afin que tous les réplicas voient les mêmes
données (`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). L'IP de l'hôte NFS sert aussi de point de
terminaison Redis par défaut lorsqu'aucun `redis_host` explicite n'est configuré. Un bucket
**Cloud Storage** dédié est provisionné pour une persistance plus large des données.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le
  bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. File d'attente Redis {#d-redis-queue}

Redis active le mode file d'attente de n8n, qui répartit les exécutions de workflows entre
plusieurs réplicas à l'aide de Bull. En mode file d'attente, une ou plusieurs instances
« worker » récupèrent les exécutions dans la file tandis que l'instance principale gère
l'éditeur et l'enregistrement des webhooks. Lorsqu'aucun hôte Redis externe n'est configuré et
que NFS est activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

La clé de chiffrement de n8n et la valeur provisoire du mot de passe SMTP sont stockées comme
secrets Secret Manager et injectées dans les pods à l'exécution ; aucune valeur en clair
n'apparaît dans la configuration. Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [Sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique
peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et
l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

La sortie stdout/stderr des pods est envoyée à Cloud Logging ; les métriques GKE et Cloud SQL
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs
sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application n8n {#3-n8n-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation
  (`db-init`) utilise `postgres:15-alpine` pour créer la base de données et l'utilisateur n8n et
  accorder les privilèges avant le démarrage de l'application. Il est idempotent et peut être
  relancé sans risque.
- **Conversion des variables d'environnement.** `entrypoint.sh` fait correspondre `DB_HOST`,
  `DB_NAME`, `DB_USER` et `DB_PASSWORD` (injectés par la plateforme) à leurs équivalents
  natifs n8n `DB_POSTGRESDB_*` au démarrage du conteneur. Le chemin du socket du Cloud SQL Auth
  Proxy est réécrit en un lien symbolique que les pilotes PostgreSQL peuvent localiser.
- **Fonctionnement en mode file d'attente.** Avec `enable_redis = true` (valeur par défaut),
  n8n démarre en mode file d'attente. Le pod principal gère l'enregistrement des webhooks,
  l'interface de l'éditeur et la coordination des exécutions ; les réplicas supplémentaires
  servent de workers qui prennent les tâches dans la file Bull.
- **Stabilité de l'URL des webhooks.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur
  l'URL prévue du service avant le déploiement. Si l'IP externe ou le domaine personnalisé
  change, ces valeurs doivent être mises à jour et la charge de travail redéployée.
- **Stockage des données binaires.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` indique à n8n
  d'écrire les fichiers binaires (pièces jointes, téléchargements) sur le système de fichiers
  monté en NFS plutôt que dans la base de données, ce qui est requis pour les déploiements
  multi-réplicas.
- **Chemin de santé.** Les sondes de disponibilité et de vivacité ciblent la racine de n8n
  (`/`), qui ne renvoie HTTP 200 qu'une fois l'application et la connexion à la base de données
  entièrement initialisées. La sonde de démarrage accorde 120 secondes à la configuration du
  premier démarrage.
- **Caractère critique de la clé de chiffrement.** `N8N_ENCRYPTION_KEY` chiffre tous les
  identifiants des workflows stockés dans la base de données. La clé est générée une seule
  fois ; si elle change, tous les identifiants enregistrés (clés d'API, mots de passe, jetons)
  deviennent définitivement illisibles.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à n8n ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par
défaut standard.

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
| `application_name` | `n8n` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `N8N Workflow Automation` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémentez-le pour déployer une nouvelle version. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour l'exécution des workflows n8n. |
| `memory_limit` | `4Gi` | Mémoire par pod. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour que les workflows en file d'attente aient toujours un worker. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `5678` | n8n écoute sur le port 5678. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Dupliquer l'image n8n dans Artifact Registry avant le déploiement. |
| `timeout_seconds` | `300` | Durée maximale d'une requête, en secondes. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Valeurs SMTP provisoires par défaut | Paramètres supplémentaires non secrets. Les valeurs principales `N8N_*` et `DB_TYPE` sont définies automatiquement. La correspondance par défaut inclut `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` et `EMAIL_FROM` sous forme de valeurs vides ou provisoires, prêtes à être remplacées par de vrais identifiants. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager (~30 jours). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions WebSocket de l'éditeur n8n. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Laissez vide pour une génération automatique. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles de PVC dans le StatefulSet. La valeur `true` sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /` | Les sondes ciblent la racine de n8n. La sonde de démarrage accorde un délai initial de 120 s. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Objets de sonde structurés transmis au socle. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job de configuration de base de données `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs planifiés. Le planificateur intégré de n8n gère les déclencheurs de workflows ; utilisez-les pour des opérations externes (scripts de maintenance, tâches de données personnalisées). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de n8n. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de fichiers binaires (à garder activé en multi-réplicas). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM GCE NFS intégrée lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — File d'attente Redis {#group-15--redis-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour l'exécution des workflows en mode file d'attente. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS ; définissez-le explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `n8n_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une Gateway pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant n8n. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre n8n. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | _(générée automatiquement, ne jamais effectuer de rotation)_ | Critique | La rotation ou la suppression de cette clé détruit définitivement tous les identifiants de workflows enregistrés. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données des workflows. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les fichiers binaires ne sont pas partagés entre les réplicas et le mode binaire `filesystem` échoue. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_redis` | `true` | Élevé | Sans le mode file d'attente Redis, exécuter plus d'un réplica provoque des conflits d'exécution des workflows. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison valide si Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions WebSocket de l'éditeur sont interrompues lorsqu'elles sont routées vers un autre pod. |
| `min_instance_count` | `1` | Élevé | `0` laisse les workflows en file d'attente sans worker pour les prendre en charge. |
| `memory_limit` | `4Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM lors de l'exécution de gros lots de workflows. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sinon, l'éditeur n8n est accessible publiquement et expose tous les identifiants enregistrés. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

> **Remarque :** `enable_resource_quota` et les variables `quota_*` (Groupe 8) sont
> déclarées dans `N8N_GKE/variables.tf` pour respecter la convention de duplication du dépôt,
> mais ne sont jamais transmises à `App_GKE` dans `main.tf`/`n8n.tf` — la description de chaque
> variable indique qu'elle n'a aucun effet sur le déploiement dans ce module. Elles ne
> présentent ici aucun risque opérationnel.

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à n8n partagée avec la variante
Cloud Run est décrite dans **[N8N_Common](N8N_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : N8N sur GKE Autopilot](../labs/N8N_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [n8n sur Google Cloud Run](N8N_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [N8N Common — Configuration applicative partagée](N8N_Common.md) — la configuration partagée par les deux cibles de déploiement.
