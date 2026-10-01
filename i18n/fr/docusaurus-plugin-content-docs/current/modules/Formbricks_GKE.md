---
title: "Module Formbricks GKE — Guide de configuration"
description: "Référence de configuration pour déployer Formbricks sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Formbricks_GKE.md @ 3055034 sha256:61da22877392 -->

# Module Formbricks GKE — Guide de configuration {#formbricks-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Formbricks_GKE.png" alt="Module Formbricks GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Formbricks_GKE`. `Formbricks_GKE` est un **module enveloppe** (wrapper) qui combine le module d'infrastructure générique `App_GKE` et la configuration applicative partagée `Formbricks_Common` pour déployer [Formbricks](https://formbricks.com/), la plateforme open source de sondages et de gestion de l'expérience, sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Formbricks GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable se comporte de manière identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seuls les variables et les valeurs par défaut **propres à Formbricks** sont décrits en détail ici.

> **Remarque :** les variables marquées *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`.

| Domaine de configuration | Remarques propres à Formbricks |
|---|---|
| Métadonnées du module | Réservées à la plateforme, non transmises à `App_GKE` ; voir [Groupe 0 : Métadonnées du module](#group-0-module-metadata). |
| Projet et identité | Identique à `App_GKE`. |
| Identité de l'application | Valeurs par défaut propres à Formbricks ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | Valeurs par défaut propres à Formbricks pour `container_port`, `cpu_limit`, `memory_limit` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Cluster GKE et charge de travail | Identique à `App_GKE` ; voir [Groupe 3b : Cluster GKE et charge de travail](#group-3b-gke-cluster--workload). |
| Variables d'environnement et secrets | Secrets Formbricks injectés automatiquement ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau | Identique à `App_GKE`. |
| Scripts SQL personnalisés | Identique à `App_GKE` ; voir [Groupe 4b : Scripts SQL personnalisés](#group-4b-custom-sql-scripts). |
| Quotas de ressources | Identique à `App_GKE` ; voir [Groupe 4c : Quotas de ressources](#group-4c-resource-quotas). |
| VPC Service Controls | Identique à `App_GKE` ; voir [Groupe 4d : VPC Service Controls](#group-4d-vpc-service-controls). |
| Jobs d'initialisation | Job PostgreSQL `db-init` fourni automatiquement par `Formbricks Common` ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Stockage — NFS | `enable_nfs` vaut `true` par défaut ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | Bucket GCS `uploads` provisionné automatiquement ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | PostgreSQL 15 requis ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Planification et rétention des sauvegardes | Identique à `App_GKE`. |
| Observabilité et contrôles de santé | Endpoint `/api/v2/health` ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | Identique à `App_GKE`. |
| Identity-Aware Proxy | Identique à `App_GKE`. |
| Binary Authorization | Identique à `App_GKE`. |
| Trafic et ingress | Identique à `App_GKE`. |
| Domaine personnalisé et IP statique | Le `webapp_url` de Formbricks doit être défini en conséquence ; voir [Groupe 11 : Domaine personnalisé et IP statique](#group-11-database-configuration). |
| Déclencheurs Cloud Build | Identique à `App_GKE`. |
| Pipeline Cloud Deploy | Identique à `App_GKE`. |
| Mise en miroir des images | `enable_image_mirroring` vaut `true` par défaut. |
| Pod Disruption Budgets | Identique à `App_GKE`. |
| Contraintes de répartition topologique | Identique à `App_GKE`. |
| Rotation automatique des mots de passe | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | `enable_redis` vaut `true` par défaut ; voir [Groupe 12 : Cache Redis](#group-12-redis-cache). |
| Import de sauvegarde | Expose `backup_uri` et `backup_file`. |
| Configuration StatefulSet | Voir [Groupe 15 : Charges de travail avec état](#group-15-stateful-workloads). |

---

## Relation entre Formbricks GKE et App GKE {#how-formbricks-gke-relates-to-app-gke}

`Formbricks GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Formbricks Common` qui fournit les valeurs par défaut, les secrets et la configuration applicative propres à Formbricks. Les principaux effets sont les suivants :

1. **PostgreSQL 15 est requis.** Formbricks repose sur l'ORM Prisma ciblant PostgreSQL. La valeur par défaut de `database_type` est `"POSTGRES_15"`.
2. **Les secrets applicatifs sont générés automatiquement.** `Formbricks Common` crée `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY` et `S3_SECRET_KEY` dans Secret Manager lors du premier déploiement. Ils sont injectés dans le pod sous forme de variables d'environnement secrètes via le Secrets Store CSI Driver.
3. **Un bucket GCS `uploads` est provisionné automatiquement.** `Formbricks Common` fournit un bucket `uploads` que Formbricks utilise via l'API XML compatible S3 de GCS. Des identifiants HMAC stockés dans Secret Manager authentifient la connexion. Vous n'avez pas besoin de le définir dans `storage_buckets`.
4. **Un job `db-init` s'exécute lors du premier déploiement.** `Formbricks Common` fournit un Job Kubernetes `db-init` par défaut qui initialise le schéma PostgreSQL et crée l'utilisateur applicatif. Les migrations Prisma s'exécutent ensuite automatiquement au démarrage du conteneur Formbricks.
5. **Les ressources par défaut sont dimensionnées pour Formbricks.** Les valeurs par défaut de `cpu_limit` (2 vCPU) et de `memory_limit` (2 Gi) reflètent les besoins du runtime Next.js de Formbricks et du pool de connexions Prisma.
6. **Le cache Redis est activé par défaut.** Formbricks utilise Redis pour la mise en cache des réponses de l'API et la limitation de débit. Indispensable pour une mise à l'échelle horizontale sûre.
7. **`webapp_url` doit être défini après le premier déploiement.** NextAuth.js a besoin de l'URL publique de l'instance Formbricks pour les URI de redirection OAuth et les liens envoyés par e-mail. Laissez-le vide lors du premier déploiement ; mettez-le à jour avec l'IP externe, le domaine nip.io ou le domaine personnalisé une fois l'IP de l'équilibreur de charge connue.
8. **L'affinité de session vaut `ClientIP` par défaut.** La gestion des sessions Next.js de Formbricks tire parti de l'acheminement des requêtes répétées d'un même navigateur vers le même pod. C'est nécessaire pour conserver un état d'authentification cohérent dans le panneau d'administration.

---

## Groupe 0 : Métadonnées du module {#group-0-module-metadata}

Métadonnées de plateforme/d'interface lues par la plateforme RAD pour la fiche du catalogue, l'ordre des dépendances, la facturation en crédits et le contrôle d'accès. Aucune n'est transmise à `App_GKE` — elles n'ont aucun effet sur l'infrastructure déployée.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` | Texte de description de Formbricks | Affiché dans le catalogue de la plateforme. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/modules/Formbricks_GKE"` | Lien vers ce guide. |
| `module_dependency` | `["Services_GCP"]` | Modules que la plateforme déploie en premier. |
| `requires_services` | `{ create_postgres=true, create_network_filesystem=true, create_google_kubernetes_engine=true, ... }` | Indique à la plateforme quels interrupteurs `create_*` de `Services_GCP` doivent être activés lorsqu'elle provisionne automatiquement `Services_GCP` pour ce déploiement. |
| `module_services` | `["GKE Autopilot", "Cloud SQL (PostgreSQL 15)", ...]` | Services GCP affichés dans l'interface de la plateforme. |
| `credit_cost` | `110` | Crédits de plateforme consommés par déploiement. |
| `require_credit_purchases` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts gratuits ou des crédits d'événement. |
| `enable_purge` | `true` | Autorise la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Affiche ce module dans le catalogue public. |
| `require_services_gcp_module` | `true` | Échoue au moment du plan si aucun VPC géré par `Services_GCP` n'est détecté. Définissez `false` pour un déploiement autonome avec des prérequis intégrés. |
| `shared_users` | `[]` | Utilisateurs ayant accès indépendamment de `public_access`. |
| `technical_support_users` | `[]` | Utilisateurs vers lesquels la plateforme achemine les demandes de support. |
| `resource_creator_identity` | `"rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com"` | Compte de service utilisé par Terraform pour créer les ressources. |
| `application_module` | `""` | Non référencée — sans effet dans ce module applicatif. |
| `impersonation_service_account` | `""` | Non référencée — sans effet dans ce module applicatif. |
| `job_execution_wait_timeout` | `900` | Nombre maximal de secondes pendant lesquelles un déploiement attend le job `db-init` avant d'interrompre l'apply. |
| `explicit_secret_values` | `{}` | Non référencée — sans effet dans ce module applicatif (les valeurs secrètes propres à `Formbricks_Common` sont câblées en interne). |
| `scripts_dir` | `""` | Non référencée — sans effet dans ce module applicatif (le module pointe toujours vers le répertoire `scripts/` propre à `Formbricks_Common`). |

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | — | ID du projet GCP. **Obligatoire.** |
| `region` | `"us-central1"` | Région GCP de déploiement des ressources. Sert de valeur de repli pour la découverte du VPC et d'emplacement de stockage pour le bucket `uploads`. |
| `tenant_id` | `"demo"` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | `[]` | Adresses e-mail destinataires des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

