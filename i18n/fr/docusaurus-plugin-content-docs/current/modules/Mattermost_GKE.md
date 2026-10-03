---
title: "Module Mattermost GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Mattermost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mattermost_GKE.md @ df67eef sha256:8b84186d688a -->

# Module Mattermost GKE — Guide de configuration {#mattermost-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mattermost_GKE.png" alt="Module Mattermost GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `Mattermost_GKE`. `Mattermost_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Mattermost_Common`](./Mattermost_Common) pour déployer [Mattermost](https://mattermost.com/) — une plateforme de messagerie et de collaboration d'équipe open-source et auto-hébergeable — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Mattermost GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Mattermost** sont décrites en détail ici.

> **Remarque :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE vs Cloud Run :** Mattermost maintient des connexions WebSocket persistantes pour la livraison de messages en temps réel. GKE Autopilot est mieux adapté aux déploiements Mattermost en production que Cloud Run, car il prend en charge les connexions de longue durée sans les contraintes de délai d'expiration par requête de Cloud Run. Utilisez `Mattermost GKE` pour tout déploiement de taille d'équipe où la fiabilité en temps réel est importante.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Mattermost |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Mattermost ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Mattermost pour `container_port`, `container_resources` et `min_instance_count` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | Pas de variables d'environnement pré-remplies — Mattermost est configuré via `site_url` et `edition` ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et politiques réseau | §3.D Réseau et politiques réseau | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Job PostgreSQL `db-init` fourni automatiquement par `Mattermost Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services additionnels | §3.F Services additionnels | Identique. |
| Stockage — NFS | §3.C Stockage (NFS / GCS / GCS Fuse) | `enable_nfs` utilise par défaut `true` (les téléchargements résident sur le partage NFS) ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Alternative facultative à NFS pour `/mattermost/data` ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **PostgreSQL 15 requis** ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Plan de sauvegarde et rétention | §3.B Base de données (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Jobs d'initialisation et CronJobs | Identique. |
| Observabilité et vérifications de santé | §3.A Calcul (GKE Autopilot) | Mattermost expose `/api/v4/system/ping` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| WAF Cloud Armor | §4.A WAF Cloud Armor | Identique. |
| Proxy conscient de l'identité (IAP) | §4.B Proxy conscient de l'identité (IAP) | Identique. |
| Autorisation binaire | §4.C Autorisation binaire | Identique. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |
| Pilote CSI du magasin de secrets | §4.E Pilote CSI du magasin de secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | §5 Trafic et Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | Mattermost `site_url` doit correspondre ; voir [Groupe 16 : Domaine personnalisé et IP statique](#group-16-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Déclencheurs Cloud Build | Identique. |
| Pipeline Cloud Deploy | §6.B Pipeline Cloud Deploy | Identique. |
| Mise en miroir des images | §6.C Mise en miroir des images | Identique. |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | Identique. |
| Contraintes de répartition de topologie | §7.B Contraintes de répartition de topologie | Identique. |
| Quotas de ressources | §7.C Quotas de ressources | Identique. |
| Rotation automatique des mots de passe | §7.D Rotation automatique des mots de passe | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` utilise par défaut `false` ; voir [Groupe 15 : Cache Redis](#group-15-redis-cache). |
| Importation de sauvegarde | §8.B Importation de sauvegarde | Expose à la fois `backup_uri` (URI GCS complet ou ID Drive) et `backup_file` (nom de fichier dans le bucket de sauvegarde du module) ; voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Maillage de services (ASM) | §8.C Maillage de services (ASM via Fleet) | Identique. |
| Services multi-clusters | §8.D Services multi-clusters (MCS) | Identique. |

---

## Comment Mattermost GKE est lié à App GKE {#how-mattermost-gke-relates-to-app-gke}

`Mattermost GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Mattermost Common` qui fournit des valeurs par défaut et une configuration d'application spécifiques à Mattermost. Les principaux effets sont les suivants :

1.  **PostgreSQL 15 est requis.** Mattermost nécessite PostgreSQL 13 ou une version ultérieure. La valeur par défaut `database_type` est définie sur `"POSTGRES_15"`.
2.  **Un job `db-init` s'exécute lors du premier déploiement.** `Mattermost Common` fournit un Job Kubernetes `db-init` par défaut qui crée la base de données et l'utilisateur PostgreSQL de Mattermost. Mattermost exécute ensuite ses propres migrations de schéma lors du premier démarrage — aucune configuration manuelle du schéma n'est nécessaire.
3.  **Pas de variables d'environnement pré-remplies.** Contrairement à Ghost, Mattermost ne nécessite pas de valeurs par défaut SMTP injectées par le module. Les paramètres clés — URL du site, édition, Redis — sont contrôlés par des variables de niveau supérieur dédiées (`site_url`, `edition`, `enable_redis`).
4.  **La sélection de l'édition contrôle l'image du conteneur.** La définition de `edition = "enterprise"` bascule automatiquement l'image du conteneur vers `mattermost/mattermost-enterprise-edition`. La valeur par défaut (`"team"`) utilise `mattermost/mattermost-team-edition`. L'édition Enterprise nécessite une clé de licence payante fournie via `environment_variables`.
5.  **Les téléchargements résident sur le partage NFS.** `enable_nfs` utilise par défaut `true`. Mattermost stocke les téléchargements de fichiers et les pièces jointes sur le disque local (`MM_FILESETTINGS_DRIVERTYPE = local`) sous `/mattermost/data`, où le volume NFS est monté, de sorte que les téléchargements survivent aux redémarrages des pods. Désactivez NFS uniquement si vous pointez `MM_FILESETTINGS_*` vers un stockage compatible S3.
6.  **Les valeurs par défaut des ressources sont dimensionnées pour Mattermost.** Les valeurs par défaut `cpu_limit` (2 vCPU) et `memory_limit` (4 Gi) prennent en charge la gestion concurrente des WebSockets, la mise en cache des canaux et l'indexation des messages de Mattermost.
7.  **Redis est facultatif.** `enable_redis` utilise par défaut `false`. Cela ne rend pas à lui seul plus d'un réplica sûr : l'édition Team n'a pas de clustering HA, donc `max_instance_count` utilise par défaut `1` ; plusieurs réplicas nécessitent l'édition Enterprise avec une licence.
8.  **Les sondes de santé utilisent le point de terminaison ping dédié de Mattermost.** Les deux `startup_probe` et `liveness_probe` utilisent par défaut `path = "/api/v4/system/ping"` — le point de terminaison de santé intégré de Mattermost qui renvoie HTTP 200 lorsque le serveur est prêt à accepter les connexions.
9.  **SiteURL n'est jamais vide.** Mattermost utilise `MM_SERVICESETTINGS_SITEURL` pour les e-mails de notification, la génération de liens dans l'application et les redirections OAuth. `site_url` le définit explicitement ; s'il est laissé vide, le point d'entrée le dérive au démarrage de l'URL de l'équilibreur de charge (`GKE_SERVICE_URL`).

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

**Ajouts spécifiques à Mattermost GKE dans ce groupe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `region` | `"us-central1"` | Région GCP pour le déploiement des ressources. Utilisé comme solution de repli lorsque la découverte du sous-réseau VPC ne peut pas déterminer la région. Également utilisé comme emplacement par défaut pour les buckets GCS provisionnés pour le stockage de fichiers Mattermost. |
| `site_url` | `""` | L'URL publique où Mattermost est accessible (par exemple, `"https://chat.example.com"`). Définit `MM_SERVICESETTINGS_SITEURL`. S'il est laissé vide, il est dérivé au démarrage de l'URL de l'équilibreur de charge ; définissez-le lorsque vous utilisez un domaine personnalisé. |
| `edition` | `"team"` | Édition Mattermost. `"team"` déploie l'édition Team gratuite. `"enterprise"` déploie l'édition Enterprise et nécessite une clé de licence fournie via `environment_variables`. La modification de cette valeur après le déploiement initial remplace l'image du conteneur lors du prochain apply. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-3--application-identity) pour les descriptions.

**Valeurs par défaut spécifiques à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"mattermost"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Mattermost"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `application_description` | `"Mattermost - Open-source team messaging on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"9.11.2"` | `"1.0.0"` | La version de Mattermost à construire et à déployer. L'incrémentation de cette valeur déclenche une nouvelle exécution de Cloud Build. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

**Valeurs par défaut et comportement spécifiques à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `8065` | `8080` | Port HTTP natif de Mattermost. Ne pas modifier, sauf si votre Dockerfile personnalisé lie Mattermost à un port différent. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Mattermost gère les connexions WebSocket concurrentes, la mise en cache des canaux et l'indexation des messages. 2 vCPU et 4 Gi sont les minimums de production recommandés. |
| `min_instance_count` | `1` | `0` | Mattermost maintient des connexions WebSocket persistantes. La mise à l'échelle à zéro interrompt les sessions utilisateur actives. Maintenez à `1` ou plus pour tout déploiement avec des utilisateurs actifs. |
| `max_instance_count` | `1` | `3` | L'édition Team n'a pas de clustering HA, donc un deuxième réplica ne partagerait pas l'état WebSocket. N'augmentez cette valeur qu'avec l'édition Enterprise et une licence. |
| `container_image_source` | `"custom"` | `"custom"` | `Mattermost Common` fournit une construction basée sur Dockerfile par défaut. Définissez sur `"prebuilt"` pour déployer directement un URI d'image pré-construite. |
| `enable_cloudsql_volume` | `false` | `true` | Mattermost GKE se connecte à Cloud SQL via une connexion TCP privée plutôt que via un sidecar de socket Unix par défaut. Définissez sur `true` pour injecter le sidecar Cloud SQL Auth Proxy. |
| `timeout_seconds` | `300` | `300` | Pour les déploiements à forte utilisation de WebSocket, augmentez à `3600` pour éviter que les connexions WebSocket actives ne soient interrompues par le délai d'expiration du backend. |
| `container_protocol` | `"http1"` | `"http1"` | Mattermost utilise HTTP/1.1 pour son chemin de mise à niveau WebSocket. Ne pas passer à `"h2c"`, sauf si votre configuration Mattermost prend explicitement en charge HTTP/2. |

Les variables d'exécution restantes (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `service_annotations`, `service_labels`, `cloudsql_volume_mount_path`) se comportent comme décrit dans [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy), [App_GKE](./App_GKE.md#group-19--access--networking) et [App_GKE](./App_GKE.md#group-21--cloud-armor--cdn).

> **Remarque :** Les variables `ingress_settings` et `vpc_egress_setting` apparaissent dans les définitions de variables de `Mattermost GKE` mais ne sont **pas transmises à `App GKE`**. La définition de ces variables n'a aucun effet sur l'infrastructure déployée dans l'implémentation actuelle.

Les variables réseau suivantes sont disponibles dans `Mattermost GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification par proxy conscient de l'identité (IAP) sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service ayant accès à l'IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google ayant accès à l'IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration de l'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration de l'IAP. |
| `iap_support_email` | `""` | E-mail d'assistance affiché sur l'écran de consentement Google OAuth. |
| `enable_custom_domain` | `true` | Configure Ingress/Gateway pour le routage de domaine personnalisé avec des certificats SSL gérés. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple, `["chat.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; généré automatiquement si vide. |
| `network_tags` | `["nfsserver"]` | Balises de pare-feu appliquées aux nœuds du cluster GKE. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre des contrôles de service VPC. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Comportement spécifique à Mattermost :**

`Mattermost GKE` ne pré-remplit **pas** `environment_variables` avec les paramètres Mattermost. La configuration de Mattermost est contrôlée par trois mécanismes :

1.  **`site_url`** définit `MM_SERVICESETTINGS_SITEURL` automatiquement via `Mattermost Common`.
2.  **`edition`** sélectionne l'image du conteneur (`team` ou `enterprise`) automatiquement.
3.  **`environment_variables`** accepte toutes les variables d'environnement Mattermost supplémentaires (en utilisant la convention de préfixe `MM_`).

**Clé de licence Enterprise Edition :**

Lorsque `edition = "enterprise"`, fournissez la clé de licence via `environment_variables` :

```
environment_variables = {
  MM_LICENSE = "your-mattermost-enterprise-licence-key"
}
```

**Surcharges courantes des variables d'environnement Mattermost :**

| Variable | Objectif |
|---|---|
| `MM_EMAILSETTINGS_SMTPSERVER` | Serveur SMTP pour les notifications par e-mail. |
| `MM_EMAILSETTINGS_SMTPPORT` | Port SMTP (par exemple, `"587"`). |
| `MM_EMAILSETTINGS_SMTPUSERNAME` | Nom d'utilisateur d'authentification SMTP. |
| `MM_EMAILSETTINGS_SMTPPASSWORD` | Mot de passe d'authentification SMTP. |
| `MM_EMAILSETTINGS_ENABLESMTPAUTH` | `"true"` pour activer l'authentification SMTP. |
| `MM_EMAILSETTINGS_FEEDBACKEMAIL` | Adresse d'expéditeur pour les e-mails de notification. |
| `MM_SERVICESETTINGS_ENABLEDEVELOPER` | `"false"` pour la production (désactive le mode développeur). |

Les variables de secrets restantes (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-17--backup--maintenance).

**Valeurs par défaut spécifiques à Mattermost :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajustez pour correspondre à votre objectif de point de récupération et aux modèles de trafic. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez pour les déploiements en production (30 à 90 jours recommandés). |

**Importation de sauvegarde** — Mattermost GKE prend en charge l'importation d'une sauvegarde existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'importation unique pendant le déploiement pour restaurer la sauvegarde spécifiée par `backup_uri`. Configurez `backup_source`, `backup_uri` et `backup_format` avant d'activer. |
| `backup_source` | `"gcs"` | Système source pour le fichier de sauvegarde. `"gcs"` importe à partir d'un URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (`"gs://my-bucket/backups/mattermost.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde stockée dans le bucket GCS de sauvegardes créé automatiquement par le module. Une alternative à `backup_uri` pour les sauvegardes déjà placées dans le bucket géré par le module. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

Les variables CI/CD suivantes sont disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode` (valeur par défaut `"ALWAYS_ALLOW"` ; options : `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`).

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation), avec un comportement important spécifique à Mattermost.

**Job `db-init` par défaut de Mattermost :**

Lorsque `initialization_jobs` est laissé par défaut (liste vide `[]`), `Mattermost Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image client PostgreSQL |
| Objectif | Crée la base de données et l'utilisateur PostgreSQL de Mattermost ; Mattermost exécute ensuite ses propres migrations de schéma lors du premier démarrage |
| CPU / Mémoire | `1000m` / `512Mi` |

Remplacez `initialization_jobs` par une liste non vide pour remplacer cette valeur par défaut par vos propres jobs. Chaque job personnalisé doit spécifier au moins l'un des éléments suivants : `command`, `args` ou `script_path`.

**CronJobs et services supplémentaires :**

Les variables `cron_jobs` et `additional_services` sont disponibles et se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-11--workload-automation) pour une documentation complète.

> **Remarque :** Le schéma `cron_jobs` dans `Mattermost GKE` utilise les champs CronJob de Kubernetes — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — plutôt que les champs de style Cloud Run utilisés dans `Mattermost CloudRun`. Le champ `secret_env_vars` n'est pas disponible dans les cron jobs GKE ; les secrets sont gérés via `secret_environment_variables` au niveau du module.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-13--nfs-storage).

**Valeurs par défaut spécifiques à Mattermost :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut pour Mattermost : les téléchargements sont écrits sur le disque local à `/mattermost/data`, et sans ce montage, ils sont perdus lorsque le pod est remplacé. Définissez `false` uniquement si vous pointez `MM_FILESETTINGS_*` vers un stockage compatible S3. |
| `nfs_mount_path` | `"/mattermost/data"` | Le chemin où le volume NFS est monté à l'intérieur du conteneur Mattermost. Correspond au répertoire de données par défaut de Mattermost. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

**Comportement spécifique à Mattermost :**

Mattermost stocke les téléchargements d'équipe, les pièces jointes et les données de plugin sous `/mattermost/data`. Le montage NFS par défaut rend déjà ce chemin durable ; comme alternative, vous pouvez provisionner un bucket GCS et le monter via le pilote CSI GCS Fuse :

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

Contrairement à Ghost GKE, `Mattermost Common` ne provisionne **pas** automatiquement un bucket GCS. Vous devez définir `storage_buckets` et `gcs_volumes` explicitement si vous souhaitez un stockage de fichiers basé sur GCS.

Les variables `create_cloud_storage`, `storage_buckets` et `gcs_volumes` se comportent comme décrit dans [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-16--database-configuration).

**Valeurs par défaut et restrictions spécifiques à Mattermost :**

| Variable | Valeur par défaut Mattermost GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | **Mattermost nécessite PostgreSQL 13 ou une version ultérieure.** Ne pas passer à MySQL ou SQL Server — Mattermost ne démarrera pas. |
| `application_database_name` | `"mattermost"` | `"gkeappdb"` | Nom de la base de données PostgreSQL pour Mattermost. Ne pas modifier après le déploiement — ceci est transmis directement à `Mattermost Common` comme `db_name`. |
| `application_database_user` | `"mattermost"` | `"gkeappuser"` | Utilisateur PostgreSQL pour Mattermost. Ne pas modifier après le déploiement — transmis à `Mattermost Common` comme `db_user`. |

> **Important :** `application_database_name` et `application_database_user` sont transmis à `Mattermost Common` comme `db_name` et `db_user`. Contrairement à Ghost GKE, il n'y a pas de variables abrégées `db_name`/`db_user` séparées dans `Mattermost GKE` — `application_database_name` et `application_database_user` servent les deux objectifs.

**Découverte d'instances Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base pour l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté. |

**Extensions PostgreSQL :**

Mattermost ne nécessite pas d'extensions PostgreSQL personnalisées par défaut, mais le module expose des variables de gestion d'extensions pour les déploiements avancés :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions PostgreSQL à installer (par exemple, `["pg_trgm", "btree_gin"]`). |

La **rotation automatique des mots de passe** est également prise en charge :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique des mots de passe de base de données. Lorsque `true`, le mot de passe de la base de données est tourné selon le calendrier défini par `secret_rotation_period` et les pods GKE sont redémarrés pour récupérer la nouvelle information d'identification. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods, pour permettre la réplication de Secret Manager. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-18--custom-sql-scripts).

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-10--observability).

**Valeurs par défaut spécifiques à Mattermost :**

Mattermost expose un point de terminaison de santé dédié à `/api/v4/system/ping` qui renvoie HTTP 200 et un corps de statut JSON lorsque le serveur est entièrement initialisé et prêt à accepter les connexions. `startup_probe`/`liveness_probe` utilisent ce chemin par défaut.

### Routage des sondes de santé {#health-probe-routing}

`Mattermost GKE` déclare **deux ensembles** de variables de sonde, mais un seul d'entre eux est réellement conséquent :

| Ensemble de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Mattermost Common` | La spécification de sonde Kubernetes réelle du conteneur d'application — c'est ce que App_GKE connecte au déploiement/StatefulSet déployé (`local.selected_module.startup_probe`/`.liveness_probe`) |
| `startup_probe_config`, `health_check_config` | Directement `App GKE` | **Inerte pour Mattermost.** `App_GKE` ne les connecte qu'à son propre préréglage d'échantillon/de secours `gkeapp` interne et inutilisé (`gkeapp.tf`) — elles n'atteignent jamais le conteneur Mattermost déployé |

Ce ne sont pas des alias. La modification de `startup_probe` affecte la sonde réelle déployée ; la modification de `startup_probe_config`/`health_check_config` n'a aucun effet sur Mattermost — laissez-les à leurs valeurs par défaut et configurez la vérification de santé exclusivement via `startup_probe`/`liveness_probe`.

**Sonde de démarrage** (`startup_probe` → `Mattermost Common`) :

| Champ | Valeur par défaut Mattermost | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Point de terminaison de disponibilité intégré de Mattermost. |
| `initial_delay_seconds` | `60` | `10` | Mattermost exécute des migrations PostgreSQL lors du premier démarrage, ce qui peut prendre 30 à 60 secondes pour les grandes bases de données. |
| `failure_threshold` | `30` | `3` | Permet jusqu'à 7,5 minutes de temps de démarrage (`30 × 15s`). Suffisant pour les nouveaux déploiements avec migration de schéma. |
| `period_seconds` | `15` | `10` | — |

**Sonde de vivacité** (`liveness_probe` → `Mattermost Common`) :

| Champ | Valeur par défaut Mattermost | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Identique à la sonde de démarrage. |
| `initial_delay_seconds` | `60` | `15` | Donne à Mattermost un temps supplémentaire pour se stabiliser après le passage de la sonde de démarrage. |
| `period_seconds` | `30` | `30` | — |
| `failure_threshold` | `3` | `3` | — |

**Variables de sonde inertes** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Mattermost | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/", initial_delay_seconds = 120, failure_threshold = 15 }` | Consommé uniquement par le préréglage de secours `gkeapp` interne inutilisé de `App_GKE` — n'a aucun effet sur le conteneur Mattermost déployé. Ne vous embêtez pas à remplacer `path` ; utilisez plutôt `startup_probe`. |
| `health_check_config` | `{ enabled = true, path = "/" }` | Idem ci-dessus — inerte pour Mattermost. Utilisez plutôt `liveness_probe`. |

**`uptime_check_config` :** Utilise par défaut `{ enabled = false, path = "/" }` — les tests de disponibilité sont désactivés par défaut. Activez et définissez `path = "/api/v4/system/ping"` pour la surveillance de la production.

**Métriques Prometheus :** Mattermost expose les métriques Prometheus sur le port `8067`. Celles-ci ne sont pas collectées automatiquement par ce module mais peuvent être consommées par Cloud Monitoring à l'aide d'un exportateur de métriques personnalisé ou d'une intégration Prometheus-vers-Cloud-Monitoring.

---

## Groupe 14 : Politiques de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-9--reliability).

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

> **Remarque :** `enable_pod_disruption_budget` utilise par défaut `false` dans `Mattermost GKE`. Activez-le pour les déploiements en production où les mises à niveau de nœuds glissantes ne doivent pas mettre tous les pods Mattermost hors ligne simultanément.

---

## Groupe 15 : Cache Redis {#group-15-redis-cache}

Ces variables configurent l'intégration Redis facultative de Mattermost. Le support d'infrastructure Redis sous-jacent est fourni par `App_GKE` (voir [App_GKE](./App_GKE.md#group-15--redis-cache)) ; les variables ci-dessous sont spécifiques à Mattermost. Mattermost utilise Redis comme cache distribué et backend de session — requis pour un comportement correct sur plus d'un réplica de pod.

> **Remarque :** `enable_redis` utilise par défaut `false` dans `Mattermost GKE`. C'est sûr pour les déploiements à réplica unique. Pour tout déploiement avec `min_instance_count > 1` ou une mise à l'échelle horizontale, Redis doit être activé.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | Active Redis comme cache distribué et backend de session de Mattermost. Lorsque `false`, Mattermost utilise un cache intégré — les requêtes acheminées vers différents réplicas de pod ne partageront pas l'état de session, ce qui entraînera des échecs d'authentification intermittents sous charge. **Requis pour les déploiements multi-réplicas.** |
| `redis_host` | `""` | Nom d'hôte ou adresse IP | Le nom d'hôte ou l'adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS découverte automatiquement (le Redis co-hébergé par défaut de la plateforme). Remplacez par une IP ou un nom d'hôte explicite lorsque vous utilisez une instance Redis dédiée telle que Google Cloud Memorystore. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Chaîne de numéro de port | Port TCP pour le serveur Redis. La valeur par défaut `6379` est le port Redis standard. Ne modifiez que si votre instance Redis est configurée pour écouter sur un port non standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification pour le serveur Redis. Laissez vide si l'instance Redis ne nécessite pas d'authentification. Pour les instances Memorystore avec AUTH activé, définissez-le sur la chaîne AUTH de l'instance. Traité comme sensible — non stocké dans l'état Terraform en texte clair. |

### Validation des paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Instance Memorystore (si utilisée) :** Accédez à **Memorystore → Redis** pour confirmer que l'instance existe, son adresse IP, son port et son statut AUTH.
- **Statut Redis de Mattermost :** Une fois déployé, accédez à la console système de Mattermost (**Environnement → Cache**) ou consultez les journaux du conteneur pour les messages d'initialisation du cache.

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

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

> **Configuration `site_url` de Mattermost :** Mattermost doit connaître son URL publique au démarrage. Lorsque vous utilisez un domaine personnalisé, définissez `site_url` pour qu'il corresponde au domaine dans `application_domains` (par exemple, `site_url = "https://chat.example.com"`). Mattermost utilise cette URL pour les e-mails de notification, les redirections de fournisseurs OAuth et la génération de liens dans l'application — un `site_url` incorrect entraîne des liens de notification brisés, des échecs de connexion OAuth et des liens profonds d'application mobile incorrects.

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-6--gke-backend-config).

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode` (valeur par défaut `"primary"`), `network_name` (valeur par défaut `""` ; découverte automatique si vide), `prereq_gke_subnet_cidr` (valeur par défaut `"10.201.0.0/24"`).

> **Remarque sur l'affinité de session :** `session_affinity` utilise par défaut `"ClientIP"`. Mattermost utilise des jetons de session côté serveur. Sans affinité de session, les utilisateurs peuvent rencontrer des erreurs d'authentification intermittentes lorsque les requêtes sont acheminées vers différents réplicas de pod qui ne partagent pas un cache de session en mémoire. Conservez `"ClientIP"`, sauf si Redis est activé avec un backend de session partagé.

> **Type de service :** `service_type` utilise par défaut `"LoadBalancer"`. Cela provisionne un équilibreur de charge externe. Pour les déploiements Mattermost uniquement internes, passez à `"ClusterIP"` et configurez un Ingress séparément.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#group-7--statefulset--pvc).

La définition de `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `"StatefulSet"`. Cela fournit à chaque pod Mattermost son propre PVC dédié pour le stockage local, comme alternative au volume NFS par défaut.

Variables disponibles : `stateful_pvc_enabled`, `stateful_pvc_size` (valeur par défaut `"10Gi"`), `stateful_pvc_mount_path` (valeur par défaut `"/mattermost/data"`), `stateful_pvc_storage_class` (valeur par défaut `"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

---

## Groupe 19 : Quota de ressources {#group-19-resource-quota}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-8--resource-quota).

Variables disponibles : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs`.

> **Exigence de suffixe de quota de mémoire :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes d'unité binaire (par exemple, `"8Gi"`, `"4096Mi"`). Les entiers nus sont traités comme des octets par Kubernetes et bloqueront toute planification de pod.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

**Charges de travail :**
Accédez à **Kubernetes Engine → Charges de travail** et filtrez par espace de noms (le nom de l'espace de noms est dérivé de `application_name` et `tenant_id`). Le déploiement ou le StatefulSet Mattermost, le job `db-init` et tous les CronJobs configurés apparaissent ici.

**Services et Ingress :**
Accédez à **Kubernetes Engine → Services et Ingress** pour trouver le service Mattermost, son adresse IP externe et toutes les ressources Ingress configurées. Si `reserve_static_ip = true`, l'IP réservée apparaît sous **Réseau VPC → Adresses IP**.

**Stockage :**
Accédez à **Cloud Storage → Buckets** et recherchez les buckets préfixés par `app` et votre `application_name` pour trouver le bucket de données Mattermost et le bucket de sauvegarde automatisé.

**Base de données :**
Accédez à **SQL** pour trouver l'instance Cloud SQL PostgreSQL 15. Le nom de l'instance suit le modèle `app<name><tenant><id>-sql`. Cliquez sur l'instance pour afficher les connexions, les informations sur les requêtes et l'historique des sauvegardes.

**Secrets :**
Accédez à **Sécurité → Secret Manager** pour afficher le `DB_PASSWORD` et les autres secrets provisionnés par le module. Les noms des secrets suivent le modèle `app<name><tenant><id>-*`.

**Surveillance :**
Accédez à **Surveillance → Tableaux de bord** et **Surveillance → Alertes** pour afficher les tests de disponibilité (si `uptime_check_config.enabled = true`) et toutes les politiques d'alerte configurées via `alert_policies`.

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
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — le cluster est créé mais le point de terminaison n'est pas encore lisible, donc les ressources Kubernetes sont ignorées. Le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonctionnalité dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Mattermost ne prend en charge que PostgreSQL. La définition de `MYSQL_8_0` ou `NONE` entraîne l'échec du job `db-init` et le crash de Mattermost au démarrage. |
| `application_database_name` | `"mattermost"` | **Critique** | Immuable après le déploiement — la modification recrée la base de données et détruit toutes les données Mattermost (canaux, messages, utilisateurs). |
| `application_database_user` | `"mattermost"` | **Critique** | Immuable après le déploiement — la modification recrée l'utilisateur, invalide les identifiants et rompt la connexion de Mattermost à la base de données. |
| `site_url` | `""` (dérivé de l'URL du LB) | **Élevé** avec un domaine personnalisé | La valeur vide est dérivée au démarrage de l'URL de l'équilibreur de charge ; sur un domaine personnalisé, définissez-la avant d'inviter des utilisateurs, sinon les liens et les redirections OAuth utiliseront l'adresse du LB. |
| `edition` | `"team"` | **Élevé** | La définition de `"enterprise"` sans clé de licence valide entraîne le démarrage de Mattermost dans un état sans licence et désactive silencieusement les fonctionnalités d'entreprise. Fournissez la clé via `environment_variables`. |
| `enable_redis` | `false` | **Élevé** | Sûr pour les déploiements à réplica unique. Pour `min_instance_count > 1`, la mise en cache de session in-process provoque des échecs d'authentification intermittents lorsque les requêtes sont équilibrées entre les pods. Activez Redis pour tout déploiement multi-réplicas. |
| `min_instance_count` | `1` | **Élevé** | La définition de `0` permet la mise à l'échelle à zéro. Les démarrages à froid interrompent les connexions WebSocket actives, ce qui fait que les utilisateurs voient des bannières de déconnexion et manquent les messages en temps réel jusqu'à la reconnexion. Gardez à `1` pour la production. |
| `container_resources.memory_limit` | `"4Gi"` | **Élevé** | Mattermost met en cache les canaux actifs et les sessions utilisateur en mémoire. Un sous-provisionnement (inférieur à `2Gi`) provoque des OOM kills sous une charge d'équipe modérée, en particulier lors d'exportations de messages en masse ou d'exécution de plugins. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Sans Redis et sans affinité de session, les sessions administrateur et utilisateur ne sont pas partagées entre les pods. Les utilisateurs sont effectivement déconnectés à chaque requête qui est acheminée vers un réplica différent. |
| `container_port` | `8065` | **Critique** | Mattermost écoute sur `8065`. La modification de cela sans faire correspondre le port lié du conteneur entraîne l'échec de toutes les sondes de santé et le pod entre dans une boucle de redémarrage. |
| `timeout_seconds` | `300` | **Moyen** | Les connexions WebSocket de Mattermost sont de longue durée. Un délai d'expiration de 300 secondes du backend entraîne la coupure régulière des connexions actives. Définissez à `3600` pour les déploiements fortement basés sur WebSocket. |
| `enable_nfs` | `true` | **Moyen** | NFS est activé par défaut et contient les téléchargements. Si vous le désactivez sans configurer de stockage compatible S3 ou `gcs_volumes`, les téléchargements de fichiers Mattermost sont stockés dans le système de fichiers éphémère du conteneur et perdus lors du redémarrage du pod. |
| `create_cloud_storage` | `false` | **Moyen** | Aucun bucket GCS n'est provisionné automatiquement par ce module. Sans `create_cloud_storage = true` et une entrée `gcs_volumes`, les fichiers téléchargés ne sont pas durables après les redémarrages de pod. |
| `stateful_pvc_size` | `"10Gi"` | **Moyen** | Pour les équipes qui partagent activement des fichiers et des médias, `10Gi` se remplit rapidement. Provisionnez 50 à 100 Gi pour les équipes actives. La taille du PVC peut être étendue mais pas réduite. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers bruts sont traités comme des octets et empêchent la planification de tous les pods. |
| `backup_retention_days` | `7` | **Moyen** | Trop court pour les équipes actives. Augmentez à plus de 30 jours pour offrir une fenêtre de récupération significative. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, la page de connexion et les points de terminaison d'API de Mattermost sont exposés aux attaques par force brute et par bourrage d'identifiants. Activez-le pour tout déploiement accessible publiquement. |
| `enable_pod_disruption_budget` | `false` | **Moyen** | Désactivé par défaut. Sans PDB, les mises à niveau de nœuds GKE peuvent terminer tous les pods Mattermost simultanément, provoquant une panne totale. Activez-le pour la production. |
| `startup_probe.failure_threshold` | `30` | **Élevé** | Mattermost exécute les migrations de schéma PostgreSQL au premier démarrage. La réduction de `failure_threshold` en dessous de `20` sur les nouveaux déploiements avec de grandes bases de données peut entraîner le redémarrage du pod par Kubernetes avant la fin des migrations, créant une boucle de redémarrage. |

## Guides associés {#related-guides}

- [Lab pratique : Mattermost sur GKE Autopilot](../labs/Mattermost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune de Mattermost](Mattermost_Common.md) — la configuration partagée par les deux cibles de déploiement.
