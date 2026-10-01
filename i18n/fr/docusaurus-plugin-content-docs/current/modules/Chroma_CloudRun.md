---
title: "Chroma sur Google Cloud Run"
description: "Référence de configuration pour déployer Chroma sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Chroma_CloudRun.md @ 3055034 sha256:5722ded82eb0 -->

# Chroma sur Google Cloud Run {#chroma-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chroma_CloudRun.png" alt="Chroma sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chroma est une base de données vectorielle open source, nativement conçue pour
l'IA, dédiée aux embeddings et à la recherche par similarité. Elle alimente les
pipelines RAG, la recherche sémantique et les workflows LangChain/LlamaIndex. Ce
module déploie Chroma sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Chroma et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chroma s'exécute sous la forme d'un service de base de données vectorielle
conteneurisé sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 (Gen2) | 1 vCPU / 1 GiB par défaut ; `min_instance_count = 1` pour éviter les démarrages à froid avec rechargement des index |
| Persistance des données | Cloud Storage (GCS FUSE) | Bucket `<prefix>-data` provisionné automatiquement et monté sur `/data` ; backend de stockage principal |
| Jeton d'authentification | Secret Manager | Jeton d'API facultatif — `CHROMA_SERVER_AUTHN_CREDENTIALS` injecté à l'exécution |
| Entrée | URL interne Cloud Run | `ingress_settings = "internal"` par défaut ; équilibreur de charge HTTPS + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ni base de données SQL ni Redis.** Chroma gère son propre stockage intégré.
  Aucune instance Cloud SQL n'est créée et aucune connexion Redis n'est configurée.
- **`ingress_settings = "internal"` par défaut.** Avec ce paramètre, la sortie
  `chroma_api_url` n'est pas accessible depuis l'internet public. Passer à `"all"`
  exige `enable_auth_token = true` (imposé au moment du plan).
- **Instance unique obligatoire.** `max_instance_count = 1` est la valeur par
  défaut. Plusieurs instances Cloud Run sur le même montage GCS FUSE ne peuvent pas
  coordonner leurs écritures et corrompront les collections.
- **GCS FUSE est le backend de persistance.** Un bucket `<prefix>-data` est
  provisionné automatiquement et monté sur `/data`. L'environnement d'exécution
  Gen2 est requis.
- **Le jeton d'authentification est facultatif mais recommandé** pour tout
  déploiement accessible hors du VPC. Lorsqu'il est activé, le jeton est stocké
  dans Secret Manager et doit être transmis sous la forme
  `Authorization: Bearer <token>` dans chaque appel d'API.
- **Les sondes de santé sont fixées sur `/api/v2/heartbeat`.** C'est le seul point
  de terminaison de santé qu'expose Chroma ; le chemin de la sonde ne peut pas être
  modifié.