**Valeurs par défaut propres à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"formbricks"` | `"gkeapp"` | Sert de nom de base à toutes les ressources GCP et Kubernetes. **Ne la modifiez pas après le déploiement.** |
| `application_display_name` | `"Formbricks Surveys"` | `"App GKE Application"` | Affiché dans les tableaux de bord et l'interface de la plateforme. Modifiable librement. |
| `application_description` | `"Formbricks Surveys on GKE Autopilot"` | `"App GKE Custom Application"` | Libellé descriptif. Non transmis à `App_GKE` — c'est la variable `description` qui le contrôle. |
| `application_version` | `"latest"` | `"1.0.0"` | Tag de version de Formbricks à construire et déployer. Fixez une version précise en production (par ex. `"v2.3.0"`). |
| `description` | `"Formbricks - Open Source Survey and Experience Management"` | — | Transmise à `Formbricks Common` comme description du job db-init. |
| `webapp_url` | `""` | — | URL publique de l'instance Formbricks. Laissez-la vide lors du premier déploiement ; mettez-la à jour une fois l'IP externe connue. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

**Valeurs par défaut et comportement propres à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Port HTTP natif de Formbricks. Ne le modifiez pas. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Le serveur Next.js de Formbricks tire parti de 2 vCPU ; `"1000m"` provoque une latence de réponse sensible sous un trafic de sondages modéré. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Formbricks, avec le pool de connexions Prisma et la mise en cache des réponses, nécessite au moins 1 Gi ; 2 Gi sont recommandés en production avec la prise en charge du téléversement de fichiers. |
| `min_instance_count` | `0` | — | Vaut 0 par défaut (scale-to-zero). Définissez `1` en production pour éliminer les démarrages à froid. |
| `max_instance_count` | `3` | `3` | maxReplicas du HPA. Augmentez-le pour les campagnes de sondage à fort trafic. |
| `container_image_source` | `"custom"` | `"custom"` | `Formbricks Common` fournit un build basé sur un Dockerfile. Définissez `"prebuilt"` pour déployer directement l'image amont `ghcr.io/formbricks/formbricks`. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy fournit l'endpoint PostgreSQL dans GKE (Cloud Run utilise le volume Cloud SQL natif — un socket Unix sous `/cloudsql`). |
| `enable_image_mirroring` | `true` | variable | Met en miroir l'image Formbricks de `ghcr.io` vers Artifact Registry afin d'éviter les limites de débit et de fiabiliser le pull. |
| `session_affinity` | `"ClientIP"` | variable | Nécessaire pour un état d'authentification cohérent entre les sessions d'administration de Formbricks. Voir la remarque ci-dessous. |

**Remarque sur `session_affinity` :** le serveur Next.js de Formbricks gère l'état de session en mémoire du processus (avec Redis comme stockage externe de secours). Sans affinité de session `ClientIP`, les requêtes du panneau d'administration peuvent être acheminées vers différents pods qui n'ont pas encore synchronisé leur cache de session en mémoire, ce qui provoque des échecs d'authentification intermittents. Conservez `"ClientIP"` pour tous les déploiements Formbricks GKE.

**`container_resources` :** la valeur par défaut de la variable `container_resources` (`{ cpu_limit = "1000m", memory_limit = "512Mi" }`) est remplacée par les valeurs `cpu_limit` et `memory_limit` fournies par Formbricks Common (respectivement `"2000m"` et `"2Gi"`) lors de la fusion des locals dans `main.tf`. Pour définir des limites de ressources personnalisées, définissez directement `cpu_limit` et `memory_limit` plutôt que `container_resources`.

Les autres variables d'exécution (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans le guide App_GKE.

---

## Groupe 3b : Cluster GKE et charge de travail {#group-3b-gke-cluster--workload}

Identique à `App_GKE` — aucune valeur par défaut propre à Formbricks.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE cible. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour le générer automatiquement à partir de `application_name` + `tenant_id`. |
| `workload_type` | `"Deployment"` | `"Deployment"` ou `"StatefulSet"`. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"`, `"ClusterIP"` ou `"NodePort"`. |
| `configure_service_mesh` | `false` | Active l'injection du sidecar Istio/Anthos Service Mesh pour l'espace de noms. |
| `enable_network_segmentation` | `false` | Crée des NetworkPolicies Kubernetes limitant le trafic de pod à pod au même espace de noms. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente de Kubernetes entre SIGTERM et SIGKILL. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend la fin du rollout lors de l'apply. |
| `network_name` | `""` | Réseau VPC à utiliser. Non référencée — sans effet dans ce module applicatif. |
| `gke_cluster_selection_mode` | `"primary"` | Non référencée — sans effet dans ce module applicatif. |
| `enable_multi_cluster_service` | `false` | Non référencée — sans effet dans ce module applicatif. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | Non référencée — sans effet dans ce module applicatif. |
| `prereq_subnet_cidr_override` | `""` | Déclarée par cohérence avec les conventions ; non transmise, la définir est donc sans effet ici. |
| `extra_service_ports` | `[]` | Déclarée par cohérence avec les conventions ; non transmise, la définir est donc sans effet ici. |

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Les variables réseau suivantes sont disponibles dans `Formbricks GKE` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. Recommandé pour les déploiements Formbricks internes ou de préproduction. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés via IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour IAP. Obligatoire lorsque `enable_iap = true`. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour IAP. Obligatoire lorsque `enable_iap = true`. |
| `iap_support_email` | `""` | E-mail de support affiché sur l'écran de consentement OAuth de Google. |
| `enable_custom_domain` | `true` | Configure la Kubernetes Gateway API pour le routage de domaine personnalisé avec des certificats SSL gérés. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par ex. `["surveys.example.com"]`). Lorsque `enable_custom_domain = true` et que cette liste est vide, un domaine nip.io est utilisé pour les tests. |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé en production. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Généré automatiquement s'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. Le tag `nfsserver` est nécessaire à la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une stratégie de sécurité WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées par Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la stratégie de sécurité Cloud Armor à associer. |
| `enable_cdn` | `false` | Active Cloud CDN via une GCPBackendPolicy pour la Gateway. |

