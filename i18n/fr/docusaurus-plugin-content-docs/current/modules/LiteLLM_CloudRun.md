---
title: "LiteLLM sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LiteLLM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LiteLLM_CloudRun.md @ 15fd4c7 sha256:84f96e3000e6 -->

# LiteLLM sur Google Cloud Run {#litellm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LiteLLM_CloudRun.png" alt="LiteLLM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LiteLLM est un proxy LLM open-source et une passerelle IA qui fournit une API
unifiée compatible OpenAI pour plus de 100 fournisseurs, dont OpenAI, Anthropic,
Google Gemini, Azure OpenAI, AWS Bedrock et Ollama. Les organisations
l'utilisent pour centraliser le suivi des dépenses IA, gérer les clés API
virtuelles, appliquer des limites de débit et obtenir une visibilité complète
sur l'utilisation des modèles. Ce module déploie LiteLLM sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LiteLLM et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LiteLLM s'exécute en tant que conteneur proxy basé sur Python sur Cloud Run v2.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service proxy Python, 1 vCPU / 2 GiB par défaut, facturation basée sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — l'ORM Prisma de LiteLLM utilise PostgreSQL pour les clés virtuelles et le suivi des dépenses |
| Stockage d'objets | Cloud Storage | Optionnel — aucun bucket créé par défaut |
| Cache | Redis | Optionnel — réduit la latence et le coût pour les requêtes LLM identiques répétées |
| Secrets | Secret Manager | Clé principale et clé de salage auto-générées ; clés API du fournisseur LLM injectées au moment de l'exécution |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma de LiteLLM nécessite
  PostgreSQL pour la gestion des clés virtuelles et le suivi des dépenses ;
  changer le moteur empêche le démarrage.
- **Une image de conteneur personnalisée est construite par Cloud Build.**
  L'image intègre un `entrypoint.sh` qui assemble `DATABASE_URL` à partir des
  variables d'environnement `DB_*` injectées par la fondation au moment
  de l'exécution.
- **`LITELLM_MASTER_KEY` et `LITELLM_SALT_KEY` sont auto-générées** et stockées dans
  Secret Manager. La clé de salage ne doit jamais être renouvelée après
  l'émission de clés virtuelles — toutes les clés virtuelles existantes
  deviendraient définitivement invalides.
- **`STORE_MODEL_IN_DB = "true"` est défini automatiquement**, permettant la gestion des
  modèles d'exécution et l'interface utilisateur d'administration sans
  redémarrage des conteneurs.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements
  multi-instances afin de partager les compteurs de limite de débit et les
  caches de réponse.
