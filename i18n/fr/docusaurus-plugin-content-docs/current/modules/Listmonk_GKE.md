---
title: "Module Listmonk GKE — Guide de configuration"
description: "Référence de configuration pour déployer Listmonk sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Listmonk_GKE.md @ 3055034 sha256:643c32b02f3d -->

# Module Listmonk GKE — Guide de configuration {#listmonk-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Listmonk_GKE.png" alt="Module Listmonk GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Listmonk_GKE`. `Listmonk_GKE` est un **module enveloppe** (wrapper) qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration applicative partagée [`Listmonk_Common`](./Listmonk_Common) afin de déployer [Listmonk](https://listmonk.app/), le gestionnaire auto-hébergé de newsletters et de listes de diffusion, sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Listmonk GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **propres à Listmonk** sont décrites en détail ici.

> **Remarque :** les variables signalées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`. Consultez les sections correspondantes du [guide de configuration App_GKE](./App_GKE.md) pour la documentation complète.

| Domaine de configuration | Section de App GKE.md | Remarques propres à Listmonk |
|---|---|---|
| Projet et identité | §2 IAM & Access Control | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Listmonk ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Listmonk pour `container_port`, `cpu_limit`, `memory_limit` et `min_instance_count` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Core Service Configuration | Secret `LISTMONK_ADMIN_PASSWORD` généré automatiquement par `Listmonk Common` ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et stratégies réseau | §3.D Networking & Network Policies | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Initialization Jobs & CronJobs | Job PostgreSQL `db-init` fourni automatiquement par `Listmonk Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Additional Services | Identique. |
| Stockage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` vaut `false` par défaut ; Listmonk utilise GCS Fuse pour les fichiers téléversés ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Bucket GCS provisionné automatiquement pour les médias téléversés ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Database (Cloud SQL) | **PostgreSQL 15 obligatoire** ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Planification et rétention des sauvegardes | §3.B Database (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Initialization Jobs & CronJobs | Identique. |
| Observabilité et contrôles de santé | §3.A Compute (GKE Autopilot) | Le point de terminaison de santé est `/api/health` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Binary Authorization | §4.C Binary Authorization | Identique. |
| VPC Service Controls | §4.D VPC Service Controls | Identique. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Toujours activé — aucune configuration requise. |
| Trafic et ingress | §5 Traffic & Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Static IP Reservation | L'URL publique de Listmonk doit correspondre au domaine configuré dans `application_domains` ; voir [Groupe 16 : Domaine personnalisé et IP statique](#group-16-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Cloud Build Triggers | Identique. |
| Pipeline Cloud Deploy | §6.B Cloud Deploy Pipeline | Identique. |
| Mise en miroir des images | §6.C Image Mirroring | Identique. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identique. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identique. |
| Quotas de ressources | §7.C Resource Quotas | Identique. |
| Rotation automatique des mots de passe | §7.D Auto Password Rotation | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` vaut `false` par défaut ; Listmonk n'a pas besoin de Redis ; voir [Groupe 15 : Cache Redis](#group-15-redis-cache). |
| Importation de sauvegarde | §8.B Backup Import | Prend en charge à la fois un URI GCS et le bucket de sauvegarde géré par le module ; voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identique. |

---

## Relation entre Listmonk GKE et App GKE {#how-listmonk-gke-relates-to-app-gke}

`Listmonk GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Listmonk Common` qui fournit les valeurs par défaut et la configuration applicative propres à Listmonk. Les principaux effets sont les suivants :