> **Configuration de l'URL Formbricks :** lorsque vous utilisez un domaine personnalisé, définissez `webapp_url` sur ce domaine. Formbricks utilise cette valeur pour générer les URI de redirection NextAuth.js, les liens de confirmation par e-mail et les URL de partage des sondages. Une différence entre l'URL réelle du service et `webapp_url` casse l'authentification et produit des liens rompus dans les e-mails de sondage.

---

## Groupe 4b : Scripts SQL personnalisés {#group-4b-custom-sql-scripts}

Identique à `App_GKE`. Exécute des scripts SQL arbitraires depuis un bucket GCS pendant l'initialisation, en plus (et non à la place) du job `db-init` que fournit `Formbricks_Common`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Exécute des scripts SQL personnalisés depuis GCS pendant l'initialisation. |
| `custom_sql_scripts_bucket` | `""` | Bucket GCS contenant les scripts. |
| `custom_sql_scripts_path` | `""` | Préfixe de chemin dans le bucket ; les scripts s'exécutent par ordre alphabétique. |
| `custom_sql_scripts_use_root` | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données plutôt qu'en tant qu'utilisateur applicatif. |

---

## Groupe 4c : Quotas de ressources {#group-4c-resource-quotas}

Identique à `App_GKE`. Crée un ResourceQuota Kubernetes qui limite le total de CPU, de mémoire et le nombre d'objets dans l'espace de noms Formbricks — utile dans les clusters partagés. Les valeurs de mémoire exigent des suffixes binaires (`Gi`/`Mi`) ; les entiers nus sont interprétés comme des octets et bloquent toute planification de pods.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms. |
| `quota_cpu_requests` | `""` | Total des requêtes CPU autorisées. Vide = aucun quota. |
| `quota_cpu_limits` | `""` | Total des limites CPU autorisées. Vide = aucun quota. |
| `quota_memory_requests` | `""` | Total des requêtes mémoire autorisées (par ex. `"4Gi"`). Vide = aucun quota. |
| `quota_memory_limits` | `""` | Total des limites mémoire autorisées (par ex. `"8Gi"`). Vide = aucun quota. |
| `quota_max_pods` | `""` | Nombre maximal de pods dans l'espace de noms. Vide = aucun quota. |
| `quota_max_services` | `""` | Nombre maximal de Services Kubernetes dans l'espace de noms. Vide = aucun quota. |
| `quota_max_pvcs` | `""` | Nombre maximal de PVC dans l'espace de noms. Pertinent uniquement lorsque `workload_type = "StatefulSet"`. Vide = aucun quota. |

