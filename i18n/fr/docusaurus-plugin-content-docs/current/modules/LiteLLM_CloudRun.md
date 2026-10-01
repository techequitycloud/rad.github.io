---
title: "LiteLLM sur Google Cloud Run"
description: "Référence de configuration pour déployer LiteLLM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LiteLLM_CloudRun.md @ 3055034 sha256:9f72b869dc33 -->

# LiteLLM sur Google Cloud Run {#litellm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LiteLLM_CloudRun.png" alt="LiteLLM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LiteLLM est un proxy LLM et une passerelle d'IA open source qui fournit une API
unifiée compatible OpenAI pour plus de 100 fournisseurs, dont OpenAI, Anthropic, Google
Gemini, Azure OpenAI, AWS Bedrock et Ollama. Les organisations l'utilisent pour
centraliser le suivi des dépenses d'IA, gérer des clés d'API virtuelles, appliquer des limites de débit et
obtenir une visibilité complète sur l'usage des modèles. Ce module déploie LiteLLM sur **Cloud
Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise LiteLLM et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité du service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LiteLLM s'exécute comme un conteneur de proxy écrit en Python sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service de proxy Python, 1 vCPU / 2 GiB par défaut, facturation à la requête |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'ORM Prisma de LiteLLM utilise PostgreSQL pour les clés virtuelles et le suivi des dépenses |
| Stockage objet | Cloud Storage | Facultatif — aucun bucket créé par défaut |
| Cache | Redis | Facultatif — réduit la latence et le coût des requêtes LLM identiques répétées |
| Secrets | Secret Manager | Clé maîtresse et clé de salage générées automatiquement ; clés d'API des fournisseurs de LLM injectées à l'exécution |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma de LiteLLM nécessite PostgreSQL pour
  la gestion des clés virtuelles et le suivi des dépenses ; changer de moteur empêche le démarrage.
- **Une image de conteneur personnalisée est construite par Cloud Build.** L'image intègre un
  `entrypoint.sh` qui assemble `DATABASE_URL` à partir des variables d'environnement `DB_*`
  injectées par le socle à l'exécution.
- **`LITELLM_MASTER_KEY` et `LITELLM_SALT_KEY` sont générées automatiquement** et stockées
  dans Secret Manager. La clé de salage ne doit jamais faire l'objet d'une rotation une fois des clés virtuelles
  émises — toutes les clés virtuelles existantes deviendraient définitivement invalides.
- **`STORE_MODEL_IN_DB = "true"` est défini automatiquement**, ce qui permet de gérer les modèles
  à l'exécution et d'utiliser l'interface d'administration sans redémarrer le conteneur.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements multi-instances afin de
  partager les compteurs de limites de débit et les caches de réponses.