- **La sonde de démarrage cible `/health/readiness`**, qui valide la connectivité
  de la base de données et confirme que les migrations Prisma sont terminées
  avant que le service ne soit marqué comme prêt.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms des services et des ressources sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LiteLLM {#a-cloud-run--the-litellm-service}

LiteLLM s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
à la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LiteLLM stocke toutes les clés virtuelles, les logs d'utilisation, les
enregistrements de coûts et les règles de routage des modèles dans une instance
gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé via le
**Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du
premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et le renouvellement du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket de stockage n'est créé par défaut. Les buckets peuvent être
déclarés via `storage_buckets` et montés via GCS Fuse en utilisant `gcs_volumes`
— par exemple, pour livrer un `config.yaml` au conteneur sans reconstruire
l'image.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache optionnelle des réponses de LiteLLM et
les compteurs de limite de débit partagés. Lorsque `enable_redis = true`, les variables
d'environnement `REDIS_HOST`, `REDIS_PORT` et (optionnellement)
`REDIS_PASSWORD` sont injectées automatiquement dans le service.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`LITELLM_MASTER_KEY` (la clé API d'administration principale, préfixée `sk-`)
et `LITELLM_SALT_KEY` (utilisée pour hacher les clés virtuelles) sont générées
automatiquement et stockées dans Secret Manager. Les clés API du fournisseur
LLM sont injectées en référençant des secrets préexistants via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
renouvellement.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LiteLLM {#3-litellm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur LiteLLM avant le
  démarrage du service. Il est idempotent et se connecte à Cloud SQL via le
  socket Unix du Auth Proxy.
- **Migrations Prisma au démarrage.** LiteLLM exécute ses migrations ORM Prisma
  à chaque démarrage d'instance, de sorte que la mise à niveau de la version
  applique automatiquement les changements de schéma. La sonde de démarrage
  attend que `/health/readiness` renvoie 200, confirmant que les migrations sont
  terminées avant de router le trafic vers le service.
- **Interface utilisateur d'administration.** L'interface utilisateur
  d'administration de LiteLLM est disponible à l'adresse `/ui` sur
  l'URL du service. Authentifiez-vous avec la `LITELLM_MASTER_KEY` (récupérez-la
  depuis Secret Manager). Depuis l'interface utilisateur, vous pouvez ajouter
  des modèles, créer des clés virtuelles, définir des budgets et consulter les
  tableaux de bord d'utilisation — le tout sans redéployer le service.
- **Ajout de clés de fournisseur LLM.** Les clés API du fournisseur ne sont pas
  gérées par ce module. Fournissez-les au moment du déploiement via
  `secret_environment_variables` (mappant chaque variable d'environnement à un secret
  Secret Manager préexistant), ou ajoutez-les après le déploiement via
  l'interface utilisateur d'administration ou le point de terminaison API
  `/model/new` en utilisant la clé principale.
- **Gestion des clés virtuelles.** Utilisez l'API `/key/generate` avec la clé
  principale pour émettre des clés virtuelles par équipe ou par utilisateur
  avec des limites de débit et des budgets de dépenses. Ces clés sont stockées
  dans PostgreSQL et salées avec `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **IAP et appels API programmatiques.** IAP (`enable_iap = true`) nécessite un
  flux OAuth de navigateur et bloque les appels API LLM directs. N'utilisez IAP
  que si vous restreignez l'accès à l'interface utilisateur d'administration ;
  pour l'utilisation de la passerelle API, préférez `ingress_settings =
  "internal"` avec VPN ou
  authentification mutuelle.
- **Points de terminaison de santé.** `/health/readiness` valide la connectivité de
  la base de données et l'achèvement de la migration Prisma ; `/health/liveliness`
  confirme que le processus proxy est en cours d'exécution. Ceux-ci sont
  utilisés respectivement comme sondes de démarrage et de vivacité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LiteLLM sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `litellm` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `LiteLLM AI Gateway` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `main-stable` | Tag de version de l'image LiteLLM ; épingler à une version spécifique pour la stabilité de la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner l'infrastructure uniquement. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; ne pas réduire en dessous de 2 Gi — LiteLLM plante en OOM au démarrage en dessous de cette valeur. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut — LiteLLM est un proxy sans état sans travail de fond en cours de traitement. |
| `min_instance_count` | `1` | Doit rester ≥ 1. Les jobs planifiés de LiteLLM (y compris la réinitialisation du budget) ne s'exécutent que tant qu'une instance est active ; à 0, ils s'arrêtent lorsque Cloud Run réduit le service. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `container_port` | `4000` | Port natif de LiteLLM. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run ; la gen2 est requise pour NFS et Direct VPC Egress. |
| `timeout_seconds` | `600` | Durée maximale de la requête ; augmenter pour les appels d'inférence LLM de longue durée (max 3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions de socket Unix. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service ; définir sur `internal` pour une utilisation de passerelle API uniquement VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est routé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy (bloque les appels API directs). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Paramètres supplémentaires non secrets. Les variables LiteLLM principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Utiliser pour injecter les clés API du fournisseur LLM. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket créé par défaut. |
| `enable_nfs` | `false` | NFS n'est pas requis pour LiteLLM ; activer uniquement pour la livraison de fichiers de configuration partagés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour la livraison de fichiers de configuration. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier ; LiteLLM nécessite PostgreSQL 15. |
| `db_name` | `litellm_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `litellm_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré de LiteLLM_Common. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents pour la maintenance ou les tâches d'entretien. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | Sonde HTTP ; valide la connectivité de la base de données et les migrations Prisma avant de marquer le service comme prêt. |
| `liveness_probe` | `/health/liveliness` | Sonde HTTP ; confirme que le processus proxy est en cours d'exécution. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring contre `/health/liveliness` ; activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la mise en cache des réponses et les compteurs de limite de débit partagés. |
| `redis_host` | `""` | Point de terminaison Redis ; requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | LiteLLM nécessite PostgreSQL ; changer le moteur casse l'ORM Prisma et empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy est requis pour la connectivité de la base de données ; le désactiver entraîne l'échec de Prisma au démarrage. |
| `LITELLM_SALT_KEY` | auto-généré, jamais renouvelé | Critique | Le renouvellement de la clé de salage invalide chaque clé virtuelle précédemment émise ; tous les consommateurs d'API perdent l'accès immédiatement. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les clés virtuelles et les données de dépenses. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `ingress_settings` | restreindre pour la production | Critique | `"all"` expose publiquement le point de terminaison de la clé principale ; utiliser `"internal"` pour les déploiements de passerelle API uniquement VPC. |
| `LITELLM_MASTER_KEY` | auto-généré | Élevé | Traiter comme une information d'identification ; le renouveler casse toutes les intégrations existantes détenant la clé jusqu'à ce qu'elles soient mises à jour. |
| `enable_redis` | `true` pour multi-instance | Élevé | Sans Redis, les compteurs de limite de débit sont par instance et non partagés ; les quotas ne sont pas appliqués sur les réplicas. |
| `redis_host` | défini lorsque Redis est activé | Élevé | Un hôte vide avec `enable_redis = true` provoque des erreurs de connexion à chaque requête. |
| `min_instance_count` | `1` | Élevé | À `0`, les réinitialisations de budget et les autres jobs planifiés de LiteLLM s'arrêtent lorsque l'instance est récupérée ; les démarrages à froid ajoutent également 20 à 40 secondes de latence pour les services dépendants. |
| `timeout_seconds` | `600` | Élevé | L'inférence de grands modèles linguistiques peut prendre des minutes ; un délai d'attente trop court provoque des erreurs 504 sur les modèles lents. |
| `enable_iap` | `false` pour les points de terminaison API | Élevé | IAP bloque tous les appels API programmatiques directs ; n'utilisez IAP que si vous accédez exclusivement à l'interface utilisateur d'administration. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS et Direct VPC Egress sont uniquement gen2 ; la rétrogradation casse le réseau. |
| `application_version` | épingler pour la production | Moyen | LiteLLM publie fréquemment ; les versions non épinglées peuvent modifier le schéma Prisma ou casser les formats de clés virtuelles. |
| `NUM_WORKERS` | `1` (augmenter pour le débit) | Moyen | Un seul worker sérialise toutes les requêtes ; augmenter à 2-4 et mettre à l'échelle `cpu_limit` proportionnellement pour les passerelles à fort trafic. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_auto_password_rotation` | `false` sauf si prêt | Moyen | L'activation sans `rotation_propagation_delay_sec` adéquat peut provoquer une condition de concurrence où le service redémarre avant que le nouveau mot de passe ne se propage. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à LiteLLM partagée avec la variante GKE est décrite
dans **[LiteLLM_Common](LiteLLM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LiteLLM sur Cloud Run](../labs/LiteLLM_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LiteLLM sur GKE Autopilot](LiteLLM_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LiteLLM Common — Configuration d'application partagée](LiteLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md), [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Assistant IA privé**.
