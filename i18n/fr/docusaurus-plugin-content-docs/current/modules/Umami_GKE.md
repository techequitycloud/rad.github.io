---
title: "Module Umami GKE — Guide de configuration"
description: "Référence de configuration pour déployer Umami sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Umami_GKE.md @ 3055034 sha256:4d382d648c20 -->

# Module Umami GKE — Guide de configuration {#umami-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_GKE.png" alt="Module Umami GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Umami_GKE`. `Umami_GKE` est un **module wrapper** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration applicative partagée [`Umami_Common`](./Umami_Common) pour déployer la plateforme d'analyse web respectueuse de la vie privée [Umami](https://umami.is/) sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Umami GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seuls les variables et les valeurs par défaut **propres à Umami** sont décrits en détail ici.

> **Remarque :** les variables signalées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`. Consultez les sections correspondantes du [guide de configuration App_GKE](./App_GKE.md) pour la documentation complète.

| Domaine de configuration | Section de App GKE.md | Remarques propres à Umami |
|---|---|---|
| Projet et identité | §2 IAM & Access Control | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Umami ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Umami pour `container_port`, `cpu_limit`, `memory_limit` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Core Service Configuration | `APP_SECRET` généré automatiquement ; `DATABASE_URL` assemblée à l'exécution ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et règles de réseau | §3.D Networking & Network Policies | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Initialization Jobs & CronJobs | Job `db-init` fourni automatiquement par `Umami Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Additional Services | Identique. |
| Stockage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` vaut `false` par défaut — Umami est sans état et n'a besoin d'aucun système de fichiers partagé. |
| Stockage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Aucun bucket de stockage provisionné par défaut ; voir [Groupe 14 : Cloud Storage](#group-14-cloud-storage). |
| Configuration de la base de données | §3.B Database (Cloud SQL) | **PostgreSQL obligatoire** ; voir [Groupe 16 : Configuration de la base de données](#group-16-database-configuration). |
| Planification et conservation des sauvegardes | §3.B Database (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Initialization Jobs & CronJobs | Identique. |
| Observabilité et contrôles de santé | §3.A Compute (GKE Autopilot) | Point de terminaison de santé `/api/heartbeat` ; voir [Groupe 10 : Observabilité et santé](#group-10-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Binary Authorization | §4.C Binary Authorization | Identique. |
| VPC Service Controls | §4.D VPC Service Controls | Identique. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Toujours activé — aucune configuration requise. |
| Trafic et entrée | §5 Traffic & Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Static IP Reservation | Voir [Groupe 19 : Domaine personnalisé et IP statique](#group-19-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Cloud Build Triggers | Identique. |
| Pipeline Cloud Deploy | §6.B Cloud Deploy Pipeline | Identique. |
| Mise en miroir des images | §6.C Image Mirroring | Activée par défaut pour éviter les limites de débit de GitHub Container Registry. |
| Budgets d'interruption de pods | §7.A Pod Disruption Budgets | Identique. |
| Contraintes de répartition topologique | §7.B Topology Spread Constraints | Identique. |
| Quotas de ressources | §7.C Resource Quotas | Identique. |
| Rotation automatique des mots de passe | §7.D Auto Password Rotation | Voir [Groupe 16 : Configuration de la base de données](#group-16-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | Redis non raccordé — Umami n'en a pas besoin ; voir [Groupe : Cache Redis](#redis-cache). |
| Import de sauvegarde | §8.B Backup Import | Voir [Groupe 21 : Import de sauvegarde](#group-21-backup-import). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Services multiclusters | §8.D Multi-Cluster Services (MCS) | Identique. |

---

## Relation entre Umami GKE et App GKE {#how-umami-gke-relates-to-app-gke}

`Umami GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Umami Common` qui fournit les valeurs par défaut et la configuration applicative propres à Umami. Les principaux effets sont les suivants :

1. **PostgreSQL est obligatoire.** Umami nécessite PostgreSQL pour le stockage de toutes ses données. La valeur par défaut de `database_type` est `"POSTGRES"` (l'option PostgreSQL générique).
2. **`DATABASE_URL` est assemblée à l'exécution.** Le point d'entrée personnalisé d'Umami construit `DATABASE_URL` à partir des variables DB_* injectées par la plateforme. Cela évite de stocker une chaîne de connexion en clair dans les variables d'environnement ou dans l'état Terraform.
3. **`APP_SECRET` est généré automatiquement.** `Umami Common` génère un secret alphanumérique de 32 caractères et le stocke dans Secret Manager. Il est injecté dans le pod sous le nom `APP_SECRET`.
4. **Aucun bucket de stockage n'est provisionné par défaut.** Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. `storage_buckets` est par défaut une liste vide.
5. **Un job `db-init` s'exécute lors du premier déploiement.** `Umami Common` fournit un Job Kubernetes `db-init` par défaut qui pré-crée la base de données PostgreSQL et l'utilisateur d'Umami. Umami exécute ensuite ses propres migrations Prisma au démarrage.
6. **Les ressources par défaut sont dimensionnées pour Umami.** Les valeurs par défaut de `cpu_limit` (1 vCPU) et de `memory_limit` (512Mi) reflètent l'empreinte légère d'Umami.
7. **Les sondes de santé ciblent `/api/heartbeat`.** Il s'agit du point de terminaison de santé dédié d'Umami, et non d'un chemin racine générique.
8. **Redis n'est pas utilisé.** Umami stocke tout dans PostgreSQL ; le module ne raccorde aucune connexion Redis (la déclaration miroir `enable_redis` n'est pas transmise au module socle).
9. **La mise en miroir des images est activée par défaut.** Umami est distribué via GitHub Container Registry (`ghcr.io`). Le module met en miroir l'image dans Artifact Registry pour éviter les limites de débit en production.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#2-iam--access-control).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | ID du projet GCP. **Obligatoire.** |
| `region` | `"us-central1"` | Région GCP pour Cloud SQL, GCS et les autres ressources. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot) pour leur description.

**Valeurs par défaut propres à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"umami"` | `"gkeapp"` | Sert de nom de base à toutes les ressources GCP et Kubernetes. **Ne la modifiez pas après le déploiement.** |
| `application_display_name` | `"Umami"` | `"App GKE Application"` | Affiché dans l'interface et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `application_description` | `"Umami Analytics on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"postgresql-latest"` | `"1.0.0"` | La version d'Umami à construire et à déployer. Doit utiliser un tag préfixé par `postgresql-`. |
| `deploy_application` | `true` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure associée sans déployer la charge de travail Umami. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE, groupe 3](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut et comportement propres à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Port Next.js natif d'Umami. Ne le modifiez pas, sauf si votre Dockerfile personnalisé lie Umami à un autre port. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Mêmes valeurs par défaut — Umami est léger. Augmentez `memory_limit` à `1Gi` pour des tableaux de bord d'analyse à fort trafic. |
| `min_instance_count` | `1` | variable | Par défaut, GKE maintient au minimum 1 pod. Définissez une valeur plus élevée pour les déploiements en haute disponibilité. |
| `max_instance_count` | `10` | `3` | Umami se met à l'échelle horizontalement en toute sécurité — tout l'état réside dans PostgreSQL, ce qui permet de nombreuses instances simultanées. |
| `container_image_source` | `"custom"` | `"custom"` | Le mode `custom` construit une image wrapper qui assemble `DATABASE_URL` à partir des variables DB_*. Ne définissez `"prebuilt"` que si vous fournissez `DATABASE_URL` manuellement. |
| `enable_cloudsql_volume` | `true` | `true` | Sidecar Cloud SQL Auth Proxy. Nécessaire pour qu'Umami se connecte à Cloud SQL via un socket Unix. |
| `workload_type` | `"Deployment"` | `"Deployment"` | Umami est sans état — `Deployment` est le type de charge de travail approprié. N'utilisez pas `StatefulSet`, sauf si vous attachez un stockage local persistant pour un cas d'usage non standard. |

**`enable_vertical_pod_autoscaling` :** vaut `false` par défaut. Activez-le pour permettre à GKE Autopilot de redimensionner automatiquement les pods Umami en fonction de l'utilisation observée des ressources. Utile pour optimiser les coûts en production.

Les autres variables d'exécution (`enable_image_mirroring`, `container_build_config`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`, `termination_grace_period_seconds`, `deployment_timeout`) se comportent comme décrit dans [App_GKE, groupe 3](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE](./App_GKE.md#4-advanced-security), [App_GKE](./App_GKE.md#5-traffic--ingress) et [App_GKE](./App_GKE.md#d-networking--network-policies).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés via IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration d'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration d'IAP. |
| `iap_support_email` | `""` | Adresse e-mail d'assistance affichée sur l'écran de consentement OAuth de Google. |
| `enable_cloud_armor` | `false` | Associe une règle de sécurité Cloud Armor au backend de l'Ingress GKE. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées par Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la règle de sécurité Cloud Armor à associer. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre VPC Service Controls. |
| `network_name` | `""` | Nom du réseau VPC. Laissez vide pour une détection automatique. |
| `network_tags` | `[]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. |
| `enable_network_segmentation` | `false` | Applique des règles Kubernetes NetworkPolicy pour restreindre le trafic entre pods. |

**Remarque sur IAP pour Umami :** IAP protège le tableau de bord d'analyse d'Umami. Si vous appliquez IAP, notez que le point de terminaison du script de suivi (`/script.js`) et celui de collecte des événements (`/api/send`) doivent rester accessibles publiquement pour que les sites web suivis puissent transmettre leurs données. Réfléchissez soigneusement à l'architecture de routage si vous restreignez l'accès.

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE](./App_GKE.md#3-core-service-configuration).

**Comportement propre à Umami :**

`Umami Common` génère `APP_SECRET` et l'injecte comme variable d'environnement `APP_SECRET`. Aucune valeur SMTP par défaut n'est préremplie — Umami n'envoie pas d'e-mails nativement.

Utilisez `environment_variables` pour les options de configuration d'Umami :

```hcl
environment_variables = {
  DISABLE_TELEMETRY = "1"    # Disable Umami's anonymous telemetry reporting
  TRACKER_SCRIPT_NAME = "analytics.js"  # Rename tracking script to avoid ad blockers
  ALLOWED_FRAME_URLS = "https://example.com"  # Allow Umami to be embedded in iframes
}
```

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en clair injectées dans le pod à l'exécution. |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées comme variables d'environnement. |
| `secret_rotation_period` | `'2592000s'` | Période de rotation des secrets Secret Manager (30 jours). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

---

## Groupe 6 : Cluster GKE {#group-6-gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE Autopilot cible. Laissez vide pour une détection automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement à partir de `application_name` et `tenant_id` s'il est vide. |
| `service_type` | `"LoadBalancer"` | Type de Service Kubernetes. `"LoadBalancer"` (la valeur par défaut) expose Umami directement sur une IP externe ; utilisez `"ClusterIP"` pour un accès uniquement interne derrière un Ingress. |
| `session_affinity` | `"None"` | Mode d'affinité de session. `"None"` convient à Umami — tout l'état réside dans PostgreSQL, si bien que n'importe quel pod peut traiter n'importe quelle requête. |
| `enable_multi_cluster_service` | `false` | Enregistre le service auprès de GKE Multi Cluster Services. |
| `configure_service_mesh` | `false` | Injecte des proxys sidecar Anthos Service Mesh (Istio). |
| `termination_grace_period_seconds` | `30` | Nombre de secondes pendant lesquelles Kubernetes attend l'arrêt du pod avant de le forcer. |
| `deployment_timeout` | `600` | Nombre maximal de secondes d'attente pour que le déploiement GKE atteigne un état sain. |
| `gke_cluster_selection_mode` | `"primary"` | Stratégie de choix du cluster cible. |

---

## Groupe 7 : Sauvegarde et maintenance {#group-7-backup--maintenance}

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez selon votre fenêtre de maintenance préférée. |
| `backup_retention_days` | `7` | Conservation de 7 jours. Augmentez cette valeur pour les déploiements de production (30 à 90 jours recommandés). |

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs), avec un comportement important propre à Umami.

**Job `db-init` par défaut d'Umami :**

Lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide `[]`), `Umami Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image cliente PostgreSQL |
| Rôle | Pré-crée la base de données PostgreSQL et l'utilisateur d'Umami avant qu'Umami n'exécute ses propres migrations Prisma |
| Exécution à chaque apply | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |

Remplacez `initialization_jobs` par une liste non vide pour substituer vos propres jobs à ce job par défaut. Chaque job personnalisé doit spécifier au moins l'un des éléments `command`, `args` ou `script_path`.

**CronJobs :** les variables `cron_jobs` et `additional_services` sont disponibles et se comportent de la même manière que dans `App_GKE`. Utilisez `cron_jobs` pour des tâches comme des exports réguliers des données d'analyse ou la maintenance de la base de données.

> **Remarque :** le schéma `cron_jobs` de `Umami GKE` utilise les champs des CronJobs Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`.

---

## Groupe 9 : Règles de fiabilité {#group-9-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#7-reliability--scheduling).

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut. Empêche l'éviction simultanée de tous les pods Umami pendant la maintenance du cluster. |
| `pdb_min_available` | `"1"` | Au moins un pod Umami doit rester disponible pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | À activer pour les déploiements en haute disponibilité afin de répartir les pods entre les zones. |
| `topology_spread_strict` | `false` | Lorsque `true`, utilise la contrainte de répartition `DoNotSchedule`. |

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

Ces variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Point de terminaison de santé d'Umami :** Umami expose `/api/heartbeat` comme point de terminaison de santé dédié. Ce point de terminaison renvoie HTTP 200 lorsqu'Umami est en cours d'exécution et connecté à PostgreSQL. Toutes les configurations de sondes par défaut utilisent ce chemin.

| Variable | Valeur par défaut Umami GKE | Remarques |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | Le `failure_threshold` élevé tient compte des migrations Prisma du premier démarrage. |
| `health_check_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Sonde de vivacité (liveness) — redémarre les pods défaillants. |
| `uptime_check_config` | `{ enabled=false, path="/api/heartbeat" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte personnalisées sur les métriques Cloud Monitoring. |

**Remarque sur la sonde de démarrage :** un `failure_threshold = 30` associé à `period_seconds = 10` laisse à Umami jusqu'à 5 minutes (plus le délai initial de 30 secondes) pour terminer son démarrage et exécuter les migrations Prisma sur une base de données neuve. Lors des redémarrages suivants (migrations déjà appliquées), le démarrage est beaucoup plus rapide.

---

## Groupe 11 : Automatisation des charges de travail (jobs) {#group-11-workload-automation-jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes à exécuter avant le démarrage de l'application Umami. Laissez vide pour que `Umami Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | `[]` | Ressources Kubernetes CronJob récurrentes. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés à côté du conteneur Umami principal. |

---

## Groupe 12 : CI/CD et intégration GitHub {#group-12-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#6-cicd--delivery).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | `""` | Jeton d'accès personnel GitHub. Sensible. |
| `github_app_installation_id` | `""` | ID d'installation de la GitHub App. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | `false` | Bascule vers un pipeline Google Cloud Deploy géré. |
| `cloud_deploy_stages` | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. |
| `enable_binary_authorization` | `false` | Applique la règle Binary Authorization sur le cluster GKE. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Mode d'application de Binary Authorization. Non référencée. |

---

## Groupe 13 : NFS {#group-13-nfs}

Umami n'a pas besoin de NFS. `enable_nfs` vaut `false` par défaut. Toutes les données d'Umami sont stockées dans PostgreSQL.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne une instance Cloud Filestore (NFS). Non requis pour Umami. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage NFS dans le conteneur. Utilisé uniquement lorsque `enable_nfs = true`. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Détecté automatiquement s'il est vide. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base d'une VM GCE NFS intégrée (créée par le module). |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |

---

## Groupe 14 : Cloud Storage {#group-14-cloud-storage}

Umami n'a pas besoin de buckets GCS. `storage_buckets` est par défaut une liste vide.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Détermine si le module provisionne les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Configurations des buckets GCS. Vide par défaut — Umami est sans état. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` | `false` | Crée un trousseau de clés KMS CMEK pour les buckets GCS. |
| `enable_artifact_registry_cmek` | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | `30` | Nombre de jours après lesquels les images deviennent supprimables. |

---

## Groupe 16 : Configuration de la base de données {#group-16-database-configuration}

Ces variables se comportent de la même manière que dans `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut et restrictions propres à Umami :**

| Variable | Valeur par défaut Umami GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | `"POSTGRES"` | Umami nécessite PostgreSQL. Ne la remplacez pas par MySQL ou NONE. |
| `application_database_name` | `"umami"` | `"gkeappdb"` | **Ne la modifiez pas après le déploiement** — une modification recrée la base de données et détruit toutes les données d'analyse. |
| `application_database_user` | `"umami"` | `"gkeappuser"` | **Ne la modifiez pas après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe généré automatiquement. Plage : 16 à 64. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods. |

**Extensions PostgreSQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple, `['uuid-ossp', 'pg_trgm']`). |

---

## Groupe 19 : Domaine personnalisé et IP statique {#group-19-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#5-traffic--ingress).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Kubernetes Ingress pour le routage des domaines personnalisés. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple, `["analytics.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé pour les déploiements de production. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Généré automatiquement s'il est vide. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |
| `network_tags` | `[]` | Tags réseau de pare-feu VPC appliqués aux nœuds GKE. |
| `network_name` | `""` | Nom du réseau VPC. Détecté automatiquement s'il est vide. |

---

## Groupe 21 : Import de sauvegarde {#group-21-backup-import}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Déclenche un job ponctuel d'import de la base de données pendant le déploiement. |
| `backup_source` | `"gcs"` | Source du fichier de sauvegarde : `"gcs"` ou `"gdrive"`. |
| `backup_file` | `"backup.sql"` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | `"sql"` | Format de la sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 8 : Quota de ressources {#group-8-resource-quota}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#c-resource-quotas).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. |
| `quota_cpu_requests` | `""` | Total des requêtes de CPU autorisées dans l'espace de noms. |
| `quota_cpu_limits` | `""` | Total des limites de CPU autorisées dans l'espace de noms. |
| `quota_memory_requests` | `""` | Total des requêtes de mémoire. **Doit utiliser des suffixes d'unités binaires** (par exemple, `"4Gi"`, `"8192Mi"`). |
| `quota_memory_limits` | `""` | Total des limites de mémoire. **Doit utiliser des suffixes d'unités binaires.** |

> **Avertissement :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers nus (par exemple, `"4"`) sont interprétés comme des octets par Kubernetes et bloquent toute planification de pods avec une erreur de dépassement de quota.

---

## Cache Redis {#redis-cache}

Umami n'utilise pas Redis — il stocke toutes les données d'analyse directement dans PostgreSQL, sans couche de cache. La variable `enable_redis` n'est déclarée dans `Umami_GKE` que pour satisfaire la mise en miroir des variables du module socle ; elle **n'est pas transmise** à l'appel `App_GKE`, si bien que la modifier n'a aucun effet.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Déclaration inerte (mise en miroir du module socle uniquement) — non transmise à `App_GKE`, si bien qu'aucune variable d'environnement Redis n'est injectée, quelle que soit sa valeur. |

Si vous avez besoin de Redis pour une intégration personnalisée ou un service adjacent, utilisez `additional_services` pour déployer un sidecar Redis, ou configurez Memorystore indépendamment.

---

## Groupe 22 : VPC Service Controls {#group-22-vpc-service-controls}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique des périmètres VPC Service Controls autour des API GCP. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | `true` | Journalise les violations sans les bloquer. |
| `organization_id` | `""` | ID de l'organisation GCP pour VPC-SC. Détecté automatiquement s'il est vide. |
| `enable_audit_logging` | `false` | Active les journaux Cloud Audit Logs détaillés. |

---

## Explorer avec la console GCP {#exploring-with-the-gcp-console}

Après un déploiement réussi, explorez l'installation Umami dans la console GCP :

**Charge de travail GKE :**
Accédez à **Kubernetes Engine → Workloads**. Repérez le Deployment nommé d'après vos `application_name` et `tenant_id`. Cliquez dessus pour afficher :
- L'état des pods, le nombre de redémarrages et leur ancienneté.
- L'onglet **Logs** — diffuse les journaux des conteneurs des pods Umami en cours d'exécution.
- L'onglet **Details** — affiche la spécification du Deployment, les limites de ressources, la configuration des sondes et les variables d'environnement (non sensibles).
- **Revision history** — liste les ReplicaSets précédents.

**Services et Ingress GKE :**
Accédez à **Kubernetes Engine → Services & Ingress**. Repérez le Service de votre déploiement Umami. Consultez :
- L'adresse IP externe (si `service_type = "LoadBalancer"` ou `reserve_static_ip = true`).
- Les correspondances de ports.
- L'état du contrôle de santé de l'équilibreur de charge.

**Instance Cloud SQL :**
Accédez à **SQL**. Repérez l'instance nommée `app-sql-<deployment_id>`. Explorez :
- **Overview** — nom de connexion, version de PostgreSQL, utilisation du stockage.
- **Databases** — la base de données `umami` avec toutes les tables d'analyse.
- **Users** — l'utilisateur applicatif `umami`.
- **Operations** — l'historique des maintenances, basculements et sauvegardes.

**Secret Manager :**
Accédez à **Security → Secret Manager**. Repérez le secret `secret-<tenant_resource_prefix>-<application_name>-app-secret` (injecté sous le nom `APP_SECRET`) de ce déploiement. Cliquez dessus pour afficher :
- Les versions du secret et leurs horodatages de création.
- Le journal d'accès indiquant quand les pods GKE ont lu le secret.
- La configuration de rotation.

**Artifact Registry :**
Accédez à **Artifact Registry**. Repérez le dépôt de ce déploiement. Consultez les images Umami répliquées depuis GitHub Container Registry, leurs tags et la règle de conservation.

**Cloud Monitoring :**
Si `uptime_check_config.enabled = true` a été défini, accédez à **Monitoring → Uptime checks** pour consulter les résultats du test de disponibilité `/api/heartbeat` dans les différentes régions GCP. Accédez à **Monitoring → Dashboards** pour trouver le tableau de bord GKE provisionné automatiquement, avec les métriques de CPU, de mémoire et de requêtes.

---

## Explorer avec gcloud et kubectl {#exploring-with-gcloud-and-kubectl}

Utilisez ces commandes pour inspecter le déploiement Umami GKE. Remplacez `PROJECT_ID`, `CLUSTER_NAME`, `REGION`, `NAMESPACE` et `DEPLOYMENT_NAME` par vos valeurs.

```bash
# Get GKE cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List pods in the Umami namespace
kubectl get pods -n NAMESPACE

# Describe the Umami deployment
kubectl describe deployment DEPLOYMENT_NAME -n NAMESPACE

# View Umami pod logs
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME --tail=100

# Follow live logs from all Umami pods
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME -f

# Check resource usage across Umami pods
kubectl top pods -n NAMESPACE

# Check HPA status (horizontal pod autoscaling)
kubectl get hpa -n NAMESPACE

# Describe the Kubernetes Service
kubectl get service -n NAMESPACE
kubectl describe service SERVICE_NAME -n NAMESPACE

# Check pod environment variables (non-sensitive)
kubectl exec -n NAMESPACE POD_NAME -- env | grep -v PASSWORD | grep -v SECRET

# Test health endpoint from inside a pod
kubectl exec -n NAMESPACE POD_NAME -- \
  wget -qO- http://localhost:3000/api/heartbeat

# Check Cloud SQL instance
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.tier)"

# List databases
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# Check Secret Manager secrets
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime)"

# List Artifact Registry images
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Check Kubernetes namespace resource quota (if enabled)
kubectl describe resourcequota -n NAMESPACE

# View PodDisruptionBudget
kubectl get pdb -n NAMESPACE

# Check recent Kubernetes events for the namespace
kubectl get events -n NAMESPACE --sort-by='.metadata.creationTimestamp' | tail -20

# Check Cloud Monitoring uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"
```

---

## Sorties du module {#module-outputs}

`Umami GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `service_url` | URL externe de l'équilibreur de charge GKE. |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement. |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (vide pour Umami). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré (créé par le module) — relancez l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES"` | **Critique** | Umami nécessite PostgreSQL. Choisir MySQL ou NONE fait échouer l'assemblage de DATABASE_URL, et Umami ne peut pas se connecter à la base de données. |
| `application_database_name` | `"umami"` | **Critique** | La modifier après le déploiement initial détruit toutes les données d'analyse collectées. La base de données est recréée vide, tandis que les anciennes données restent orphelines dans Cloud SQL. |
| `application_database_user` | `"umami"` | **Critique** | La modifier après le déploiement initial recrée l'utilisateur Cloud SQL, ce qui invalide les identifiants et rompt toute connectivité à la base de données. |
| `container_port` | `3000` | **Critique** | Umami écoute sur le port 3000. Une valeur différente fait échouer toutes les sondes de santé et provoque le redémarrage continu du pod par Kubernetes. |
| `container_image_source` | `"custom"` | **Élevé** | L'image officielle d'Umami n'accepte pas les variables DB_* individuelles — elle exige une `DATABASE_URL` complète. Utiliser `"prebuilt"` sans définir manuellement `DATABASE_URL` dans `environment_variables` fait échouer Umami au démarrage avec une erreur de connexion à la base de données manquante. |
| `application_version` | `"postgresql-latest"` | **Élevé** | Doit utiliser un tag préfixé par `postgresql-`. Les tags simples (par exemple, `latest`) n'existent pas pour la variante PostgreSQL d'Umami. Un tag invalide fait échouer le téléchargement de l'image du conteneur. |
| `admin_password` | _(à modifier à la première connexion)_ | **Critique** | Les identifiants par défaut (`admin` / `umami`) sont publiquement connus. Les laisser inchangés expose le tableau de bord d'analyse et toutes les données suivies à quiconque connaît l'URL du service. |
| `container_resources.memory_limit` | `"512Mi"` | **Moyen** | 512Mi suffisent pour un trafic faible à modéré. En cas d'utilisation simultanée intensive du tableau de bord ou de requêtes d'analyse complexes, Umami peut manquer de mémoire (OOM). Passez à `1Gi` si une pression mémoire est observée. |
| `enable_cloudsql_volume` | `true` | **Critique** | Umami se connecte à Cloud SQL via le socket Unix de l'Auth Proxy. Le désactiver supprime le socket, ce qui fait échouer toutes les connexions à la base de données. |
| `startup_probe_config.failure_threshold` | `30` | **Élevé** | Avec `period_seconds = 10`, un `failure_threshold` de 30 laisse à Umami jusqu'à 5 minutes pour démarrer et exécuter les migrations Prisma. Le réduire en dessous de 10 peut amener Kubernetes à redémarrer le pod avant la fin des migrations, créant une boucle de redémarrage sur les nouveaux déploiements. |
| `session_affinity` | `"None"` | **Faible** | Umami est entièrement sans état — aucune affinité de session n'est requise. Toutes les requêtes peuvent être traitées par n'importe quel pod sans problème de cohérence. |
| `min_instance_count` | `1` | **Moyen** | Au moins un pod Umami doit toujours être en cours d'exécution pour que les données d'analyse soient collectées. Une mise à l'échelle à zéro provoquerait des trous dans les données pendant les périodes sans trafic sur le tableau de bord. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers nus sont interprétés comme des octets, ce qui bloque toute planification de pods avec une erreur de dépassement de quota. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé par défaut. Le désactiver permet l'arrêt simultané de tous les pods pendant les mises à niveau de nœuds GKE Autopilot, provoquant de brèves interruptions de service. |
| `backup_retention_days` | `7` | **Moyen** | Une perte de données d'analyse est difficile à rattraper. Passez à 30 jours ou plus pour les déploiements de production où l'historique des données d'analyse a une valeur métier. |
| `enable_backup_import` | `false` | **Élevé** | Le définir sur `true` déclenche une restauration de la base de données à chaque apply. Ne l'activez que pour la migration initiale depuis une instance Umami existante ; repassez-le à `false` immédiatement après. |
| `enable_vpc_sc` | `false` | **Moyen** | Le périmètre VPC-SC n'est actif que si `organization_id` est également défini. Sans les deux, `enable_vpc_sc = true` n'a aucun effet d'application. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Umami sur GKE Autopilot](../labs/Umami_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Umami sur Google Cloud Run](Umami_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Umami Common](Umami_Common.md) — la configuration partagée par les deux cibles de déploiement.