- **La sonde de démarrage cible `/health/readiness`**, qui valide la connectivité à la base de données
  et confirme que les migrations Prisma sont terminées avant que le service
  soit marqué comme prêt.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LiteLLM {#a-cloud-run--the-litellm-service}

LiteLLM s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre
les nombres minimal et maximal d'instances. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LiteLLM stocke toutes les clés virtuelles, les journaux d'utilisation, les enregistrements de coûts et les règles de
routage des modèles dans une instance gérée Cloud SQL for PostgreSQL 15. Le service se connecte
de manière privée via **Cloud SQL Auth Proxy** sur un socket Unix (sans IP publique).
Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket de stockage n'est créé par défaut. Des buckets peuvent être déclarés via
`storage_buckets` et montés via GCS Fuse à l'aide de `gcs_volumes` — par exemple pour
fournir un `config.yaml` au conteneur sans reconstruire l'image.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache facultative des réponses et les compteurs partagés de limites de débit de LiteLLM.
Lorsque `enable_redis = true`, les variables d'environnement `REDIS_HOST`, `REDIS_PORT` et (facultativement)
`REDIS_PASSWORD` sont injectées automatiquement dans le service.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`LITELLM_MASTER_KEY` (la clé d'API d'administration principale, préfixée `sk-`) et
`LITELLM_SALT_KEY` (utilisée pour hacher les clés virtuelles) sont générées automatiquement et
stockées dans Secret Manager. Les clés d'API des fournisseurs de LLM sont injectées en référençant
des secrets préexistants via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus ;
les paramètres d'ingress et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à
Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LiteLLM {#3-litellm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation crée la
  base de données et l'utilisateur LiteLLM avant le démarrage du service. Il est idempotent et se connecte à
  Cloud SQL via le socket Unix d'Auth Proxy.
- **Migrations Prisma au démarrage.** LiteLLM exécute les migrations de son ORM Prisma à
  chaque démarrage d'instance ; une mise à niveau de version applique donc automatiquement les modifications de schéma.
  La sonde de démarrage attend que `/health/readiness` renvoie 200,
  ce qui confirme la fin des migrations avant que le trafic soit acheminé vers le service.
- **Interface d'administration.** L'interface d'administration de LiteLLM est disponible sur `/ui` à l'URL du service.
  Authentifiez-vous avec la `LITELLM_MASTER_KEY` (récupérez-la dans Secret Manager).
  Depuis l'interface, vous pouvez ajouter des modèles, créer des clés virtuelles, définir des budgets et consulter
  des tableaux de bord d'utilisation — le tout sans redéployer le service.
- **Ajout des clés des fournisseurs de LLM.** Les clés d'API des fournisseurs ne sont pas gérées par ce
  module. Fournissez-les au moment du déploiement via `secret_environment_variables` (en associant
  chaque variable d'environnement à un secret Secret Manager préexistant), ou ajoutez-les après le
  déploiement via l'interface d'administration ou le point de terminaison d'API `/model/new` à l'aide de la clé
  maîtresse.
- **Gestion des clés virtuelles.** Utilisez l'API `/key/generate` avec la clé maîtresse
  pour émettre des clés virtuelles par équipe ou par utilisateur, avec des limites de débit et des budgets de dépenses.
  Ces clés sont stockées dans PostgreSQL et salées avec `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **IAP et appels d'API programmatiques.** IAP (`enable_iap = true`) exige un
  flux OAuth dans le navigateur et bloque les appels directs à l'API LLM. N'utilisez IAP que pour restreindre
  l'accès à l'interface d'administration ; pour un usage en passerelle d'API, préférez `ingress_settings =
  "internal"` avec un VPN ou une authentification mutuelle.
- **Points de terminaison de santé.** `/health/readiness` valide la connectivité à la base de données et
  la fin des migrations Prisma ; `/health/liveliness` confirme que le processus du proxy
  est en cours d'exécution. Ils servent respectivement de sondes de démarrage et de vivacité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres propres à LiteLLM ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant de l'accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `litellm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `LiteLLM AI Gateway` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `main-stable` | Tag de version de l'image LiteLLM ; épinglez une version précise pour la stabilité en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; ne descendez pas sous 2Gi — en dessous, LiteLLM plante pour OOM au démarrage. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut — LiteLLM est un proxy sans état, sans tâche de fond dans le processus. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Mise à l'échelle à zéro par défaut ; définissez ≥ 1 pour éliminer les démarrages à froid sur la passerelle d'API. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `container_port` | `4000` | Port natif de LiteLLM. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run ; gen2 est requise pour NFS et Direct VPC Egress. |
| `timeout_seconds` | `600` | Durée maximale d'une requête ; augmentez-la pour les appels d'inférence LLM de longue durée (max. 3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service ; définissez `internal` pour un usage en passerelle d'API limité au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy (bloque les appels d'API directs). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Paramètres non secrets supplémentaires. Les variables principales de LiteLLM sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom de secret Secret Manager. À utiliser pour injecter les clés d'API des fournisseurs de LLM. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / fréquence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Expression cron de la sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Principales entrées : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement.
Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Stratégie de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket créé par défaut. |
| `enable_nfs` | `false` | NFS n'est pas requis pour LiteLLM ; ne l'activez que pour fournir un fichier de configuration partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour fournir des fichiers de configuration. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier ; LiteLLM nécessite PostgreSQL 15. |
| `db_name` | `litellm_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `litellm_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivée | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms de variables d'environnement supplémentaires sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré de configuration de la base de données fourni par LiteLLM_Common. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents pour des tâches de maintenance ou d'entretien. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | Sonde HTTP ; valide la connectivité à la base de données et les migrations Prisma avant de marquer le service comme prêt. |
| `liveness_probe` | `/health/liveliness` | Sonde HTTP ; confirme que le processus du proxy est en cours d'exécution. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring sur `/health/liveliness` ; à activer explicitement. |
| `alert_policies` | `[]` | Stratégies d'alerte sur métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la mise en cache des réponses et les compteurs partagés de limites de débit. |
| `redis_host` | `""` | Point de terminaison Redis ; requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR des niveaux d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | LiteLLM nécessite PostgreSQL ; changer de moteur casse l'ORM Prisma et empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Le sidecar Auth Proxy est requis pour la connectivité à la base de données ; le désactiver fait échouer Prisma au démarrage. |
| `LITELLM_SALT_KEY` | générée automatiquement, jamais renouvelée | Critical | Renouveler la clé de salage invalide toutes les clés virtuelles émises auparavant ; tous les consommateurs de l'API perdent immédiatement l'accès. |
| `db_name` / `db_user` | définis une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les clés virtuelles et données de dépenses. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `ingress_settings` | à restreindre en production | Critical | `"all"` expose publiquement le point de terminaison de la clé maîtresse ; utilisez `"internal"` pour les déploiements de passerelle d'API limités au VPC. |
| `LITELLM_MASTER_KEY` | générée automatiquement | High | À traiter comme un identifiant ; la renouveler casse toutes les intégrations existantes qui détiennent la clé jusqu'à leur mise à jour. |
| `enable_redis` | `true` en multi-instances | High | Sans Redis, les compteurs de limites de débit sont propres à chaque instance et non partagés ; les quotas ne sont pas appliqués entre les réplicas. |
| `redis_host` | à définir lorsque Redis est activé | High | Un hôte vide avec `enable_redis = true` provoque des erreurs de connexion à chaque requête. |
| `min_instance_count` | `1` | High | Les démarrages à froid ajoutent 20 à 40 s de latence et mettent en file d'attente tous les services dépendants. |
| `timeout_seconds` | `600` | High | L'inférence d'un grand modèle de langage peut prendre plusieurs minutes ; un délai trop court provoque des erreurs 504 sur les modèles lents. |
| `enable_iap` | `false` pour les points de terminaison d'API | High | IAP bloque tous les appels d'API programmatiques directs ; n'utilisez IAP que si l'accès se limite à l'interface d'administration. |
| `execution_environment` | `gen2` | High | Les montages NFS et Direct VPC Egress sont réservés à gen2 ; revenir à une génération antérieure casse le réseau. |
| `application_version` | à épingler en production | Medium | LiteLLM publie fréquemment de nouvelles versions ; des versions non épinglées peuvent modifier le schéma Prisma ou casser les formats des clés virtuelles. |
| `NUM_WORKERS` | `1` (à augmenter pour le débit) | Medium | Un worker unique sérialise toutes les requêtes ; passez à 2–4 et augmentez `cpu_limit` en proportion pour les passerelles à fort trafic. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme aux exigences réglementaires. |
| `enable_auto_password_rotation` | `false` tant que vous n'êtes pas prêt | Medium | L'activer sans `rotation_propagation_delay_sec` suffisant peut provoquer une situation de concurrence dans laquelle le service redémarre avant que le nouveau mot de passe se soit propagé. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à LiteLLM,
partagée avec la variante GKE, est décrite dans **[LiteLLM_Common](LiteLLM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LiteLLM sur Cloud Run](../labs/LiteLLM_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LiteLLM sur GKE Autopilot](LiteLLM_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LiteLLM Common — Configuration applicative partagée](LiteLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) et [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Private AI Assistant**.
