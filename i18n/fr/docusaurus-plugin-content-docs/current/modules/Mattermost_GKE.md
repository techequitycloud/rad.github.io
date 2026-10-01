---
title: "Module Mattermost GKE — Guide de configuration"
description: "Référence de configuration pour déployer Mattermost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mattermost_GKE.md @ 3055034 sha256:71c53e139316 -->

# Module Mattermost GKE — Guide de configuration {#mattermost-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mattermost_GKE.png" alt="Module Mattermost GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Mattermost_GKE`. `Mattermost_GKE` est un **module d'encapsulation** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration applicative partagée [`Mattermost_Common`](./Mattermost_Common) pour déployer [Mattermost](https://mattermost.com/) — une plateforme open source et auto-hébergeable de messagerie et de collaboration d'équipe — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Mattermost GKE` correspondent directement aux mêmes options d'`App GKE`. Lorsqu'une variable se comporte de façon identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et valeurs par défaut **propres à Mattermost** sont décrites en détail ici.

> **Remarque :** les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE ou Cloud Run :** Mattermost maintient des connexions WebSocket persistantes pour la distribution des messages en temps réel. GKE Autopilot convient mieux que Cloud Run aux déploiements Mattermost de production, car il prend en charge les connexions de longue durée sans les contraintes de timeout par requête de Cloud Run. Utilisez `Mattermost GKE` pour tout déploiement d'équipe, quelle que soit sa taille, où la fiabilité en temps réel est importante.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`. Consultez les sections correspondantes du [guide de configuration d'App_GKE](./App_GKE.md) pour la documentation complète.