1. **PostgreSQL 15 est obligatoire.** Listmonk utilise PostgreSQL comme seul moteur de base de données pris en charge. La valeur par défaut de `database_type` est `"POSTGRES_15"` et ne doit pas être remplacée par MySQL ni par un autre moteur.
2. **`LISTMONK_ADMIN_PASSWORD` est généré automatiquement.** `Listmonk Common` crée un mot de passe administrateur aléatoire et le stocke dans Secret Manager ; il est injecté dans le conteneur sous la forme `LISTMONK_ADMIN_PASSWORD` — vous n'avez pas besoin de le configurer manuellement. Le nom d'utilisateur administrateur correspondant est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`.
3. **Listmonk exécute automatiquement les migrations de schéma au premier démarrage.** Aucune initialisation manuelle du schéma n'est requise au-delà du job `db-init` qui crée la base de données et l'utilisateur. Le binaire de Listmonk applique lui-même toutes les migrations en attente au démarrage.
4. **Un job `db-init` s'exécute lors du premier déploiement.** `Listmonk Common` fournit un Job Kubernetes `db-init` par défaut, basé sur une image `postgres:15-alpine`, qui crée la base de données et l'utilisateur dans Cloud SQL. Redéfinissez `initialization_jobs` pour le remplacer par un job personnalisé.
5. **GCS Fuse est utilisé pour les médias téléversés à la place de NFS.** `enable_nfs` vaut `false` par défaut. Listmonk stocke les fichiers d'abonnés, les pièces jointes et les médias téléversés via GCS Fuse, qui fournit un stockage objet durable sans nécessiter de volume NFS partagé.
6. **Les ressources par défaut sont dimensionnées pour Listmonk.** Les valeurs par défaut de `cpu_limit` (`1000m`) et de `memory_limit` (`512Mi`) conviennent aux opérations de listes de diffusion de petite à moyenne taille. Augmentez `container_resources` pour les campagnes comptant un grand nombre d'abonnés ou un usage concurrent élevé de l'API.
7. **L'affinité de session vaut `"ClientIP"` par défaut.** L'interface de gestion des campagnes de Listmonk conserve l'état de session en mémoire du processus. Sans affinité de session, l'interface web peut perdre son état entre les requêtes lorsque plusieurs réplicas de pod sont en cours d'exécution. L'affinité de session `"ClientIP"` par défaut achemine chaque session de navigateur vers le même pod.
8. **Redis n'est pas requis.** Listmonk n'utilise pas de couche de cache — `enable_redis` vaut `false` par défaut. Vous n'avez pas besoin d'une instance Memorystore pour exécuter Listmonk.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#2-iam--access-control).

**Variables de Listmonk GKE dans ce groupe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | ID du projet GCP. Aucune valeur par défaut — le déploiement échoue sans cette valeur. |
| `tenant_id` | `"demo"` | Suffixe ajouté aux noms des ressources pour distinguer plusieurs déploiements dans le même projet. |
| `support_users` | `[]` | Utilisateurs disposant d'un accès en lecture aux sorties du déploiement (par ex. URL, noms de secrets). |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources GCP créées par ce module. |
| `region` | `"us-central1"` | Région GCP de toutes les ressources. Sert d'emplacement par défaut du bucket de stockage et de région des nœuds GKE. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot) pour leur description.

**Valeurs par défaut propres à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"listmonk"` | `"gkeapp"` | Sert de nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Listmonk"` | `"App GKE Application"` | Affiché dans l'interface de la plateforme et les tableaux de bord. Modifiable librement. |
| `application_description` | `"Listmonk Newsletter Manager on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Modifiable librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Tag de l'image Listmonk à déployer. `"latest"` est acceptable en développement ; épinglez une version précise (par ex. `"v4.1.0"`) en production pour garantir des déploiements reproductibles. |
| `admin_username` | `"listmonk"` | *(absent de App GKE)* | Déclarée et transmise à `Listmonk_Common`, mais actuellement inutilisée par celui-ci — le nom d'utilisateur du super-administrateur initial est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`, quelle que soit la valeur de cette variable. |
| `deploy_application` | `true` | `true` | Définissez à `false` pour provisionner l'infrastructure sans déployer la charge de travail Listmonk — utile pour les déploiements progressifs ou les rafraîchissements de l'infrastructure seule. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut et comportement propres à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `9000` | `8080` | Port HTTP natif de Listmonk. Ne le modifiez pas, sauf si votre Dockerfile personnalisé fait écouter Listmonk sur un autre port. |
| `min_instance_count` | `1` | `1` | Au moins un pod est toujours en cours d'exécution — pas de mise à l'échelle à zéro sur GKE. Le planificateur de campagnes et les tâches d'importation d'abonnés de Listmonk nécessitent un processus en exécution continue. |
| `max_instance_count` | `3` | `3` | Suffisant pour la plupart des charges de travail de listes de diffusion. Augmentez-le en cas d'usage concurrent très élevé de l'API ou d'importations massives d'abonnés. |
| `container_image` | `"listmonk/listmonk:latest"` | *(aucune)* | Image Docker Hub officielle de Listmonk. Remplacez-la par une image Artifact Registry privée lorsque `container_image_source = "custom"`. |
| `container_image_source` | `"custom"` | `"custom"` | Build personnalisé par défaut, afin de permettre une configuration propre à l'environnement via des variables d'environnement `LISTMONK_*` intégrées à l'image. Définissez `"prebuilt"` pour déployer directement l'image Docker Hub officielle. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy monte un socket Unix que Listmonk utilise pour se connecter à Cloud SQL sans exposer les identifiants de la base de données sur le réseau. Ne le désactivez que si vous vous connectez à Cloud SQL par une connexion TCP privée directe. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | `"/cloudsql"` | Chemin, dans le conteneur, où le socket Cloud SQL Auth Proxy est monté. |

**`container_resources` :** la valeur par défaut de la variable est `{ cpu_limit = "1000m", memory_limit = "512Mi" }`. Elle convient au développement et aux petites listes d'abonnés. Pour les déploiements de production qui envoient des campagnes à des dizaines de milliers d'abonnés, augmentez-la au moins à `{ cpu_limit = "2000m", memory_limit = "1Gi" }` afin d'éviter les arrêts pour OOM lors des envois massifs de campagnes.

Les autres variables d'exécution (`enable_image_mirroring`, `container_build_config`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#4-advanced-security), [App_GKE](./App_GKE.md#5-traffic--ingress) et [App_GKE](./App_GKE.md#d-networking--network-policies).