---

## Groupe 4d : VPC Service Controls {#group-4d-vpc-service-controls}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC Service Controls autour des API GCP utilisées par ce module. |
| `vpc_cidr_ranges` | `[]` | CIDR de sous-réseaux pour le niveau d'accès VPC-SC. Découverts automatiquement à partir du VPC si la liste est vide. |
| `vpc_sc_dry_run` | `true` | Journalise les violations sans les bloquer ; recommandé pour le déploiement initial. |
| `organization_id` | `""` | ID de l'organisation GCP pour Access Context Manager. Découvert automatiquement s'il est vide. |
| `enable_audit_logging` | `false` | Active les Cloud Audit Logs détaillés (DATA_READ/DATA_WRITE/ADMIN_READ) pour le projet. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

`Formbricks Common` injecte automatiquement les variables d'environnement suivantes. Vous n'avez pas besoin de les définir dans `environment_variables` :

| Variable d'environnement | Valeur / source | Remarques |
|---|---|---|
| `STORAGE_PROVIDER` | `"s3"` | Indique à Formbricks d'utiliser le pilote de stockage S3. |
| `S3_ENDPOINT_URL` | `"https://storage.googleapis.com"` | Fait pointer le client S3 de Formbricks vers GCS. |
| `S3_BUCKET_NAME` | `<uploads-bucket-name>` | Bucket GCS `uploads` provisionné automatiquement. |
| `NEXTAUTH_URL` | `var.webapp_url` | URL de base de NextAuth.js. Vide tant que `webapp_url` n'est pas défini. |
| `WEBAPP_URL` | `var.webapp_url` | URL publique de Formbricks pour les liens envoyés par e-mail. |
| `HUB_API_URL` | `var.hub_api_url` | Endpoint de l'API Formbricks Hub (v5+). |
| `CUBEJS_API_URL` | `var.cubejs_api_url` | Endpoint de l'API d'analytique Cube.js (v5+). |
| `SMTP_HOST` | `var.smtp_host` | Serveur SMTP. Vide désactive l'e-mail. |
| `SMTP_PORT` | `var.smtp_port` | Port SMTP (`587` par défaut). |
| `SMTP_USER` | `var.smtp_user` | Nom d'utilisateur SMTP. |
| `SMTP_SECURE_ENABLED` | `var.smtp_secure_enabled` (`"1"` / `"0"`) | Indicateur TLS implicite. `true` pour le port `465`, `false` pour STARTTLS sur le port `587`. |
| `MAIL_FROM` | `var.mail_from` | Adresse de l'expéditeur. |

`smtp_password` (par défaut `""`, sensible) est injecté sous forme de Secret Kubernetes `SMTP_PASSWORD` — voir le tableau des secrets ci-dessous. S'il est laissé vide, `Formbricks_Common` génère automatiquement une valeur aléatoire dans Secret Manager.

Les valeurs sensibles suivantes sont injectées sous forme de Secrets Kubernetes via le Secrets Store CSI Driver (depuis Secret Manager) :

| Secret Kubernetes | Variable d'environnement | Remarques |
|---|---|---|
| `NEXTAUTH_SECRET` | `NEXTAUTH_SECRET` | Clé de signature JWT — ne la modifiez pas une fois que des utilisateurs existent. |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY` | Clé de chiffrement des données. |
| `CRON_SECRET` | `CRON_SECRET` | Jeton d'authentification des tâches cron. |
| `HUB_API_KEY` | `HUB_API_KEY` | Clé de connexion au Hub. |
| `CUBEJS_API_SECRET` | `CUBEJS_API_SECRET` | Secret JWT de Cube.js. |
| `S3_ACCESS_KEY` | `S3_ACCESS_KEY` | Clé d'accès HMAC GCS. |
| `S3_SECRET_KEY` | `S3_SECRET_KEY` | Clé secrète HMAC GCS. |
| `SMTP_PASSWORD` | `SMTP_PASSWORD` | Lorsque `smtp_host` est configuré. |
| `REDIS_URL` | `REDIS_URL` | Lorsque l'authentification Redis est activée. |

Utilisez `secret_environment_variables` pour injecter des secrets Secret Manager supplémentaires en plus de ceux fournis par `Formbricks Common`.

Les autres variables liées aux secrets (`secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent de manière identique à `App_GKE`.

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

**Valeurs par défaut propres à Formbricks :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez-la selon vos objectifs de restauration des données de sondage. |
| `backup_retention_days` | `7` | Portez-la à 30 jours ou plus pour les déploiements de sondages actifs dont les réponses ont de la valeur. |