| Domaine de configuration | Section d'App GKE.md | Remarques propres à Mattermost |
|---|---|---|
| Projet et identité | §2 IAM & Access Control | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Mattermost ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Mattermost pour `container_port`, `container_resources` et `min_instance_count` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Core Service Configuration | Aucune variable d'environnement préremplie — Mattermost se configure via `site_url` et `edition` ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et règles réseau | §3.D Networking & Network Policies | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Initialization Jobs & CronJobs | Job PostgreSQL `db-init` fourni automatiquement par `Mattermost Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Additional Services | Identique. |
| Stockage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` vaut `false` par défaut ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Volumes GCS Fuse à privilégier pour `/mattermost/data` ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Database (Cloud SQL) | **PostgreSQL 15 obligatoire** ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Planification et rétention des sauvegardes | §3.B Database (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Initialization Jobs & CronJobs | Identique. |
| Observabilité et contrôles de santé | §3.A Compute (GKE Autopilot) | Mattermost expose `/api/v4/system/ping` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| WAF Cloud Armor | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Binary Authorization | §4.C Binary Authorization | Identique. |
| VPC Service Controls | §4.D VPC Service Controls | Identique. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Toujours activé — aucune configuration requise. |
| Trafic et entrée | §5 Traffic & Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Static IP Reservation | Le `site_url` de Mattermost doit correspondre ; voir [Groupe 16 : Domaine personnalisé et IP statique](#group-16-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Cloud Build Triggers | Identique. |
| Pipeline Cloud Deploy | §6.B Cloud Deploy Pipeline | Identique. |
| Réplication d'images | §6.C Image Mirroring | Identique. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identique. |
| Contraintes de répartition topologique | §7.B Topology Spread Constraints | Identique. |
| Quotas de ressources | §7.C Resource Quotas | Identique. |
| Rotation automatique des mots de passe | §7.D Auto Password Rotation | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` vaut `false` par défaut ; recommandé en multi-réplica ; voir [Groupe 15 : Cache Redis](#group-15-redis-cache). |
| Import de sauvegarde | §8.B Backup Import | Expose à la fois `backup_uri` (URI GCS complet ou ID Drive) et `backup_file` (nom de fichier dans le bucket de sauvegarde du module) ; voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identique. |

---

## Relation entre Mattermost GKE et App GKE {#how-mattermost-gke-relates-to-app-gke}

`Mattermost GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Mattermost Common` qui fournit les valeurs par défaut et la configuration applicative propres à Mattermost. Les principaux effets sont les suivants :

1. **PostgreSQL 15 est obligatoire.** Mattermost nécessite PostgreSQL 13 ou une version ultérieure. La valeur par défaut de `database_type` est `"POSTGRES_15"`.
2. **Un job `db-init` s'exécute lors du premier déploiement.** `Mattermost Common` fournit un Job Kubernetes `db-init` par défaut qui crée la base de données PostgreSQL et l'utilisateur de Mattermost. Mattermost exécute ensuite ses propres migrations de schéma au premier démarrage — aucune mise en place manuelle du schéma n'est nécessaire.
3. **Aucune variable d'environnement préremplie.** Contrairement à Ghost, Mattermost n'a pas besoin que le module injecte des valeurs SMTP par défaut. Les paramètres clés — URL du site, édition, Redis — sont contrôlés par des variables dédiées de premier niveau (`site_url`, `edition`, `enable_redis`).
4. **La sélection de l'édition détermine l'image de conteneur.** Définir `edition = "enterprise"` bascule automatiquement l'image de conteneur vers `mattermost/mattermost-enterprise-edition`. La valeur par défaut (`"team"`) utilise `mattermost/mattermost-team-edition`. L'Enterprise Edition nécessite une clé de licence payante fournie via `environment_variables`.
5. **GCS Fuse est préféré à NFS pour le stockage des fichiers.** `enable_nfs` vaut `false` par défaut. Les fichiers téléversés et les pièces jointes de Mattermost sont stockés sur des volumes GCS montés via le pilote CSI GCS Fuse sur `/mattermost/data`. Cela fournit un stockage durable et sûr en multi-réplica sans provisionner d'instance Filestore.
6. **Les ressources par défaut sont dimensionnées pour Mattermost.** Les valeurs par défaut de `cpu_limit` (2 vCPU) et `memory_limit` (4 Gi) absorbent la gestion simultanée des WebSockets, la mise en cache des canaux et l'indexation des messages de Mattermost.
7. **Redis est facultatif mais recommandé pour les déploiements multi-réplica.** `enable_redis` vaut `false` par défaut. Activer Redis fournit un stockage distribué des sessions et du cache, nécessaire à un comportement correct au-delà d'un seul réplica de pod.
8. **Les sondes de santé utilisent le point de terminaison ping dédié de Mattermost.** `startup_probe` et `liveness_probe` ont tous deux par défaut `path = "/api/v4/system/ping"` — le point de terminaison de santé intégré de Mattermost, qui renvoie HTTP 200 lorsque le serveur est prêt à accepter des connexions.
9. **`site_url` doit être défini pour générer correctement les liens.** Mattermost utilise `MM_SERVICESETTINGS_SITEURL` pour les e-mails de notification, la génération de liens dans l'application et les redirections OAuth. La variable `site_url` le définit automatiquement.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#2-iam--access-control).

**Ajouts propres à Mattermost GKE dans ce groupe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `region` | `"us-central1"` | Région GCP de déploiement des ressources. Utilisée en repli lorsque la découverte du sous-réseau VPC ne permet pas de déterminer la région. Sert aussi d'emplacement par défaut des buckets GCS provisionnés pour le stockage des fichiers de Mattermost. |
| `site_url` | `""` | L'URL publique à laquelle Mattermost est accessible (par exemple `"https://chat.example.com"`). Définit `MM_SERVICESETTINGS_SITEURL`. Nécessaire pour générer correctement les liens dans les e-mails de notification, les redirections OAuth et les liens profonds dans l'application. Ne la laissez vide que pour le provisionnement initial de l'infrastructure, avant l'attribution d'un domaine. |
| `edition` | `"team"` | Édition de Mattermost. `"team"` déploie la Team Edition gratuite. `"enterprise"` déploie l'Enterprise Edition et nécessite une clé de licence fournie via `environment_variables`. Modifier cette valeur après le déploiement initial remplace l'image de conteneur lors de l'apply suivant. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot) pour leur description.

**Valeurs par défaut propres à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"mattermost"` | `"gkeapp"` | Utilisé comme nom de base de toutes les ressources GCP et Kubernetes. **Ne le modifiez pas après le déploiement.** |
| `application_display_name` | `"Mattermost"` | `"App GKE Application"` | Affiché dans l'interface de la plateforme et les tableaux de bord. Peut être modifié librement. |
| `application_description` | `"Mattermost - Open-source team messaging on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"9.11.2"` | `"1.0.0"` | La version de Mattermost à construire et à déployer. Incrémenter cette valeur déclenche une nouvelle exécution de Cloud Build. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de façon identique à `App_GKE`. Voir [App_GKE Group 3](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut et comportement propres à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `8065` | `8080` | Port HTTP natif de Mattermost. Ne le modifiez pas, sauf si votre Dockerfile personnalisé lie Mattermost à un autre port. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Mattermost gère des connexions WebSocket simultanées, la mise en cache des canaux et l'indexation des messages. 2 vCPU et 4 Gi sont les minimums recommandés en production. |
| `min_instance_count` | `1` | `0` | Mattermost maintient des connexions WebSocket persistantes. La mise à l'échelle à zéro coupe les sessions utilisateur actives. Conservez `1` ou plus pour tout déploiement comptant des utilisateurs actifs. |
| `max_instance_count` | `5` | `3` | Plafond plus élevé pour absorber les pics de trafic lors de fortes rafales de communication dans les grandes équipes. |
| `container_image_source` | `"custom"` | `"custom"` | `Mattermost Common` fournit par défaut un build basé sur un Dockerfile. Définissez `"prebuilt"` pour déployer directement l'URI d'une image préconstruite. |
| `enable_cloudsql_volume` | `false` | `true` | Par défaut, Mattermost GKE se connecte à Cloud SQL via une connexion TCP privée plutôt que via un sidecar à socket Unix. Définissez `true` pour injecter le sidecar Cloud SQL Auth Proxy. |
| `timeout_seconds` | `300` | `300` | Pour les déploiements faisant un usage intensif des WebSockets, portez cette valeur à `3600` afin d'éviter que le timeout du backend ne coupe les connexions WebSocket actives. |
| `container_protocol` | `"http1"` | `"http1"` | Mattermost utilise HTTP/1.1 pour la mise à niveau WebSocket. Ne passez pas à `"h2c"`, sauf si votre configuration Mattermost prend explicitement en charge HTTP/2. |

Les autres variables d'exécution (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `service_annotations`, `service_labels`, `cloudsql_volume_mount_path`) se comportent comme décrit dans [App_GKE Group 3](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#4-advanced-security), [App_GKE](./App_GKE.md#5-traffic--ingress) et [App_GKE](./App_GKE.md#d-networking--network-policies).

> **Remarque :** les variables `ingress_settings` et `vpc_egress_setting` figurent dans les définitions de variables de `Mattermost GKE`, mais ne sont **pas transmises à `App GKE`**. Les définir n'a aucun effet sur l'infrastructure déployée dans l'implémentation actuelle.

Les variables réseau suivantes sont disponibles dans `Mattermost GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés à accéder via IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés à accéder via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration d'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration d'IAP. |
| `iap_support_email` | `""` | Adresse e-mail d'assistance affichée sur l'écran de consentement OAuth de Google. |
| `enable_custom_domain` | `true` | Configure l'Ingress/Gateway pour le routage d'un domaine personnalisé avec des certificats SSL gérés. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple `["chat.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; généré automatiquement s'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. |
| `enable_cloud_armor` | `false` | Active une règle de sécurité WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées à travers Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la règle de sécurité Cloud Armor à associer. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre VPC Service Controls. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#3-core-service-configuration).

**Comportement propre à Mattermost :**

`Mattermost GKE` ne préremplit **pas** `environment_variables` avec des paramètres Mattermost. La configuration de Mattermost est contrôlée par trois mécanismes :

1. **`site_url`** définit automatiquement `MM_SERVICESETTINGS_SITEURL` via `Mattermost Common`.
2. **`edition`** sélectionne automatiquement l'image de conteneur (`team` ou `enterprise`).
3. **`environment_variables`** accepte toute variable d'environnement Mattermost supplémentaire (selon la convention du préfixe `MM_`).

**Clé de licence de l'Enterprise Edition :**

Lorsque `edition = "enterprise"`, fournissez la clé de licence via `environment_variables` :

```
environment_variables = {
  MM_LICENSE = "your-mattermost-enterprise-licence-key"
}
```

**Remplacements courants de variables d'environnement Mattermost :**

| Variable | Rôle |
|---|---|
| `MM_EMAILSETTINGS_SMTPSERVER` | Serveur SMTP pour les notifications par e-mail. |
| `MM_EMAILSETTINGS_SMTPPORT` | Port SMTP (par exemple `"587"`). |
| `MM_EMAILSETTINGS_SMTPUSERNAME` | Nom d'utilisateur pour l'authentification SMTP. |
| `MM_EMAILSETTINGS_SMTPPASSWORD` | Mot de passe pour l'authentification SMTP. |
| `MM_EMAILSETTINGS_ENABLESMTPAUTH` | `"true"` pour activer l'authentification SMTP. |
| `MM_EMAILSETTINGS_FEEDBACKEMAIL` | Adresse d'expédition des e-mails de notification. |
| `MM_SERVICESETTINGS_ENABLEDEVELOPER` | `"false"` en production (désactive le mode développeur). |

Les autres variables de secrets (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#3-core-service-configuration).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut propres à Mattermost :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez selon votre objectif de point de reprise (RPO) et vos profils de trafic. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez-la pour les déploiements de production (30–90 jours recommandés). |

**Import de sauvegarde** — Mattermost GKE permet d'importer une sauvegarde existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'import ponctuel pendant le déploiement pour restaurer la sauvegarde indiquée par `backup_uri`. Configurez `backup_source`, `backup_uri` et `backup_format` avant de l'activer. |
| `backup_source` | `"gcs"` | Système source du fichier de sauvegarde. `"gcs"` importe depuis un URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (`"gs://my-bucket/backups/mattermost.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde stockée dans le bucket GCS de sauvegardes créé automatiquement par le module. Alternative à `backup_uri` pour les sauvegardes déjà placées dans le bucket géré par le module. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#6-cicd--delivery).

Les variables CI/CD suivantes sont disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode` (par défaut `"ALWAYS_ALLOW"` ; options : `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`).

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs), avec un comportement important propre à Mattermost.

**Job `db-init` par défaut de Mattermost :**

Lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide `[]`), `Mattermost Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image cliente PostgreSQL |
| Rôle | Crée la base de données PostgreSQL et l'utilisateur de Mattermost ; Mattermost exécute ensuite ses propres migrations de schéma au premier démarrage |
| CPU / Mémoire | `1000m` / `512Mi` |

Remplacez `initialization_jobs` par une liste non vide pour substituer vos propres jobs à ce job par défaut. Chaque job personnalisé doit spécifier au moins l'un des champs `command`, `args` ou `script_path`.

**CronJobs et services supplémentaires :**

Les variables `cron_jobs` et `additional_services` sont disponibles et se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs) pour la documentation complète.

> **Remarque :** le schéma `cron_jobs` de `Mattermost GKE` utilise les champs des CronJobs Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — plutôt que les champs de type Cloud Run utilisés dans `Mattermost CloudRun`. Le champ `secret_env_vars` n'est pas disponible dans les cron jobs GKE ; les secrets sont gérés via `secret_environment_variables` au niveau du module.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Valeurs par défaut propres à Mattermost :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `false` | Le stockage NFS est **désactivé** par défaut pour Mattermost. Les volumes GCS Fuse sont le backend de stockage à privilégier pour `/mattermost/data`, car ils sont durables et sûrs en multi-réplica sans le surcoût d'une instance Filestore. Activez NFS si votre déploiement exige une sémantique de système de fichiers POSIX non prise en charge par GCS Fuse (par exemple le verrouillage de fichiers). |
| `nfs_mount_path` | `"/mattermost/data"` | Le chemin de montage du volume NFS dans le conteneur Mattermost. Correspond au répertoire de données par défaut de Mattermost. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE Group 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Comportement propre à Mattermost :**

Mattermost stocke les fichiers téléversés par l'équipe, les pièces jointes et les données des plugins sous `/mattermost/data`. L'approche recommandée pour Mattermost GKE consiste à provisionner un bucket GCS et à le monter via le pilote CSI GCS Fuse :

```
create_cloud_storage = true

storage_buckets = [
  {
    name_suffix    = "mattermost-data"
    storage_class  = "STANDARD"
    force_destroy  = false
    versioning_enabled = true
  }
]

gcs_volumes = [
  {
    name       = "mattermost-data"
    mount_path = "/mattermost/data"
    readonly   = false
    mount_options = ["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s"]
  }
]
```

Contrairement à Ghost GKE, `Mattermost Common` ne provisionne **pas** automatiquement de bucket GCS. Vous devez définir explicitement `storage_buckets` et `gcs_volumes` si vous souhaitez un stockage des fichiers adossé à GCS.

Les variables `create_cloud_storage`, `storage_buckets` et `gcs_volumes` se comportent comme décrit dans [App_GKE Group 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut et restrictions propres à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | **Mattermost nécessite PostgreSQL 13 ou une version ultérieure.** Ne passez pas à MySQL ou SQL Server — Mattermost ne démarrera pas. |
| `application_database_name` | `"mattermost"` | `"gkeappdb"` | Nom de la base de données PostgreSQL de Mattermost. Ne le modifiez pas après le déploiement — il est transmis directement à `Mattermost Common` en tant que `db_name`. |
| `application_database_user` | `"mattermost"` | `"gkeappuser"` | Utilisateur PostgreSQL de Mattermost. Ne le modifiez pas après le déploiement — transmis à `Mattermost Common` en tant que `db_user`. |

> **Important :** `application_database_name` et `application_database_user` sont transmis à `Mattermost Common` en tant que `db_name` et `db_user`. Contrairement à Ghost GKE, il n'existe pas de variables abrégées distinctes `db_name`/`db_user` dans `Mattermost GKE` — `application_database_name` et `application_database_user` remplissent les deux rôles.

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement y est ajouté. |

**Extensions PostgreSQL :**

Mattermost ne nécessite pas d'extensions PostgreSQL personnalisées par défaut, mais le module expose des variables de gestion des extensions pour les déploiements avancés :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions PostgreSQL à installer (par exemple `["pg_trgm", "btree_gin"]`). |

La **rotation automatique des mots de passe** est également prise en charge :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. Lorsque `true`, le mot de passe est renouvelé selon la planification définie par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte le nouvel identifiant. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods, afin de laisser la réplication de Secret Manager se terminer. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Mattermost :**

Mattermost expose un point de terminaison de santé dédié à `/api/v4/system/ping`, qui renvoie HTTP 200 et un corps JSON d'état lorsque le serveur est entièrement initialisé et prêt à accepter des connexions. `startup_probe`/`liveness_probe` ciblent ce chemin par défaut.

### Routage des sondes de santé {#health-probe-routing}

`Mattermost GKE` déclare **deux jeux** de variables de sonde, mais un seul a réellement un effet :

| Jeu de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Mattermost Common` | La spécification réelle des sondes Kubernetes du conteneur applicatif — c'est ce qu'App_GKE relie au Deployment/StatefulSet déployé (`local.selected_module.startup_probe`/`.liveness_probe`) |
| `startup_probe_config`, `health_check_config` | `App GKE` directement | **Inopérantes pour Mattermost.** `App_GKE` ne les relie qu'à son propre préréglage interne d'exemple/de repli `gkeapp`, inutilisé (`gkeapp.tf`) — elles n'atteignent jamais le conteneur Mattermost déployé |

Ce ne sont pas des alias. Modifier `startup_probe` affecte la sonde réellement déployée ; modifier `startup_probe_config`/`health_check_config` n'a aucun effet sur Mattermost — laissez-les à leurs valeurs par défaut et configurez les contrôles de santé exclusivement via `startup_probe`/`liveness_probe`.

**Sonde de démarrage** (`startup_probe` → `Mattermost Common`) :

| Champ | Valeur par défaut Mattermost | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Point de terminaison de disponibilité intégré de Mattermost. |
| `initial_delay_seconds` | `60` | `10` | Mattermost exécute les migrations PostgreSQL au premier démarrage, ce qui peut prendre 30 à 60 secondes pour les bases de données volumineuses. |
| `failure_threshold` | `30` | `3` | Accorde jusqu'à 7.5 minutes de démarrage (`30 × 15s`). Suffisant pour les nouveaux déploiements avec migration de schéma. |
| `period_seconds` | `15` | `10` | — |

**Sonde de vivacité** (`liveness_probe` → `Mattermost Common`) :

| Champ | Valeur par défaut Mattermost | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Identique à la sonde de démarrage. |
| `initial_delay_seconds` | `60` | `15` | Laisse à Mattermost un délai supplémentaire pour se stabiliser une fois la sonde de démarrage réussie. |
| `period_seconds` | `30` | `30` | — |
| `failure_threshold` | `3` | `3` | — |

**Variables de sonde inopérantes** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Mattermost | Remarques |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/", initial_delay_seconds = 120, failure_threshold = 15 }` | Consommée uniquement par le préréglage de repli interne `gkeapp`, inutilisé, d'`App_GKE` — sans effet sur le conteneur Mattermost déployé. Inutile de remplacer `path` ; utilisez plutôt `startup_probe`. |
| `health_check_config` | `{ enabled = true, path = "/" }` | Comme ci-dessus — inopérante pour Mattermost. Utilisez plutôt `liveness_probe`. |

**`uptime_check_config` :** vaut par défaut `{ enabled = false, path = "/" }` — les contrôles de disponibilité sont désactivés par défaut. Activez-les et définissez `path = "/api/v4/system/ping"` pour la supervision en production.

**Métriques Prometheus :** Mattermost expose des métriques Prometheus sur le port `8067`. Ce module ne les collecte pas automatiquement, mais Cloud Monitoring peut les consommer au moyen d'un exportateur de métriques personnalisé ou d'une intégration Prometheus vers Cloud Monitoring.

---

## Groupe 14 : Règles de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#7-reliability--scheduling).

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

> **Remarque :** `enable_pod_disruption_budget` vaut `false` par défaut dans `Mattermost GKE`. Activez-le pour les déploiements de production où les mises à niveau progressives des nœuds ne doivent pas mettre hors ligne tous les pods Mattermost simultanément.

---

## Groupe 15 : Cache Redis {#group-15-redis-cache}

Ces variables configurent l'intégration Redis facultative de Mattermost. La prise en charge de l'infrastructure Redis sous-jacente est fournie par `App_GKE` (voir [App_GKE](./App_GKE.md#a-redis--memorystore)) ; les variables ci-dessous sont propres à Mattermost. Mattermost utilise Redis comme cache distribué et backend de sessions — nécessaire à un comportement correct au-delà d'un seul réplica de pod.

> **Remarque :** `enable_redis` vaut `false` par défaut dans `Mattermost GKE`. C'est sans risque pour les déploiements à un seul réplica. Pour tout déploiement avec `min_instance_count > 1` ou une mise à l'échelle horizontale, Redis doit être activé.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | Active Redis comme cache distribué et backend de sessions de Mattermost. Lorsque `false`, Mattermost utilise un cache dans le processus — les requêtes acheminées vers des réplicas de pod différents ne partagent pas l'état de session, ce qui provoque des échecs d'authentification intermittents sous charge. **Obligatoire pour les déploiements multi-réplica.** |
| `redis_host` | `""` | Nom d'hôte ou adresse IP | Le nom d'hôte ou l'adresse IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS découverte automatiquement (le Redis co-hébergé par défaut de la plateforme). Remplacez-la par une IP ou un nom d'hôte explicite lorsque vous utilisez une instance Redis dédiée, comme Google Cloud Memorystore. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Chaîne contenant un numéro de port | Port TCP du serveur Redis. La valeur par défaut `6379` est le port Redis standard. Ne la modifiez que si votre instance Redis écoute sur un port non standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification du serveur Redis. Laissez vide si l'instance Redis n'exige pas d'authentification. Pour les instances Memorystore avec AUTH activé, indiquez la chaîne AUTH de l'instance. Traité comme sensible — non stocké en clair dans l'état Terraform. |

### Valider les paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Instance Memorystore (le cas échéant) :** accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et l'état d'AUTH.
- **État de Redis dans Mattermost :** une fois le déploiement effectué, accédez à la System Console de Mattermost (**Environment → Cache**) ou consultez les journaux du conteneur pour repérer les messages d'initialisation du cache.

**gcloud CLI / kubectl :**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm Redis environment variables are set in the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i redis

# Test Redis connectivity from inside the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379
```

---

## Groupe 16 : Domaine personnalisé et IP statique {#group-16-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#5-traffic--ingress).

> **Configuration du `site_url` de Mattermost :** Mattermost doit connaître son URL publique au démarrage. Lorsque vous utilisez un domaine personnalisé, définissez `site_url` pour qu'il corresponde au domaine indiqué dans `application_domains` (par exemple `site_url = "https://chat.example.com"`). Mattermost utilise cette URL pour les e-mails de notification, les redirections des fournisseurs OAuth et la génération de liens dans l'application — un `site_url` incorrect provoque des liens de notification cassés, des échecs de connexion OAuth et des liens profonds erronés dans l'application mobile.

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode` (par défaut `"primary"`), `network_name` (par défaut `""` ; découvert automatiquement s'il est vide), `prereq_gke_subnet_cidr` (par défaut `"10.201.0.0/24"`).

> **Remarque sur l'affinité de session :** `session_affinity` vaut `"ClientIP"` par défaut. Mattermost utilise des jetons de session côté serveur. Sans affinité de session, les utilisateurs peuvent rencontrer des erreurs d'authentification intermittentes lorsque les requêtes sont acheminées vers des réplicas de pod différents qui ne partagent pas de cache de session en mémoire. Conservez `"ClientIP"`, sauf si Redis est activé avec un backend de sessions partagé.

> **Type de service :** `service_type` vaut `"LoadBalancer"` par défaut. Cela provisionne un équilibreur de charge externe. Pour les déploiements Mattermost uniquement internes, passez à `"ClusterIP"` et configurez un Ingress séparément.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

Définir `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `"StatefulSet"`. Chaque pod Mattermost dispose alors de son propre PVC dédié pour le stockage local, en alternative aux volumes GCS Fuse. Pour la plupart des déploiements Mattermost, GCS Fuse est préférable aux PVC de StatefulSet, car GCS offre durabilité et accès partagé entre pods sans contrainte de taille.

Variables disponibles : `stateful_pvc_enabled`, `stateful_pvc_size` (par défaut `"10Gi"`), `stateful_pvc_mount_path` (par défaut `"/data"`), `stateful_pvc_storage_class` (par défaut `"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

---

## Groupe 19 : Quota de ressources {#group-19-resource-quota}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#c-resource-quotas).

Variables disponibles : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs`.

> **Suffixe obligatoire pour les quotas de mémoire :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes d'unités binaires (par exemple `"8Gi"`, `"4096Mi"`). Les entiers sans suffixe sont interprétés comme des octets par Kubernetes et bloquent toute planification de pods.

---

## Explorer le déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

**Charges de travail :**
Accédez à **Kubernetes Engine → Workloads** et filtrez par namespace (le nom du namespace est dérivé de `application_name` et `tenant_id`). Le Deployment ou StatefulSet Mattermost, le Job `db-init` et les éventuels CronJobs configurés y apparaissent.

**Services et Ingress :**
Accédez à **Kubernetes Engine → Services & Ingress** pour trouver le Service Mattermost, son adresse IP externe et les éventuelles ressources Ingress configurées. Si `reserve_static_ip = true`, l'IP réservée apparaît sous **VPC Network → IP Addresses**.

**Stockage :**
Accédez à **Cloud Storage → Buckets** et recherchez les buckets préfixés par `app` et votre `application_name` pour trouver le bucket de données de Mattermost et le bucket de sauvegardes automatisées.

**Base de données :**
Accédez à **SQL** pour trouver l'instance Cloud SQL PostgreSQL 15. Le nom de l'instance suit le modèle `app<name><tenant><id>-sql`. Cliquez sur l'instance pour consulter les connexions, Query Insights et l'historique des sauvegardes.

**Secrets :**
Accédez à **Security → Secret Manager** pour consulter `DB_PASSWORD` et les autres secrets provisionnés par le module. Les noms des secrets suivent le modèle `app<name><tenant><id>-*`.

**Supervision :**
Accédez à **Monitoring → Dashboards** et **Monitoring → Alerting** pour consulter les contrôles de disponibilité (si `uptime_check_config.enabled = true`) et les éventuelles règles d'alerte configurées via `alert_policies`.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
# Get the GKE cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List pods in the Mattermost namespace
kubectl get pods -n NAMESPACE

# Tail Mattermost application logs
kubectl logs -n NAMESPACE -l app=mattermost -f

# Check the db-init job status
kubectl get jobs -n NAMESPACE

# Describe the Mattermost Deployment (or StatefulSet)
kubectl describe deployment mattermost -n NAMESPACE

# Check the external IP assigned to the Service
kubectl get service -n NAMESPACE

# View environment variables injected into the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep MM_

# Check Mattermost health endpoint directly from inside the pod
kubectl exec -n NAMESPACE POD_NAME -- \
  curl -s http://localhost:8065/api/v4/system/ping

# View Cloud SQL instance details
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,state,ipAddresses)"

# List GCS buckets for this deployment
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~mattermost"

# View Secret Manager secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~mattermost"
```

---

## Sorties du module {#module-outputs}

`Mattermost GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_url` | URL du service |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Namespace Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données applicative |
| `database_user` | Nom de l'utilisateur de la base de données applicative |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — le cluster est créé mais son point de terminaison n'est pas encore lisible, si bien que les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut raisonnables {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critical** (critique : perte de données, panne complète, faille de sécurité) — **High** (élevé : service indisponible ou dégradation importante) — **Medium** (moyen : fonctionnement dégradé ou coût accru) — **Low** (faible : impact mineur).

| Variable | Valeur par défaut raisonnable | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critical** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Mattermost ne prend en charge que PostgreSQL. Définir `MYSQL_8_0` ou `NONE` fait échouer le job `db-init` et planter Mattermost au démarrage. |
| `application_database_name` | `"mattermost"` | **Critical** | Immuable après le déploiement — le modifier recrée la base de données et détruit toutes les données Mattermost (canaux, messages, utilisateurs). |
| `application_database_user` | `"mattermost"` | **Critical** | Immuable après le déploiement — le modifier recrée l'utilisateur, invalide les identifiants et rompt la connexion de Mattermost à la base de données. |
| `site_url` | `""` | **High** | Un `site_url` vide empêche Mattermost de générer correctement les liens des e-mails de notification, les redirections OAuth et les liens profonds mobiles. Configurez-le avant d'inviter des utilisateurs. |
| `edition` | `"team"` | **High** | Définir `"enterprise"` sans clé de licence valide fait démarrer Mattermost sans licence et désactive silencieusement les fonctionnalités enterprise. Fournissez la clé via `environment_variables`. |
| `enable_redis` | `false` | **High** | Sans risque pour les déploiements à un seul réplica. Avec `min_instance_count > 1`, la mise en cache des sessions dans le processus provoque des échecs d'authentification intermittents lorsque les requêtes sont réparties entre les pods. Activez Redis pour tout déploiement multi-réplica. |
| `min_instance_count` | `1` | **High** | Définir `0` autorise la mise à l'échelle à zéro. Les démarrages à froid coupent les connexions WebSocket actives : les utilisateurs voient des bannières de déconnexion et manquent des messages en temps réel jusqu'à la reconnexion. Conservez `1` en production. |
| `container_resources.memory_limit` | `"4Gi"` | **High** | Mattermost met en cache en mémoire les canaux actifs et les sessions utilisateur. Un sous-dimensionnement (en dessous de `2Gi`) provoque des arrêts OOM sous une charge d'équipe modérée, en particulier lors d'exports massifs de messages ou de l'exécution de plugins. |
| `session_affinity` | `"ClientIP"` | **High** | Sans Redis et sans affinité de session, les sessions administrateur et utilisateur ne sont pas partagées entre les pods. Les utilisateurs sont de fait déconnectés à chaque requête acheminée vers un autre réplica. |
| `container_port` | `8065` | **Critical** | Mattermost écoute sur `8065`. Modifier cette valeur sans l'aligner sur le port lié par le conteneur fait échouer toutes les sondes de santé et fait entrer le pod dans une boucle de redémarrage. |
| `timeout_seconds` | `300` | **Medium** | Les connexions WebSocket de Mattermost sont de longue durée. Un timeout de backend de 300 secondes coupe régulièrement les connexions actives. Définissez `3600` pour les déploiements faisant un usage intensif des WebSockets. |
| `enable_nfs` | `false` | **Medium** | NFS est désactivé par défaut. Si `gcs_volumes` n'est pas non plus configuré, les fichiers téléversés dans Mattermost sont stockés dans le système de fichiers éphémère du conteneur et perdus au redémarrage du pod. Configurez des volumes GCS Fuse pour un stockage durable des fichiers. |
| `create_cloud_storage` | `false` | **Medium** | Ce module ne provisionne automatiquement aucun bucket GCS. Sans `create_cloud_storage = true` et une entrée `gcs_volumes`, les fichiers téléversés ne survivent pas aux redémarrages de pods. |
| `stateful_pvc_size` | `"10Gi"` | **Medium** | Pour des équipes qui partagent activement des fichiers et des médias, `10Gi` se remplit vite. Provisionnez 50–100 Gi pour les équipes actives. La taille d'un PVC peut être augmentée mais pas réduite. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critical** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers sans suffixe sont interprétés comme des octets et empêchent la planification de tous les pods. |
| `backup_retention_days` | `7` | **Medium** | Trop court pour des équipes actives. Portez-la à 30 jours ou plus pour disposer d'une fenêtre de reprise utile. |
| `enable_cloud_armor` | `false` | **Medium** | Sans Cloud Armor, la page de connexion et les points de terminaison de l'API de Mattermost sont exposés aux attaques par force brute et par bourrage d'identifiants. Activez-le pour tout déploiement accessible publiquement. |
| `enable_pod_disruption_budget` | `false` | **Medium** | Désactivé par défaut. Sans PDB, les mises à niveau des nœuds GKE peuvent arrêter simultanément tous les pods Mattermost et provoquer une panne complète. Activez-le en production. |
| `startup_probe.failure_threshold` | `30` | **High** | Mattermost exécute les migrations de schéma PostgreSQL au premier démarrage. Réduire `failure_threshold` en dessous de `20` sur de nouveaux déploiements avec des bases de données volumineuses peut amener Kubernetes à redémarrer le pod avant la fin des migrations, créant une boucle de redémarrage. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mattermost sur GKE Autopilot](../labs/Mattermost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md) — la même application sur Cloud Run, si vous avez besoin de l'autre cible de déploiement.
- [Mattermost Common — Module de configuration partagée](Mattermost_Common.md) — la configuration partagée par les deux cibles de déploiement.