- **La télémétrie anonymisée est toujours désactivée.** `ANONYMIZED_TELEMETRY=false`
  est injecté automatiquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Chroma {#a-cloud-run--the-chroma-service}

Chroma s'exécute sous la forme d'un service Cloud Run v2. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre révisions pour des
déploiements sûrs. `cpu_always_allocated` vaut `false` par défaut (facturation à
la requête) ; définissez-le à `true` (avec `min_instance_count
>= 1`) pour conserver le CPU alloué entre les requêtes, afin que les opérations
d'index en arrière-plan et les contrôles de santé ne soient jamais limités.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage (GCS FUSE) — persistance des données de Chroma {#b-cloud-storage-gcs-fuse--chroma-data-persistence}

Chroma stocke sa base SQLite intégrée, les fichiers d'index HNSW et les
métadonnées des collections dans le chemin `/data`. Un bucket Cloud Storage dédié
(`<prefix>-data`) est provisionné automatiquement et monté sur `/data` via le
pilote CSI GCS FUSE. Le compte de service Cloud Run reçoit automatiquement un
accès en lecture et en écriture.

- **Console :** Cloud Storage → Buckets — recherchez le bucket dont le nom se termine par `-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/chroma/    # inspect Chroma's on-disk layout
  # Confirm the GCS FUSE mount inside a running instance:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse, les options CMEK et la
gestion des buckets.

### C. Secret Manager {#c-secret-manager}

Lorsque `enable_auth_token = true`, le jeton d'authentification de l'API de
Chroma est généré et stocké sous forme de secret Secret Manager. Il est injecté
dans le service à l'exécution sous la forme `CHROMA_SERVER_AUTHN_CREDENTIALS` ; la
valeur en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the token to configure API clients:
  gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le service n'est accessible qu'au sein du VPC
(`ingress_settings = "internal"`). Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres
de sortie déterminent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  # Test the Chroma heartbeat from inside the VPC:
  curl <internal-service-url>/api/v2/heartbeat
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec un test de disponibilité facultatif sur
`/api/v2/heartbeat` et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chroma {#3-chroma-application-behaviour}

- **Aucun amorçage de base de données.** Chroma gère son propre stockage intégré
  et ne nécessite aucun job d'initialisation de base de données. Aucune tâche
  `db-init` n'est injecté. Si vous fournissez des `initialization_jobs`
  personnalisées, elles s'exécutent en tant que Cloud Run Jobs avant la mise à
  jour du service.
- **Chargement des index au démarrage à froid.** Lorsqu'une nouvelle instance
  démarre (après une mise à l'échelle à zéro ou une nouvelle révision), elle charge
  les index HNSW depuis le bucket GCS. Pour de grandes collections, cela peut
  prendre plusieurs dizaines de secondes ; la sonde de démarrage sur
  `/api/v2/heartbeat` attend que Chroma signale qu'il est prêt. Conservez
  `min_instance_count = 1` pour éviter cela à chaque requête.
- **Contrainte d'instance unique.** Chroma est un magasin à rédacteur unique.
  Plusieurs instances Cloud Run sur le même montage GCS FUSE corrompront les
  collections, car il n'existe aucun verrou d'écriture distribué. Conservez
  toujours `max_instance_count = 1`. Faites évoluer verticalement (augmentez le CPU
  et la mémoire) plutôt qu'horizontalement.
- **Utilisation du jeton d'authentification.** Lorsque `enable_auth_token = true`,
  tous les appels d'API doivent inclure `Authorization: Bearer <token>`. Récupérez
  le jeton dans Secret Manager, puis utilisez-le :
  ```bash
  TOKEN=$(gcloud secrets versions access latest \
    --secret=<prefix>-auth-token --project "$PROJECT")
  curl -H "Authorization: Bearer $TOKEN" <service-url>/api/v2/collections
  ```
  Client Python :
  ```python
  import chromadb
  client = chromadb.HttpClient(
      host="<service-hostname>", port=443, ssl=True,
      headers={"Authorization": f"Bearer {TOKEN}"}
  )
  ```
- **Sonde de santé.** Les sondes de démarrage et d'activité ciblent toutes deux
  `/api/v2/heartbeat` en HTTP. Le chemin de la sonde est fixé par Chroma_Common et
  ne peut pas être modifié. La sonde de démarrage prévoit un délai initial de 15
  secondes pour laisser le temps au montage GCS FUSE et au chargement des index.
- **Tâches planifiées.** Chroma ne dispose d'aucune commande planifiée intégrée.
  Utilisez `cron_jobs` si vous avez besoin d'instantanés périodiques des
  collections ou de tâches de maintenance, déclenchés par Cloud Scheduler.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Chroma ou notables pour
lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `enable_auth_token` | `false` | Génère un jeton d'API aléatoire et le stocke dans Secret Manager. Recommandé pour tout déploiement accessible hors du VPC. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chroma` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Chroma Vector Database` | Nom convivial affiché dans la console. |
| `description` | _(définie)_ | Description du service Cloud Run. |
| `application_version` | `latest` | Étiquette de version de l'image Chroma. Épinglez une version précise pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez à `2000m` ou plus pour les charges de travail de requêtes en production. |
| `memory_limit` | `1Gi` | Mémoire par instance. Chroma charge les index HNSW en mémoire — dimensionnez-la selon le nombre de collections et la dimension des vecteurs. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Conservez ≥ 1 pour éviter les démarrages à froid avec rechargement des index. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Laissez à 1 — plusieurs instances sur le même chemin GCS FUSE corrompront les collections. |
| `container_port` | `8000` | Port de l'API REST de Chroma. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS FUSE. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut ; définissez `true` pour conserver le CPU alloué entre les requêtes et éviter les dépassements de délai des opérations d'index en arrière-plan. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez-la pour de grandes recherches par similarité par lots. |
| `enable_cloudsql_volume` | `false` | Sans objet — Chroma n'a pas de base de données SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Chroma dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre révisions. |
| `max_revisions_to_retain` | `7` | Nombre maximal de révisions Cloud Run à conserver. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | Conservez `internal` afin que Chroma ne soit accessible qu'au sein du VPC. Définir `all` exige `enable_auth_token = true` (imposé au moment du plan). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de sortie du VPC. |
| `enable_iap` | `false` | Exige une authentification par identité Google via IAP. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `ANONYMIZED_TELEMETRY=false` et `CHROMA_SERVER_HTTP_PORT=8000` sont toujours injectés. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation des secrets (30 jours). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention en jours. Augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`,
`additional_cloudrun_sa_roles`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — sans objet pour Chroma (pas de base de données
SQL). Ces variables sont acceptées pour la compatibilité avec le socle mais n'ont
aucun effet. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et Artifact Registry {#group-10--load-balancer-cdn--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global avec le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge HTTPS. Nécessite `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS. Le bucket `<prefix>-data` est provisionné automatiquement par Chroma_Common. |
| `storage_buckets` / `gcs_volumes` | _(définies)_ | Buckets / montages GCS FUSE supplémentaires. |
| `enable_nfs` | `false` | Monte un partage NFS Cloud Filestore (nécessite gen2). Chroma utilise GCS pour son stockage principal ; à n'activer que pour des jobs d'initialisation personnalisés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS dans le conteneur. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Sans objet — Chroma n'a pas de base de données SQL. Les variables suivantes ne
sont acceptées que pour la compatibilité avec le socle et sont fixées ou
ignorées : `database_type` (fixée à
`NONE`), `database_password_length`, `enable_auto_password_rotation`,
`rotation_propagation_delay_sec`, `db_host_env_var_name`, `db_user_env_var_name`,
`db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name`.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Chroma ne nécessite aucun job d'initialisation par défaut. Fournissez des tâches uniquement pour un chargement de données personnalisé. |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler (par exemple, instantanés des collections). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v2/heartbeat` | Sonde de démarrage HTTP — Chroma renvoie 200 une fois entièrement initialisé. Le chemin de la sonde est fixe. |
| `liveness_probe` / `health_check_config` | `/api/v2/heartbeat` | Sonde de vivacité. |
| `uptime_check_config` | `enabled=false, path=/api/v2/heartbeat` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `chroma_api_url` | URL interne au VPC de l'API v2 de Chroma (ajoutez `/collections`, `/heartbeat`, etc.). Accessible uniquement au sein du VPC lorsque `ingress_settings` vaut `internal`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration personnalisées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_auth_token` | `true` pour tout déploiement accessible de l'extérieur | Critique | Sans jeton, tout appelant capable d'atteindre l'API Chroma peut lire, écrire ou supprimer toutes les collections. |
| `ingress_settings` | `internal` (par défaut) | Élevé | Passer à `"all"` sans `enable_auth_token = true` expose une base de données vectorielle non authentifiée à l'internet public (bloqué au moment du plan). |
| `max_instance_count` | `1` | Élevé | Plusieurs instances sur le même chemin GCS FUSE corrompront les collections — Chroma ne dispose d'aucun verrou d'écriture distribué. |
| `execution_environment` | `gen2` | Élevé | GCS FUSE nécessite Gen2. Un déploiement avec `gen1` alors que des volumes GCS sont configurés échoue. |
| `memory_limit` | `4Gi` ou plus pour la production | Élevé | Chroma charge les index HNSW en mémoire. La valeur par défaut `1Gi` ne prend en charge que de très petites collections ; les arrêts pour dépassement de mémoire (OOM) interrompent les requêtes en cours. |
| `cpu_always_allocated` | `true` | Moyen | Définir `false` entraîne une limitation du CPU entre les requêtes, ce qui ralentit les opérations d'index et peut provoquer des dépassements de délai des contrôles de santé. |
| `application_version` | épingler une étiquette précise | Moyen | Utiliser `latest` rend les déploiements non reproductibles. Les formats de données de Chroma peuvent changer d'une version majeure à l'autre. |
| `timeout_seconds` | augmenter pour les grandes collections | Moyen | Les grandes recherches par similarité sur des millions de vecteurs peuvent prendre plusieurs secondes ; des erreurs 504 sont renvoyées aux clients si le délai est trop court. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro provoque des démarrages à froid pendant lesquels les index HNSW doivent être rechargés depuis GCS, ce qui ajoute de la latence à la première requête après une période d'inactivité. |
| `enable_iap` / `enable_cloud_armor` | activer pour les services accessibles de l'extérieur | Élevé | Sans authentification, un point de terminaison Chroma exposé à l'extérieur est entièrement ouvert. |
| `backup_retention_days` | augmenter pour la production | Moyen | Les instantanés réguliers du bucket GCS constituent le principal moyen de récupération ; une rétention trop courte limite les options de récupération. |
| `enable_cloudsql_volume` | `false` | Faible | Chroma n'a pas de base de données SQL ; l'activer injecte un sidecar Cloud SQL Auth Proxy qui consomme inutilement des ressources. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Chroma, partagée avec la variante GKE, est décrite dans
**[Chroma_Common](Chroma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chroma sur Cloud Run](../labs/Chroma_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Chroma sur GKE Autopilot](Chroma_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chroma Common — Configuration applicative partagée](Chroma_Common.md) — la configuration partagée par les deux cibles de déploiement.