**Import de sauvegarde :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'import ponctuel pendant le déploiement. |
| `backup_source` | `"gcs"` | `"gcs"` importe depuis une URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complète (par ex. `"gs://my-bucket/formbricks.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom d'une sauvegarde déjà placée dans le bucket de sauvegardes géré par le module. |
| `backup_format` | `"sql"` | Format : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

**Job `db-init` par défaut de Formbricks :**

Lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide), `Formbricks Common` fournit automatiquement un job `db-init` :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | Image cliente compatible PostgreSQL |
| Rôle | Crée la base de données PostgreSQL `formbricks` et son utilisateur, puis accorde les privilèges |
| Exécution à chaque apply | `true` |
| CPU / mémoire | `1000m` / `512Mi` |

Les migrations Prisma s'exécutent ensuite automatiquement au démarrage du conteneur Formbricks — le job `db-init` garantit seulement que la base de données et l'utilisateur existent au préalable.

Remplacez `initialization_jobs` par une liste non vide pour substituer des jobs personnalisés à ce job par défaut. Chaque job personnalisé doit spécifier au moins l'un des champs `command`, `args` ou `script_path`.

`additional_services` (par défaut `[]`) déploie des services GKE compagnons supplémentaires aux côtés de Formbricks — inutilisé dans la configuration par défaut, disponible pour une personnalisation avancée.

> **Remarque :** les cron jobs GKE (`cron_jobs`) utilisent les champs Kubernetes CronJob (`restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`) plutôt que les champs de style Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) utilisés dans `Formbricks CloudRun`.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

**Valeurs par défaut propres à Formbricks :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Formbricks stocke sur le volume NFS les fichiers téléversés partagés, les ressources mises en cache et les données de session, afin que tous les réplicas de pod accèdent au même système de fichiers. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage du volume NFS dans le conteneur Formbricks. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base d'une VM GCE NFS intégrée lorsqu'il n'en existe aucune. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. Déclarée par cohérence avec les conventions ; non transmise, la définir est donc sans effet ici. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

`Formbricks Common` provisionne automatiquement un bucket GCS `uploads` en plus des buckets définis dans `storage_buckets`. Formbricks utilise ce bucket pour le stockage de fichiers compatible S3 — les pièces jointes des réponses aux sondages, les images téléversées et les ressources personnalisées y sont stockées via l'API XML de GCS avec des identifiants HMAC.

| Bucket | `name_suffix` | Rôle |
|---|---|---|
| Provisionné automatiquement | `uploads` | Téléversements de fichiers Formbricks via l'API XML GCS compatible S3 |

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain` (par défaut `7`), `delete_untagged_images` (par défaut `true`) et `image_retention_days` (par défaut `30`) se comportent de manière identique à `App_GKE` — les trois dernières régissent le nettoyage des images Artifact Registry pour le dépôt créé en mode intégré (inline).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

**Valeurs par défaut et restrictions propres à Formbricks :**

| Variable | Valeur par défaut Formbricks GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Formbricks exige PostgreSQL. Ne passez pas à MySQL ou SQL Server — l'ORM Prisma de ce module cible PostgreSQL. |
| `db_name` | `"formbricks"` | — | Raccourci pour le nom de la base de données Formbricks. **Ne le modifiez pas après le premier déploiement.** |
| `db_user` | `"formbricks"` | — | Raccourci pour l'utilisateur de la base de données Formbricks. **Ne le modifiez pas après le premier déploiement.** |
| `application_database_name` | `"formbricksdb"` | `"gkeappdb"` | Variable de niveau `App_GKE` pour le nom de la base de données. Elle est de fait remplacée par `db_name` dans `Formbricks Common` — utilisez `db_name` pour Formbricks. |
| `application_database_user` | `"formbricksuser"` | `"gkeappuser"` | Variable de niveau `App_GKE` pour l'utilisateur de la base de données. Utilisez `db_user` pour Formbricks. |
| `enable_postgres_extensions` | `true` | `false` | Les extensions PostgreSQL sont activées par défaut pour Formbricks. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | `[]` | `vector` (pgvector) est requis par le schéma Prisma de Formbricks (embeddings/fonctionnalités d'IA) — sans lui, `prisma db push` échoue avec une erreur de permission car l'utilisateur applicatif de la base ne peut pas exécuter `CREATE EXTENSION`. `uuid-ossp` prend en charge la génération d'UUID. |
| `enable_mysql_plugins` | `false` | `false` | Sans objet — Formbricks exige PostgreSQL. Transmise à `App_GKE` mais sans effet tant que `database_type` reste `POSTGRES_15`. |
| `mysql_plugins` | `[]` | `[]` | Sans objet — Formbricks exige PostgreSQL. |

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour la découverte automatique. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base d'une instance Cloud SQL intégrée. L'ID de déploiement y est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. Lorsque `true`, le mot de passe est renouvelé selon la planification définie par `secret_rotation_period` et les pods GKE sont redémarrés. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant de redémarrer les pods. |
| `database_password_length` | `32` | Longueur du mot de passe de base de données généré automatiquement (16 à 64 caractères). |

**Variables inertes de cohérence avec les conventions :** `application_database_name` (`"formbricksdb"`) et `application_database_user` (`"formbricksuser"`) sont les variables d'identité de base de données de niveau `App_GKE` — Formbricks utilise `db_name`/`db_user` à la place (voir ci-dessus), elles ne sont donc pas référencées. `db_host_env_var_name`, `db_name_env_var_name`, `db_password_env_var_name`, `db_port_env_var_name` et `db_user_env_var_name` (toutes `""` par défaut) permettent à un module enveloppe d'exposer les informations de connexion à la base de données sous des noms de variables d'environnement supplémentaires et non standard ; `Formbricks_GKE` les déclare par cohérence avec les conventions mais ne les transmet pas, les définir est donc sans effet ici.

---

## Groupe 12 : Cache Redis {#group-12-redis-cache}

Formbricks utilise Redis pour la mise en cache des réponses de l'API, la limitation de débit et la coordination des tâches en arrière-plan. Redis est **indispensable à la mise à l'échelle horizontale** — sans Redis, plusieurs pods Formbricks ne peuvent pas partager l'état du cache, ce qui entraîne des compteurs de limitation de débit en double et des réponses d'API incohérentes.

> **Remarque :** dans `Formbricks GKE`, les variables Redis se trouvent dans le **groupe 15** du fichier de variables, mais elles sont documentées ici comme groupe 12 par souci de clarté.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis comme backend de cache et de limitation de débit de Formbricks. **Obligatoire pour `max_instance_count > 1`.** Lorsque `redis_host` est vide, le module utilise par défaut l'IP du serveur NFS. |
| `redis_host` | `""` | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS. Remplacez-le par une instance Cloud Memorystore en production. |
| `redis_port` | `"6379"` | Port TCP de Redis. |
| `redis_auth` | `""` | Mot de passe Redis AUTH. Laissez vide si Redis n'exige pas d'authentification. Sensible. |
| `hub_api_url` | `"http://localhost:8080"` | URL de l'API Formbricks Hub (groupe 15). |
| `cubejs_api_url` | `"http://localhost:4000"` | URL de l'API d'analytique Cube.js (groupe 15). |

**Valider Redis dans GKE :**
```bash
# Confirm the Redis environment variable is set in the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from inside the Formbricks pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# List Memorystore Redis instances (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,authEnabled)"
```

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Formbricks expose `/api/v2/health` — un endpoint de santé dédié qui ne renvoie `HTTP 200` que lorsque l'application et sa connexion PostgreSQL sont opérationnelles.

`Formbricks GKE` expose **deux jeux parallèles** de variables de sonde :

| Jeu de variables | Configure |
|---|---|
| `startup_probe`, `liveness_probe` | Transmises à `Formbricks Common` ; configurent la spécification des sondes Kubernetes du conteneur applicatif |
| `startup_probe_config`, `health_check_config` | Transmises directement à `App GKE` ; configurent les contrôles de santé au niveau de l'infrastructure et de l'équilibreur de charge |

**Sonde de démarrage** (`startup_probe` → Formbricks Common) :

| Champ | Valeur par défaut Formbricks | Remarques |
|---|---|---|
| `path` | `"/api/v2/health"` | Endpoint de santé natif de Formbricks — reflète la connectivité à la base de données. |
| `initial_delay_seconds` | `0` | La sonde de démarrage Kubernetes utilise `failureThreshold × periodSeconds` comme délai total accordé. |
| `period_seconds` | `30` | Vérification toutes les 30 secondes. |
| `failure_threshold` | `10` | Jusqu'à 300 secondes au total (10 × 30s) pour que Formbricks démarre. |
| `timeout_seconds` | `10` | |

**Sonde de vivacité** (`liveness_probe` → Formbricks Common) :

| Champ | Valeur par défaut Formbricks | Remarques |
|---|---|---|
| `path` | `"/api/v2/health"` | Même endpoint que la sonde de démarrage. |
| `initial_delay_seconds` | `60` | Laisse à Formbricks le temps de se stabiliser avant le début des contrôles de vivacité. |
| `period_seconds` | `30` | |
| `failure_threshold` | `3` | Le conteneur est redémarré après 3 échecs consécutifs (90 secondes). |

**Sondes standard App GKE** (`startup_probe_config`, `health_check_config` → App GKE) :

Les deux valent `path = "/"` par défaut. Pour des contrôles de santé précis de l'équilibreur de charge, remplacez-les toutes deux par `path = "/api/v2/health"` afin de correspondre au véritable endpoint de santé de Formbricks.

| Variable | Groupe | Valeur par défaut |
|---|---|---|
| `startup_probe_config` | 10 | `{ enabled = true, type = "TCP", path = "/" }` |
| `health_check_config` | 10 | `{ enabled = true, type = "HTTP", path = "/" }` |
| `uptime_check_config` | 10 | `{ enabled = false, path = "/" }` |
| `alert_policies` | 10 | `[]` |

---

## Groupe 14 : Règles de fiabilité {#group-14-reliability-policies}

Identique à `App_GKE`. Variables disponibles : `enable_pod_disruption_budget` (par défaut `true`), `pdb_min_available` (par défaut `"1"`), `enable_topology_spread` (par défaut `false`), `topology_spread_strict` (par défaut `false`).

Pour les déploiements Formbricks de production avec `max_instance_count > 1`, définissez `enable_topology_spread = true` afin de répartir les pods entre les zones de nœuds GKE Autopilot et d'améliorer la disponibilité.

---

## Groupe 15 : Charges de travail avec état {#group-15-stateful-workloads}

Lorsque `stateful_pvc_enabled = true`, le module utilise automatiquement le type de charge de travail `StatefulSet`. Cela provisionne un PVC par pod pour le stockage local de Formbricks.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Active un PVC par pod pour le StatefulSet. Définissez `true` si NFS est désactivé et qu'un stockage persistant local est nécessaire. |
| `stateful_pvc_size` | `"10Gi"` | Taille du PVC par pod. Les fichiers téléversés via les sondages peuvent croître rapidement — prévoyez 50 Gi ou plus pour les déploiements actifs. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin de montage du PVC par pod. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Valeur par défaut de GKE Autopilot (Balanced PD, ReadWriteOnce). |
| `stateful_headless_service` | `true` | Crée un Service headless pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `"OrderedReady"` | Démarrage séquentiel des pods. Utilisez `"Parallel"` pour démarrer tous les pods simultanément. |
| `stateful_update_strategy` | `"RollingUpdate"` | Remplacements progressifs des pods lors des modifications du modèle. |

> **Remarque :** `stateful_pvc_enabled = true` et `workload_type = "Deployment"` ne peuvent pas être utilisés ensemble — cela échoue au moment du plan.

---

## Sorties du module {#module-outputs}

`Formbricks GKE` expose les sorties suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL du service. |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement. |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Nom de l'utilisateur de la base de données applicative. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (y compris le bucket `uploads`). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |
| `kubernetes_ready` | `true` lorsque l'endpoint du cluster GKE est joignable et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — relancez l'apply pour terminer le déploiement. |

---

## Explorer avec la console GCP {#exploring-with-the-gcp-console}

Après le déploiement, utilisez la console GCP pour observer et exploiter le déploiement Formbricks GKE.

**Charges de travail GKE :**
- Accédez à **Kubernetes Engine → Workloads** et sélectionnez votre projet et votre cluster.
- Filtrez sur l'espace de noms Formbricks (par ex. `formbricks-demo`). Vous verrez le `Deployment` ou le `StatefulSet` Formbricks ainsi que les éventuels Jobs `db-init`.
- Cliquez sur la charge de travail pour voir le nombre de pods, l'état de la mise à jour progressive et les requêtes/limites de ressources.
- L'onglet **Events** affiche les décisions du planificateur Kubernetes, l'état du pull des images et les échecs de sonde. C'est le premier endroit à consulter lorsque des pods ne démarrent pas.
- L'onglet **YAML** affiche le manifeste Kubernetes complet, y compris toutes les variables d'environnement injectées et les montages de volumes de secrets.

**Services et Ingress GKE :**
- Accédez à **Kubernetes Engine → Services & Ingress** et sélectionnez l'espace de noms Formbricks.
- Le Service Formbricks (de type `LoadBalancer`) affiche son IP externe. C'est l'IP à utiliser comme base de `webapp_url` lors du premier déploiement.
- Si `enable_custom_domain = true`, une ressource Gateway apparaît ici avec l'état du certificat SSL associé.
- L'onglet **Backend health** de l'Ingress/de la Gateway indique si l'équilibreur de charge considère les pods Formbricks comme sains.

**HPA (Horizontal Pod Autoscaler) :**
- Accédez à **Kubernetes Engine → Workloads**, sélectionnez le déploiement Formbricks, puis consultez la section **Horizontal Pod Autoscaler**.
- Le nombre actuel de réplicas, l'utilisation CPU cible et les événements de mise à l'échelle y sont visibles.
- Vous pouvez aussi accéder au cluster dans **Kubernetes Engine → Clusters** et utiliser le Cloud Shell intégré : `kubectl get hpa -n formbricks-demo`.

**Secret Manager :**
- Accédez à **Security → Secret Manager** et filtrez sur `formbricks`.
- Tous les secrets générés automatiquement y apparaissent : `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` et, selon la configuration, `SMTP_PASSWORD` et `REDIS_URL`.
- Cliquez sur un secret pour voir l'historique de ses versions, sa date de création et les charges de travail Kubernetes qui le référencent (sous **Usage**).

**Cloud SQL :**
- Accédez à **SQL** et sélectionnez l'instance PostgreSQL.
- L'onglet **Connections** affiche les connexions actives depuis les pods GKE. Sous forte charge, le nombre de connexions est un indicateur de santé clé — les limites du pool de connexions de Prisma le maintiennent généralement bas.
- L'onglet **Operations** journalise la création de la base de données et de l'utilisateur par le job `db-init`.

**Cloud Storage :**
- Accédez à **Cloud Storage → Buckets** et repérez le bucket `uploads`.
- Les pièces jointes téléversées par les répondants aux sondages y sont stockées sous forme d'objets.
- L'onglet **Permissions** confirme que le compte de service HMAC dispose de `roles/storage.objectAdmin`.

**Cloud Build :**
- Accédez à **Cloud Build → History** pour consulter l'historique des builds de l'image Formbricks.
- Chaque journal de build montre les étapes du Dockerfile, les arguments de build référençant `application_version` et l'étape de push vers Artifact Registry.

---

## Explorer avec gcloud {#exploring-with-gcloud}

Les commandes suivantes sont utiles pour les opérations quotidiennes. Remplacez `PROJECT_ID`, `REGION`, `CLUSTER_NAME` et `NAMESPACE` par vos valeurs.

**Récupérer les identifiants du cluster et définir le contexte d'espace de noms :**
```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

kubectl config set-context --current --namespace=NAMESPACE
```

**Lister tous les pods et leur état :**
```bash
kubectl get pods -n NAMESPACE -o wide
```

**Décrire un pod Formbricks (événements, état des sondes, utilisation des ressources) :**
```bash
kubectl describe pod POD_NAME -n NAMESPACE
```

**Suivre en direct les journaux du conteneur Formbricks :**
```bash
kubectl logs -n NAMESPACE -l app=formbricks --follow --tail=100
```

**Vérifier l'état du HPA et l'historique de mise à l'échelle :**
```bash
kubectl get hpa -n NAMESPACE
kubectl describe hpa formbricks -n NAMESPACE
```

**Confirmer que tous les secrets Formbricks sont montés dans le pod :**
```bash
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E 'NEXTAUTH|ENCRYPTION|CRON|S3|REDIS|SMTP'
```

**Lister les secrets Secret Manager du déploiement Formbricks :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, replication.automatic, createTime)"
```

**Afficher la dernière version d'un secret (métadonnées uniquement) :**
```bash
gcloud secrets versions describe latest \
  --secret=formbricks-nextauth-secret \
  --project=PROJECT_ID
```

**Vérifier l'instance Cloud SQL PostgreSQL :**
```bash
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier)"

gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Vérifier l'IP externe de l'Ingress / de la Gateway GKE :**
```bash
kubectl get gateway -n NAMESPACE
kubectl get svc -n NAMESPACE formbricks
```

**Vérifier le bucket GCS des téléversements Formbricks :**
```bash
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, location, storageClass)"

gcloud storage ls gs://UPLOADS_BUCKET_NAME/ --long
```

**Afficher les événements au niveau du cluster GKE (utile pour les échecs de planification) :**
```bash
kubectl get events -n NAMESPACE --sort-by='.lastTimestamp' | tail -30
```

**Vérifier Memorystore Redis (si vous utilisez Memorystore for Redis) :**
```bash
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"
```

**Déclencher manuellement le job db-init :**
```bash
kubectl create job formbricks-db-init-manual \
  --from=cronjob/formbricks-db-init \
  -n NAMESPACE
kubectl logs -n NAMESPACE job/formbricks-db-init-manual --follow
```

**Afficher l'historique des builds d'image Cloud Build :**
```bash
gcloud builds list \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(id, status, createTime, duration)"
```

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `webapp_url` | À définir après le premier déploiement | **Élevé** | NextAuth.js génère les URI de redirection OAuth et les liens envoyés par e-mail à partir de la valeur de `webapp_url`. S'il reste vide après le premier déploiement, l'authentification échoue pour tout fournisseur OAuth et les liens des e-mails pointent vers localhost. Récupérez l'IP externe avec `kubectl get svc`, définissez `webapp_url`, puis redéployez. |
| `db_name` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modifier recrée la base de données et détruit toutes les définitions de sondages, les réponses et les données d'équipe. |
| `db_user` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modifier recrée l'utilisateur de la base de données et casse toutes les références d'identifiants existantes. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Le schéma Prisma de Formbricks cible PostgreSQL. La définir sur `MYSQL_8_0` ou `NONE` fait échouer Formbricks au démarrage avec une erreur du client Prisma. |
| `enable_redis` | `true` | **Élevé** | Redis est activé par défaut. Lorsque `redis_host = ""`, le module se replie sur l'IP du serveur NFS. Si `enable_nfs = false` et que `redis_host` est également vide, Formbricks échoue au démarrage. Avec `max_instance_count > 1`, Redis est indispensable — sans lui, chaque pod conserve un cache isolé, ce qui rend la limitation de débit et le comportement des réponses incohérents. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Sans affinité de session, les requêtes du panneau d'administration Formbricks sont acheminées vers différents pods. Les caches de session en mémoire divergent, ce qui provoque des échecs d'authentification intermittents et des déconnexions inattendues. Conservez `"ClientIP"` pour tous les déploiements Formbricks multi-réplicas. |
| `enable_nfs` | `true` | **Élevé** | Sans NFS, les ressources de sondage téléversées sont stockées sur le système de fichiers éphémère du pod. Tous les téléversements sont perdus au redémarrage du pod ou lors d'une mise à jour progressive. Plusieurs réplicas servent alors des contenus de fichiers incohérents. |
| `memory_limit` | `"2Gi"` | **Élevé** | La valeur par défaut de base de `container_resources` sur GKE n'est que de `"512Mi"`. Le runtime Next.js de Formbricks nécessite au moins 1 Gi ; le pool de connexions Prisma et la mise en cache des réponses sous un trafic de sondages actif nécessitent 2 Gi. Un sous-dimensionnement provoque des plantages OOM de Node.js. |
| `smtp_host` | `""` | **Élevé** | Sans SMTP, Formbricks ne peut pas envoyer d'invitations aux utilisateurs, de notifications de réponse aux sondages ni d'e-mails de connexion par lien magique. Configurez un fournisseur SMTP valide avant d'inviter des membres de l'équipe. |
| `min_instance_count` | `0` | **Moyen** | Le scale-to-zero provoque des démarrages à froid de 15 à 20 secondes. Les répondants qui accèdent à un sondage juste après une période d'inactivité subissent ce délai. Définissez `1` pour les sondages de production soumis à des exigences de SLA. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours ne suffisent pas pour des déploiements de sondages actifs. Portez cette valeur à 30 jours ou plus pour tout déploiement Formbricks de production qui collecte des réponses de valeur. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'elles sont définies. Les entiers nus sont interprétés comme des octets par Kubernetes et bloquent entièrement la planification des pods. |
| `enable_pod_disruption_budget` | `true` | **Moyen** | Déjà activé. Le désactiver permet l'arrêt simultané de tous les pods lors des mises à niveau des nœuds GKE Autopilot, ce qui provoque une panne totale du service. |
| `pdb_min_available` | `"1"` | **Moyen** | Avec un seul réplica, le PDB empêche toute interruption volontaire jusqu'à ce que le pod soit replanifié. Utilisez au moins 2 réplicas en production pour permettre une maintenance progressive. |
| `stateful_pvc_size` | `"10Gi"` | **Moyen** | Les fichiers téléversés via les sondages croissent rapidement. `10Gi` est un minimum pour le développement. Prévoyez 50 à 100Gi pour les déploiements de production actifs qui acceptent des pièces jointes. La taille d'un PVC peut être augmentée mais pas réduite sans migration des données. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration Formbricks n'est protégé que par l'authentification propre à Formbricks. Activez-le pour tout déploiement de production accessible publiquement. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Formbricks sur GKE Autopilot](../labs/Formbricks_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Formbricks Common — Module de configuration partagée](Formbricks_Common.md) — la configuration partagée par les deux cibles de déploiement.