Les variables réseau suivantes sont disponibles dans `Listmonk GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Type de service Kubernetes. `"LoadBalancer"` provisionne un équilibreur de charge externe GCP. Utilisez `"ClusterIP"` avec `enable_custom_domain = true` pour un routage via Gateway. |
| `enable_network_segmentation` | `false` | Déploie une NetworkPolicy Kubernetes qui limite le trafic entre pods aux chemins explicitement autorisés. |
| `namespace_name` | `""` | Espace de noms Kubernetes de la charge de travail Listmonk. Généré automatiquement à partir de `application_name` et `tenant_id` s'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. |
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés via IAP. |
| `iap_authorized_groups` | `[]` | Google Groups autorisés via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration d'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration d'IAP. |
| `iap_support_email` | `""` | Adresse e-mail d'assistance affichée sur l'écran de consentement OAuth de Google. |
| `enable_custom_domain` | `true` | Configure Ingress/Gateway pour le routage d'un domaine personnalisé avec des certificats SSL gérés. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par ex. `["listmonk.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une adresse IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'adresse IP réservée ; généré automatiquement s'il est vide. |
| `enable_cloud_armor` | `false` | Active une stratégie de sécurité WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées par Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la stratégie de sécurité Cloud Armor à associer. |
| `enable_cdn` | `false` | Active Cloud CDN sur le service de backend. Nécessite le routage via Gateway (`enable_custom_domain = true`). |
| `enable_vpc_sc` | `false` | Active l'application du périmètre VPC Service Controls. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR pour les règles de sortie VPC-SC. |
| `vpc_sc_dry_run` | `true` | Exécute VPC-SC en mode simulation (dry-run, audit uniquement) avant de l'appliquer. |
| `organization_id` | `""` | Remplacement de l'ID de l'organisation GCP. Requis uniquement pour les projets imbriqués dans un dossier. |
| `enable_audit_logging` | `false` | Active Cloud Audit Logs pour l'activité VPC-SC. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#3-core-service-configuration).

**Valeurs par défaut propres à Listmonk :**

`Listmonk Common` injecte automatiquement la configuration de connexion à la base de données dans le conteneur via des variables d'environnement `LISTMONK_*`. Vous n'avez pas besoin de définir manuellement les chaînes de connexion à la base de données. Les secrets suivants sont créés et injectés automatiquement :

| Variable d'environnement secrète | Rôle |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | Mot de passe administrateur généré aléatoirement pour l'interface web de Listmonk (le nom d'utilisateur est `admin`, codé en dur). Récupérez-le dans Secret Manager après le déploiement pour votre première connexion. |
| `LISTMONK_API_TOKEN` | Jeton d'API déterministe de l'utilisateur d'API programmatique auto-réparateur (`LISTMONK_API_USER`, `rad-api` par défaut), réinscrit dans la base de données à chaque démarrage. |

Des variables d'environnement `LISTMONK_*` supplémentaires (par ex. la configuration SMTP des e-mails transactionnels) peuvent être ajoutées via `environment_variables`. La configuration de Listmonk utilise une notation hiérarchique à double tiret bas (`__`) :

```hcl
environment_variables = {
  LISTMONK_smtp__host     = "smtp.mailgun.org"
  LISTMONK_smtp__port     = "587"
  LISTMONK_smtp__username = "postmaster@mg.example.com"
  LISTMONK_smtp__password = "your-smtp-password"
  LISTMONK_smtp__tls_type = "STARTTLS"
}
```

Les autres variables de secrets (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`) se comportent comme décrit dans [App_GKE](./App_GKE.md#3-core-service-configuration).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut propres à Listmonk :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez-la à votre objectif de point de reprise (RPO). Les bases de données Listmonk croissent régulièrement avec les enregistrements d'abonnés et de campagnes — planifiez les sauvegardes pendant les périodes de faible trafic. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Portez-la à 30 jours ou plus pour les déploiements de production comportant des listes d'abonnés actives. |

**Importation de sauvegarde** — Listmonk GKE permet d'importer une sauvegarde existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsqu'elle vaut `true`, exécute pendant le déploiement un job d'importation ponctuel qui restaure la sauvegarde indiquée par `backup_source` et `backup_file`. À configurer avant l'activation. |
| `backup_source` | `"gcs"` | Système source du fichier de sauvegarde. `"gcs"` importe depuis un URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom d'un fichier de sauvegarde stocké dans le bucket GCS de sauvegardes créé automatiquement par le module. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#6-cicd--delivery).

Les variables CI/CD suivantes sont disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config` (par défaut `{ branch_pattern = "^main$" }`), `enable_cloud_deploy`, `cloud_deploy_stages` (par défaut `[dev, staging, prod]`), `enable_binary_authorization`, `binauthz_evaluation_mode` (par défaut `"ALWAYS_ALLOW"` ; options : `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`).

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs), avec un comportement important propre à Listmonk.

**Job `db-init` par défaut de Listmonk :**

Lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide `[]`), `Listmonk Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | `postgres:15-alpine` |
| Rôle | Crée la base de données PostgreSQL et l'utilisateur de Listmonk dans l'instance Cloud SQL |
| Exécution à chaque apply | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |

Redéfinissez `initialization_jobs` avec une liste non vide pour remplacer ce job par défaut par vos propres jobs. Chaque job personnalisé doit spécifier au moins l'un des champs `command`, `args` ou `script_path`.

> **Migrations de schéma :** contrairement à certaines applications, Listmonk ne nécessite pas de job d'initialisation de schéma distinct. Le binaire de Listmonk détecte une base de données vierge et applique la migration complète du schéma au premier démarrage. Le job `db-init` doit seulement créer la base de données et l'utilisateur — Listmonk se charge du reste.

**CronJobs et services supplémentaires :**

Les variables `cron_jobs` et `additional_services` sont disponibles et se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs) pour la documentation complète.

> **Remarque :** le schéma `cron_jobs` de `Listmonk GKE` utilise les champs des CronJobs Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — plutôt que des champs de type Cloud Run. Le champ `secret_env_vars` n'est pas disponible dans les cron jobs GKE ; les secrets sont gérés via `secret_environment_variables` au niveau du module.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Valeurs par défaut propres à Listmonk :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. Listmonk utilise GCS Fuse pour le stockage des médias et des pièces jointes plutôt qu'un volume NFS partagé. N'activez NFS que si votre déploiement nécessite un système de fichiers POSIX partagé entre tous les pods, pour des raisons étrangères aux besoins de stockage propres à Listmonk. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage du volume NFS si NFS est activé. Non utilisé par défaut. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une instance Filestore existante à utiliser. Découverte automatiquement si vide. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base de l'instance Filestore lors de la création d'une nouvelle instance. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Valeurs par défaut propres à Listmonk :**

`Listmonk Common` provisionne automatiquement un bucket GCS pour le stockage des médias et des pièces jointes de Listmonk via GCS Fuse. Ce bucket est monté dans le conteneur à un chemin que Listmonk utilise pour les fichiers téléversés. Vous n'avez pas besoin de le définir manuellement dans `storage_buckets`.

| Bucket | `name_suffix` | Rôle |
|---|---|---|
| Provisionné automatiquement | `listmonk-uploads` | Médias téléversés, fichiers d'importation d'abonnés et pièces jointes de campagnes de Listmonk, via le pilote CSI GCS Fuse |

Des buckets GCS supplémentaires peuvent être définis dans `storage_buckets` — par exemple, un bucket distinct pour les exports de sauvegarde ou les ressources de modèles personnalisés.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut et restrictions propres à Listmonk :**

| Variable | Valeur par défaut Listmonk GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | **Listmonk nécessite PostgreSQL.** Ne la remplacez pas par une variante MySQL — Listmonk ne prend en charge que PostgreSQL et échouera au démarrage avec une erreur de base de données non prise en charge. |
| `application_database_name` | `"listmonk"` | `"gkeappdb"` | Nom de la base de données PostgreSQL créée dans l'instance Cloud SQL. **Ne pas modifier après le déploiement** — la modifier recrée la base de données et détruit toutes les données de Listmonk. |
| `application_database_user` | `"listmonk"` | `"gkeappuser"` | Utilisateur PostgreSQL utilisé par Listmonk pour se connecter. **Ne pas modifier après le déploiement** — le modifier recrée l'utilisateur et invalide tous les identifiants existants. |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de base de données généré automatiquement. Des mots de passe plus longs renforcent la sécurité ; 32 caractères conviennent à la production. |
| `enable_postgres_extensions` | `false` | `false` | Listmonk ne nécessite aucune extension PostgreSQL au-delà de celles par défaut. N'activez cette option que si vous ajoutez des fonctionnalités de base de données personnalisées. |

> **Important :** Listmonk applique automatiquement les migrations de schéma au démarrage. Le premier démarrage après un nouveau déploiement est légèrement plus long que les suivants, car le schéma complet est créé. La sonde de démarrage est configurée avec un délai initial de 30 secondes pour en tenir compte.

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloudsql_volume` | `true` | Monte le socket Unix de Cloud SQL Auth Proxy dans le conteneur. Requis pour que Listmonk se connecte à Cloud SQL via le chemin du socket. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Chemin de montage du socket Auth Proxy dans le conteneur Listmonk. |

**La rotation automatique des mots de passe** est également prise en charge :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. Lorsqu'elle vaut `true`, le mot de passe de la base de données change selon la planification définie par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte le nouvel identifiant. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage des pods, pour laisser la réplication de Secret Manager se terminer. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Exécute des scripts SQL personnalisés depuis un bucket GCS pendant le déploiement. Utile pour alimenter Listmonk avec des définitions de listes, des modèles ou des segments d'abonnés initiaux. |
| `custom_sql_scripts_bucket` | `""` | Bucket GCS contenant les scripts SQL à exécuter. |
| `custom_sql_scripts_path` | `""` | Préfixe de chemin, dans le bucket, des fichiers de scripts SQL. |
| `custom_sql_scripts_use_root` | `false` | Exécute les scripts SQL personnalisés en tant qu'utilisateur root de Cloud SQL au lieu de l'utilisateur de l'application. Requis pour les scripts qui créent des extensions ou modifient des paramètres au niveau système. |

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent exactement comme dans `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Listmonk :**

Listmonk expose un point de terminaison HTTP dédié `/api/health`, mais depuis Listmonk v6.1.0, il est placé derrière l'authentification de session et renvoie `403 {"message":"invalid session"}` à une requête non authentifiée — une sonde HTTP qui le cible n'aboutit donc jamais. `Listmonk_GKE` utilise par conséquent des sondes **TCP** sur le port 9000 par défaut (Kubernetes prend en charge `tcpSocket` pour les sondes de démarrage comme de vivacité, contrairement à Cloud Run qui interdit une sonde de vivacité TCP). Le point de terminaison non authentifié `/health` (sans préfixe `/api`) renvoie bien 200, mais n'est pas configuré comme sonde par défaut.

**Valeurs par défaut des sondes de santé :**

| Variable | Valeur par défaut Listmonk | Remarques |
|---|---|---|
| `health_check_config` | `{ enabled = true, type = "TCP", path = "/api/health", initial_delay_seconds = 30, period_seconds = 30, failure_threshold = 3 }` | Sonde de vivacité Kubernetes. Contrôle TCP sur le port 9000 — le champ `path` est conservé dans le schéma mais inutilisé pour un contrôle TCP. |
| `startup_probe_config` | `{ enabled = true, type = "TCP", path = "/api/health", initial_delay_seconds = 30, period_seconds = 10, failure_threshold = 30 }` | Sonde de démarrage Kubernetes. `failure_threshold = 30` laisse à Listmonk jusqu'à 300 secondes (30 × 10 s) pour démarrer avant que Kubernetes ne redémarre le pod — suffisant même pour les migrations de schéma lors d'un démarrage à froid. |
| `uptime_check_config` | `{ enabled = false, path = "/api/health" }` | Test de disponibilité Cloud Monitoring. **Désactivé par défaut** — activez-le explicitement si vous souhaitez qu'une alerte soit envoyée à `support_users` lorsque le point de terminaison ne répond plus (notez que `/api/health` exige une session : un test de disponibilité HTTP devrait donc cibler `/health` à la place). |

La variable `alert_policies` est disponible et se comporte comme décrit dans [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 14 : Règles de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#7-reliability--scheduling).

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Empêche que tous les pods Listmonk soient interrompus simultanément lors des mises à niveau des nœuds GKE. Fortement recommandé pour les déploiements de production. |
| `pdb_min_available` | `"1"` | Au moins un pod reste disponible lors des interruptions volontaires. Avec un déploiement à réplica unique, cela bloque les opérations de drainage des nœuds — utilisez au moins 2 réplicas en production pour permettre une maintenance progressive. |

Variables supplémentaires : `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Cache Redis {#group-15-redis-cache}

Ces variables configurent l'intégration facultative de Redis. Listmonk n'utilise **pas** Redis dans son architecture de base — `enable_redis` vaut `false` par défaut et Redis n'est pas requis pour exécuter Listmonk.

> **Remarque :** Redis est désactivé par défaut dans `Listmonk GKE`. Contrairement aux applications qui utilisent Redis pour la mise en cache des pages, Listmonk gère en interne toute la planification des campagnes et la gestion des abonnés, sans couche de cache. N'activez Redis que si vous avez un cas d'usage d'intégration précis, comme un plugin personnalisé ou une file de tâches externe.

| Variable | Valeur par défaut | Options / format | Description et implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | Désactivé par défaut. Listmonk n'a pas besoin de Redis. N'activez cette option que si une intégration personnalisée ou un service sidecar de votre déploiement consomme Redis. Lorsqu'elle est activée et que `redis_host` est vide, le module utilise par défaut l'IP du serveur NFS — assurez-vous que `enable_nfs = true` ou fournissez un `redis_host` explicite. |
| `redis_host` | `""` | Nom d'hôte ou adresse IP | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS découverte automatiquement lorsque Redis est activé. Remplacez-le par un hôte dédié pour une instance Google Cloud Memorystore. |
| `redis_port` | `"6379"` | Numéro de port (chaîne) | Port Redis standard. Ne le modifiez que si votre instance Redis utilise un port non standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification du serveur Redis. Laissez vide pour un Redis sans authentification. Pour Memorystore avec AUTH activé, indiquez la chaîne AUTH de l'instance. |

### Valider les paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Instance Memorystore (le cas échéant) :** accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et l'état d'AUTH.
- **Variables d'environnement Redis dans le pod :** confirmez que la variable d'environnement `REDIS_HOST` est présente dans l'environnement du pod Listmonk si Redis a été activé.

**gcloud CLI / kubectl :**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm any Redis environment variables are set in the Listmonk pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i redis

# Test Redis connectivity from inside the Listmonk pod (if enabled)
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379
```

---

## Groupe 16 : Domaine personnalisé et IP statique {#group-16-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#5-traffic--ingress).

> **Configuration de l'URL de base de Listmonk :** Listmonk doit connaître son URL publique pour générer les liens de désabonnement, les e-mails de confirmation et les pixels de suivi des campagnes. Il ne s'agit **pas** d'une variable d'environnement — `app.root_url` est une ligne de la table `settings` de Listmonk ; le script `entrypoint.sh` de `Listmonk_Common` la définit donc automatiquement à chaque démarrage à partir de `GKE_SERVICE_URL`, injectée par la plateforme, après l'étape `--install` (à l'aide de `psql`, car `--install` ne l'initialise que via `INSERT ... ON CONFLICT DO NOTHING` ; l'`UPDATE` du point d'entrée l'emporte donc toujours lors des démarrages suivants). Si vous associez un domaine personnalisé via `application_domains`, vérifiez `app.root_url` sous **Settings → General** dans l'interface de Listmonk et mettez-la à jour manuellement si elle affiche encore l'URL du service GKE au lieu de votre domaine personnalisé.

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds` (par défaut `30`), `gke_cluster_selection_mode` (par défaut `"primary"` ; options : `explicit`, `round-robin`, `primary`), `network_name` (par défaut `""` ; découvert automatiquement s'il est vide).

> **Remarque sur l'affinité de session :** `session_affinity` vaut `"ClientIP"` par défaut dans Listmonk GKE. C'est essentiel pour l'interface de gestion des campagnes de Listmonk : sans affinité de session, l'interface web de Listmonk peut perdre l'état d'édition d'une campagne entre deux chargements de page lorsque les requêtes sont acheminées vers des réplicas de pod différents. Conservez `"ClientIP"` pour tout déploiement Listmonk GKE à plusieurs réplicas.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#a-compute-gke-autopilot) (`workload_type = "StatefulSet"`) et les variables StatefulSet associées.

Variables disponibles : `stateful_pvc_enabled` (par défaut `null`), `stateful_pvc_size` (par défaut `"10Gi"`), `stateful_pvc_mount_path` (par défaut `"/data"`), `stateful_pvc_storage_class` (par défaut `"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group` (par défaut `0`).

> **Sélection automatique de StatefulSet :** définir `stateful_pvc_enabled = true` sans `workload_type` explicite aboutit automatiquement à `"StatefulSet"`. Définir `workload_type = "Deployment"` en même temps que `stateful_pvc_enabled = true` échoue au moment du plan.

Listmonk stocke tout son état persistant dans PostgreSQL plutôt que sur le disque local ; `stateful_pvc_enabled` n'est donc pas nécessaire en fonctionnement normal. N'activez les PVC StatefulSet que si votre déploiement nécessite un système de fichiers local stable — par exemple pour des données de plugins personnalisés ou des tampons de file d'attente locaux.

---

## Sorties du module {#module-outputs}

`Listmonk GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_url` | URL du service |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID du déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré (inline) — le cluster est créé mais son point de terminaison n'est pas encore lisible, de sorte que les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |

---

## Explorer avec la console GCP {#exploring-with-the-gcp-console}

Une fois votre déploiement Listmonk GKE terminé, la console GCP offre une vue détaillée de chaque couche du déploiement. Cette section parcourt chaque zone et explique ce qu'il faut vérifier.

### Charges de travail GKE {#gke-workloads}

Accédez à **Kubernetes Engine → Workloads** dans la console GCP. Sélectionnez votre cluster dans la liste déroulante des clusters.

- **Deployment Listmonk :** vous devriez voir un Deployment nommé `listmonk-<tenant_id>` dans l'espace de noms `listmonk-<tenant_id>`. La colonne **Pods** doit afficher au moins `1/1` pod en cours d'exécution si `min_instance_count = 1`. Ouvrez le Deployment pour consulter le modèle de pod, les variables d'environnement (y compris la configuration `LISTMONK_*`), les demandes et limites de ressources, ainsi que le conteneur sidecar Cloud SQL Auth Proxy.
- **Job db-init :** lors du premier déploiement, un Job terminé nommé `db-init` apparaît dans le même espace de noms sous **Kubernetes Engine → Workloads** (filtrez par type de ressource : Job). Une coche verte indique que la base de données PostgreSQL et l'utilisateur ont été créés avec succès. Si le job affiche un état d'échec en rouge, ouvrez les journaux de son pod pour diagnostiquer le problème de connexion à Cloud SQL ou d'identifiants.
- **Pods :** accédez à **Kubernetes Engine → Pods** et filtrez par espace de noms. Chaque pod en cours d'exécution comporte deux conteneurs : le conteneur de l'application Listmonk (`listmonk`) et le sidecar Cloud SQL Auth Proxy (`cloud-sql-proxy`). Cliquez sur un pod et sélectionnez l'onglet **Logs** pour suivre en direct les journaux de l'application depuis la console.
- **Services et Ingress :** accédez à **Kubernetes Engine → Services & Ingress**. Le service LoadBalancer de Listmonk apparaît avec une colonne **External endpoints** indiquant l'adresse IP et le port provisionnés. Si `enable_custom_domain = true`, une ressource Gateway ou Ingress apparaît à côté.

### Cloud SQL {#cloud-sql}

Accédez à **SQL** dans la console GCP.

- **Instance :** l'instance Cloud SQL est généralement nommée `app-sql-<tenant_id>` (ou porte un nom personnalisé si `sql_instance_name` a été défini). Cliquez sur l'instance pour vérifier que sa version de base de données indique **PostgreSQL 15**. L'onglet **Overview** affiche l'utilisation du CPU et de la mémoire, les connexions actives et le débit des requêtes — utile pour confirmer que Listmonk se connecte et envoie des requêtes.
- **Bases de données :** dans l'onglet **Databases** de l'instance, confirmez que la base de données `listmonk` existe (ou votre `application_database_name` personnalisée). C'est la base de données créée par la migration de schéma de Listmonk au premier démarrage.
- **Utilisateurs :** dans l'onglet **Users**, confirmez que l'utilisateur `listmonk` (ou votre `application_database_user`) existe. Listmonk se connecte sous cet utilisateur pour toutes les opérations de base de données.
- **Connexions :** dans l'onglet **Connections**, confirmez que l'instance est configurée en IP privée uniquement (si vous utilisez la connectivité VPC native) ou que Cloud SQL Auth Proxy est le seul chemin de connexion. La connexion Auth Proxy depuis le cluster GKE apparaît dans le panneau **Active connections**.
- **Sauvegardes :** dans l'onglet **Backups**, confirmez que les sauvegardes automatiques sont activées et que la sauvegarde la plus récente s'est terminée avec succès. La planification des sauvegardes suit `backup_schedule` (par défaut `0 2 * * *`).

### Secret Manager {#secret-manager}

Accédez à **Security → Secret Manager** dans la console GCP.

- **Mot de passe de la base de données :** un secret nommé `secret-<resource_prefix>-<app>-db-password` (ou similaire, géré par le socle) contient l'identifiant de base de données généré automatiquement. Cliquez sur le secret et accédez à **Versions** pour confirmer qu'une version actuelle `ENABLED` existe. Ne désactivez pas et ne détruisez pas cette version — elle est montée dans le pod Listmonk à l'exécution.
- **Mot de passe administrateur :** un secret nommé `secret-<resource_prefix>-listmonk-admin-password` (injecté sous la forme `LISTMONK_ADMIN_PASSWORD`) contient le mot de passe généré aléatoirement de l'interface d'administration de Listmonk (le nom d'utilisateur est `admin`, codé en dur). Ouvrez la dernière version et utilisez **Access secret value** pour récupérer le mot de passe de votre première connexion. Enregistrez immédiatement cet identifiant dans un gestionnaire de mots de passe.
- **Jeton d'API :** un secret nommé `secret-<resource_prefix>-listmonk-api-token` (injecté sous la forme `LISTMONK_API_TOKEN`) contient le jeton d'API déterministe de l'utilisateur d'API programmatique auto-réparateur.
- **Journal d'accès :** l'onglet **Access log** de chaque secret affiche un journal Cloud Audit Logs de chaque accès à une version, avec le compte de service concerné et l'adresse IP d'origine. Vérifiez que seul le compte de service Workload Identity de Listmonk accède au secret du mot de passe de la base de données.

### Artifact Registry {#artifact-registry}

Accédez à **Artifact Registry → Repositories** dans la console GCP.

- **Dépôt :** si `container_image_source = "custom"` et `enable_image_mirroring = true`, un dépôt portant le nom du déploiement (par ex. `listmonk-<tenant_id>`) contient l'image Listmonk construite. Le dépôt affiche le tag de l'image (correspondant à `application_version`) et le digest.
- **Détails de l'image :** cliquez sur un tag d'image pour afficher le digest complet, la taille, la date de création et les résultats de l'analyse des vulnérabilités. Examinez l'onglet des vulnérabilités avant toute promotion en production — l'image de base de Listmonk est régulièrement mise à jour, et la stratégie de rétention de la plateforme (`max_images_to_retain = 7`) supprime automatiquement les anciennes versions d'image.
- **Stratégies de nettoyage :** dans l'onglet **Settings** du dépôt, confirmez que la stratégie de nettoyage est configurée pour conserver les `max_images_to_retain` dernières images et supprimer les images sans tag au bout de `image_retention_days` jours.

### Cloud Monitoring {#cloud-monitoring}

Accédez à **Monitoring → Dashboards** ou **Monitoring → Uptime checks** dans la console GCP.

- **Tests de disponibilité :** `uptime_check_config.enabled` vaut `false` par défaut. S'il est explicitement activé, un test de disponibilité ciblant `GET /api/health` sur le point de terminaison du service Listmonk apparaît (notez que ce chemin renvoie 403 sans authentification — ciblez plutôt `/health` pour un contrôle significatif). Un indicateur vert confirme que le point de terminaison répond. Un état rouge ou jaune déclenche une alerte vers `support_users`.
- **Stratégies d'alerte :** accédez à **Monitoring → Alerting**. Deux stratégies d'alerte sont provisionnées automatiquement : l'une pour les échecs du test de disponibilité et l'autre pour le seuil d'échec du contrôle. Cliquez sur chaque stratégie pour confirmer que les canaux de notification (adresses e-mail de `support_users`) sont correctement configurés.
- **Metrics Explorer :** accédez à **Monitoring → Metrics Explorer** et interrogez `kubernetes.io/container/cpu/request_utilisation` et `kubernetes.io/container/memory/used_bytes` pour le conteneur `listmonk` de votre espace de noms. Comparez-les au `cpu_limit` (`1000m`) et au `memory_limit` (`512Mi`) configurés pour valider le dimensionnement des ressources pendant les envois de campagnes actifs.
- **Vue d'ensemble du cluster GKE :** accédez à **Kubernetes Engine → Clusters**, cliquez sur votre cluster et sélectionnez l'onglet **Observability** pour afficher l'utilisation du CPU et de la mémoire au niveau des nœuds. GKE Autopilot provisionne les nœuds à la demande — pendant l'envoi d'une grosse campagne, vous pouvez observer un événement de provisionnement de nœud lorsque les besoins en ressources des pods augmentent temporairement.

### Cloud Build (si la CI/CD est activée) {#cloud-build-if-cicd-enabled}

Accédez à **Cloud Build → History** dans la console GCP.

- **Historique des builds :** chaque push sur la branche correspondant à `cicd_trigger_config.branch_pattern` (par défaut `^main$`) déclenche un build. Les builds sont listés avec leur état, leur durée et le commit déclencheur. Cliquez sur un build pour afficher le journal étape par étape, y compris la construction de l'image, le push vers Artifact Registry et le déclenchement facultatif du déploiement.
- **Déclencheurs :** accédez à **Cloud Build → Triggers** pour confirmer que le déclencheur est connecté au bon dépôt GitHub et au bon modèle de branche.

---

## Explorer avec gcloud / kubectl {#exploring-with-gcloud--kubectl}

Les commandes suivantes vous permettent d'inspecter chaque couche d'un déploiement Listmonk GKE depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION`, `CLUSTER_NAME`, `NAMESPACE` et `POD_NAME` par vos valeurs réelles. L'espace de noms et le nom du déploiement sont généralement `listmonk-<tenant_id>`.

```bash
# ── Cluster Access ──────────────────────────────────────────────────────────

# Fetch GKE cluster credentials and set the local kubeconfig context
gcloud container clusters get-credentials CLUSTER_NAME \
  --region REGION \
  --project PROJECT_ID

# List all GKE clusters in the project to find the correct cluster name
gcloud container clusters list \
  --project PROJECT_ID \
  --format="table(name,location,status,currentNodeCount)"

# ── Namespace & Workload Overview ────────────────────────────────────────────

# List all pods in the Listmonk namespace and their status
kubectl get pods -n NAMESPACE -o wide

# Show full details of the Listmonk Deployment (replicas, strategy, conditions)
kubectl describe deployment listmonk-DEPLOYMENT_ID -n NAMESPACE

# Watch pods in real time during a rolling update or new deployment
kubectl get pods -n NAMESPACE --watch

# ── Pod Logs ─────────────────────────────────────────────────────────────────

# Tail live logs from the Listmonk application container
kubectl logs -n NAMESPACE POD_NAME -c listmonk --follow

# Show the last 100 lines from the Cloud SQL Auth Proxy sidecar container
kubectl logs -n NAMESPACE POD_NAME -c cloud-sql-proxy --tail=100

# Show logs from all Listmonk pods simultaneously (useful after a campaign send)
kubectl logs -n NAMESPACE -l app=listmonk --all-containers=true --follow

# ── Container Environment & Health ───────────────────────────────────────────

# List all environment variables inside the Listmonk container (confirm LISTMONK_* vars)
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- env | grep LISTMONK

# Confirm the Cloud SQL Auth Proxy socket is present inside the container
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- ls -la /cloudsql/

# Test the Listmonk health endpoint from inside the container
kubectl exec -n NAMESPACE POD_NAME -c listmonk -- \
  wget -qO- http://localhost:9000/api/health

# ── Services & Networking ─────────────────────────────────────────────────────

# Show the Listmonk Kubernetes Service and its external IP
kubectl get service -n NAMESPACE

# Describe the LoadBalancer service to see provisioned IP and port mappings
kubectl describe service listmonk-DEPLOYMENT_ID -n NAMESPACE

# ── Initialization Jobs ───────────────────────────────────────────────────────

# List all Jobs in the namespace (including the db-init job)
kubectl get jobs -n NAMESPACE

# Show the logs from the db-init job pod to confirm successful DB creation
kubectl logs -n NAMESPACE -l job-name=db-init

# ── Cloud SQL ─────────────────────────────────────────────────────────────────

# List Cloud SQL instances in the project
gcloud sql instances list \
  --project PROJECT_ID \
  --format="table(name,databaseVersion,region,state,ipAddresses[0].ipAddress)"

# Describe the Listmonk Cloud SQL instance
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project PROJECT_ID \
  --format="yaml(name,databaseVersion,state,settings.backupConfiguration)"

# List databases on the Cloud SQL instance
gcloud sql databases list \
  --instance SQL_INSTANCE_NAME \
  --project PROJECT_ID

# List users on the Cloud SQL instance
gcloud sql users list \
  --instance SQL_INSTANCE_NAME \
  --project PROJECT_ID

# ── Secret Manager ────────────────────────────────────────────────────────────

# List all secrets with the listmonk deployment prefix
gcloud secrets list \
  --project PROJECT_ID \
  --filter="name:listmonk" \
  --format="table(name,createTime,replication.automatic)"

# Access the Listmonk admin password secret value (first login)
gcloud secrets versions access latest \
  --secret="secret-RESOURCE_PREFIX-listmonk-admin-password" \
  --project PROJECT_ID

# Check secret version status (confirm the latest version is ENABLED)
gcloud secrets versions list LISTMONK_DB_PASSWORD_SECRET_NAME \
  --project PROJECT_ID \
  --format="table(name,state,createTime)"

# ── GCS Storage ───────────────────────────────────────────────────────────────

# List GCS buckets created for this Listmonk deployment
gsutil ls -p PROJECT_ID | grep listmonk

# Show the contents of the Listmonk uploads bucket
gsutil ls gs://LISTMONK_UPLOADS_BUCKET_NAME/

# ── Resource Usage ────────────────────────────────────────────────────────────

# Show live CPU and memory usage for all pods in the namespace
kubectl top pods -n NAMESPACE

# Show node-level resource usage for the GKE Autopilot cluster
kubectl top nodes
```

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(obligatoire)* | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Listmonk ne prend en charge que PostgreSQL. Passer à une variante MySQL fait échouer Listmonk au démarrage avec une erreur de pilote de base de données. Toute l'injection des identifiants et la construction de la chaîne de connexion supposent PostgreSQL. |
| `application_database_name` | `"listmonk"` | **Critique** | Immuable après le déploiement — la modifier recrée la base de données et détruit tous les abonnés, campagnes, listes et modèles. |
| `application_database_user` | `"listmonk"` | **Critique** | Immuable après le déploiement — la modifier recrée l'utilisateur, invalide l'identifiant stocké et rompt la connexion de Listmonk à la base de données. |
| `container_port` | `9000` | **Critique** | Listmonk écoute sur le port 9000. Le modifier sans l'aligner sur le port réellement utilisé par le conteneur fait échouer toutes les sondes de santé et place le pod dans une boucle de plantage. |
| `health_check_config.type` / `startup_probe_config.type` | `"TCP"` | **Critique** | Les deux valent par défaut un contrôle TCP sur le port 9000, et non HTTP. Passer à `"HTTP"` sur `/api/health` fait échouer chaque sonde — ce point de terminaison exige une session authentifiée et renvoie 403 au kubelet, ce qui provoque une boucle de redémarrage permanente. |
| `startup_probe_config.failure_threshold` | `30` | **Élevé** | Listmonk exécute les migrations de schéma au premier démarrage. Réduire cette valeur sous ~10 peut amener Kubernetes à redémarrer le pod avant la fin des migrations, créant une boucle de redémarrage infinie sur les nouveaux déploiements. |
| `session_affinity` | `"ClientIP"` | **Élevé** | L'interface de gestion des campagnes de Listmonk stocke l'état en mémoire, par processus. Sans affinité de session `"ClientIP"`, l'interface web perd l'état d'édition des campagnes à chaque chargement de page acheminé vers un autre réplica de pod. |
| `container_resources.memory_limit` | `"512Mi"` | **Moyen** | Suffisant pour de petites listes au repos. Lors d'importations massives d'abonnés ou d'envois de grosses campagnes, l'utilisation de la mémoire augmente fortement. Portez-la au moins à `"1Gi"` pour les listes de plus de 50 000 abonnés. |
| `container_resources.cpu_limit` | `"1000m"` | **Moyen** | Suffisant pour un fonctionnement normal de Listmonk. Les envois fréquents de campagnes vers de grandes listes sont limités par le CPU — envisagez de passer à `"2000m"` pour les charges d'envoi actives. |
| `min_instance_count` | `1` | **Élevé** | La valeur `0` active la mise à l'échelle à zéro, qui ne convient pas à Listmonk. Le planificateur de campagnes et le gestionnaire de rebonds nécessitent un processus en exécution continue. Les démarrages à froid lors de la remontée en charge retardent les envois de campagnes en attente. |
| `enable_nfs` | `false` | **Faible** | Listmonk utilise GCS Fuse pour le stockage, et non NFS. Activer NFS provisionne inutilement une instance Filestore et entraîne un coût supplémentaire sans bénéfice pour Listmonk. |
| `enable_redis` | `false` | **Faible** | Listmonk n'utilise pas Redis. L'activer sans `redis_host` valide peut amener le module à tenter de se connecter à l'IP du serveur NFS sur le port 6379, ce qui génère des erreurs de connexion si aucun processus Redis n'y tourne. |
| `application_version` | `"latest"` | **Moyen** | L'utilisation de `"latest"` en production est déconseillée — elle rend les déploiements non reproductibles et peut introduire des changements incompatibles lors de la mise à jour de l'image en amont. Épinglez un tag de version précis (par ex. `"v4.1.0"`) en production. |
| `backup_retention_days` | `7` | **Moyen** | Trop court pour des listes de diffusion actives. Une importation d'abonnés corrompue ou la suppression accidentelle d'une liste peut ne pas être découverte en 7 jours. Portez-la à 30 jours ou plus en production. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé. Le désactiver permet que tous les pods Listmonk soient arrêtés simultanément lors des mises à niveau des nœuds GKE, ce qui interrompt le service pour les envois de campagnes en cours. |
| `pdb_min_available` | `"1"` | **Moyen** | Avec un seul réplica, le PDB empêche indéfiniment le drainage volontaire des nœuds. Utilisez au moins 2 réplicas en production pour permettre une maintenance progressive sans bloquer les mises à niveau du cluster. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'elles sont définies. Kubernetes interprète les entiers nus comme des octets, ce qui empêche la planification de tous les pods dans l'espace de noms. |
| `termination_grace_period_seconds` | `30` | **Moyen** | À l'arrêt, Listmonk traite les requêtes en cours et peut avoir des goroutines d'envoi de campagne actives. Si Listmonk est en plein envoi d'un gros lot de campagne, 30 secondes peuvent ne pas suffire pour vider la file d'attente. Envisagez de passer à `60` ou `120` pour les charges d'envoi à fort volume. |
| `enable_auto_password_rotation` | `false` | **Faible** | Désactivé par défaut. Lorsqu'elle est activée, la rotation redémarre tous les pods Listmonk. Planifiez les rotations pendant les fenêtres de maintenance pour ne pas interrompre les envois de campagnes actifs. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, l'interface d'administration de Listmonk (`/`) n'est protégée que par l'authentification propre à Listmonk. Activez Cloud Armor et configurez `admin_ip_ranges` pour tout déploiement de production accessible publiquement. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Listmonk sur GKE Autopilot](../labs/Listmonk_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Listmonk Common](Listmonk_Common.md) — la configuration partagée par les deux cibles de déploiement.
