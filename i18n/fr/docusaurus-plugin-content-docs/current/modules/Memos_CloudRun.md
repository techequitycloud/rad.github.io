---
title: "Memos sur Google Cloud Run"
description: "Référence de configuration pour déployer Memos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Memos_CloudRun.md @ 3055034 sha256:fda2389547a2 -->

# Memos sur Google Cloud Run {#memos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_CloudRun.png" alt="Memos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes open source, sous licence MIT et auto-hébergé, conçu
pour la saisie rapide en markdown — un unique binaire Go d'environ 20MB avec un frontend React. Ce
module déploie Memos sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Memos et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Memos s'exécute sous forme de conteneur Go unique sur Cloud Run v2. Le déploiement assemble
un ensemble volontairement restreint de services Google Cloud — Memos n'a ni file d'attente, ni cache,
ni workers en arrière-plan :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique serverless, mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module standardise sur Postgres via une URL de connexion unique `MEMOS_DSN` |
| Stockage d'objets | aucun | Non provisionné par ce module — voir la remarque sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos ne dépend d'aucune file d'attente ni d'aucun cache |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données (géré par le socle) ; Memos lui-même n'a pas de secret applicatif |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Memos_Common` impose
  `database_type = "POSTGRES_15"`. Memos prend aussi en charge MySQL et SQLite en
  amont, mais ce module ne raccorde pas ces options.
- **Il n'existe aucun secret d'amorçage administrateur.** Le **premier compte créé via l'interface
  web devient l'hôte/administrateur** — il n'y a pas de variable d'environnement de type `DEFAULTUSER` ni rien
  à récupérer dans Secret Manager pour la première connexion.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Memos n'effectue aucun travail sans requête entrante ; la
  facturation à la requête est donc la bonne valeur par défaut — contrairement aux applications dotées de
  planificateurs en arrière-plan ou de push WebSocket, rien ne justifie ici de forcer un CPU toujours alloué.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, et non intégré à l'image.
  `memos-entrypoint.sh` lit les variables `DB_*` injectées par la plateforme et construit
  l'URL de connexion unique `MEMOS_DSN` attendue par Memos, selon que Cloud Run lui a transmis
  un répertoire de socket Unix ou un hôte TCP, et en encodant le mot de passe pour l'URL.
- **Aucun stockage d'objets n'est provisionné.** Ce module ne déclare ni bucket GCS ni
  volume pour les pièces jointes téléversées. Les notes textuelles sont entièrement persistées dans PostgreSQL, mais
  les pièces jointes binaires résideraient sur le système de fichiers éphémère du conteneur Cloud Run et
  ne survivraient **pas** à un redémarrage de révision. Cela convient à une prise de notes purement textuelle ; ajoutez une
  entrée `gcs_volumes` si la persistance des pièces jointes est requise.
- **L'inscription publique est ouverte par défaut**, comme pour toute installation neuve de Memos. Désactivez
  l'auto-inscription depuis l'interface de Memos après avoir créé le premier compte (administrateur),
  si le déploiement ne doit plus accepter d'inscriptions publiques.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de
ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Memos {#a-cloud-run--the-memos-service}

Memos s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle automatiquement selon la
charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données applicatives (notes, tags, utilisateurs, métadonnées des ressources) dans une
instance gérée Cloud SQL for PostgreSQL 15. Le service se connecte de façon privée
via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune adresse IP publique n'est exposée.
Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur applicatifs.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module — entièrement géré par le
socle, et non par `Memos_Common`. Memos génère sa propre clé interne de signature des sessions
et la stocke dans sa propre base de données au premier démarrage ; il n'existe aucune entrée Secret Manager
correspondante à inspecter.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute
  `create-db-and-user.sh` à l'aide de `postgres:15-alpine`. Il se connecte via le Cloud
  SQL Auth Proxy et crée de manière idempotente le rôle et la base de données applicatifs. La
  tâche peut être réexécutée sans risque.
- **Migrations de schéma au démarrage.** Memos applique sa propre configuration de schéma interne par
  auto-migration GORM à chaque démarrage — aucune tâche de migration distincte n'est nécessaire, et
  la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Aucun identifiant d'amorçage administrateur à récupérer.** Le premier compte créé via le
  formulaire d'inscription de l'interface web devient l'hôte/administrateur. Il n'y a rien à récupérer dans
  Secret Manager avant la première connexion — contrairement à la plupart des applications de ce
  catalogue.
- **Le DSN de la base de données est calculé, et non statique.** `memos-entrypoint.sh` construit
  `MEMOS_DSN` à partir de `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` au
  démarrage du conteneur (voir [Memos_Common](Memos_Common.md) pour la logique de branchement
  exacte), puis enchaîne sur le point d'entrée propre de l'image amont, qui abandonne
  les privilèges au profit d'un utilisateur non root avant de lancer le binaire compilé.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — la page publique de
  connexion/d'accueil de Memos, accessible sans authentification. Aucun point de terminaison `/health` ou
  `/healthz` dédié n'est documenté en amont.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Memos ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails disposant d'un accès au projet et recevant les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible affiché dans la console. |
| `application_description` | `Memos note-taking service on Cloud Run` | Description du service. |
| `application_version` | `latest` | Étiquette de suivi du déploiement. `Memos_Common` convertit `"latest"` en l'argument de build Dockerfile figé `MEMOS_VERSION = "0.28.0"`, de sorte qu'un nouveau build ne résout jamais une étiquette amont `latest` inexistante. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image d'encapsulation avec le point d'entrée qui calcule le DSN. `"prebuilt"` déploie directement l'image officielle mais impose alors de raccorder manuellement `MEMOS_DRIVER`/`MEMOS_DSN` via `environment_variables`. |
| `container_image` | `ghcr.io/usememos/memos` | Référence de l'image de base utilisée par le build personnalisé. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance — suffisante pour la faible empreinte de Memos. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro — Memos n'a aucun travail en arrière-plan justifiant de rester actif. |
| `max_instance_count` | `1` | Instance unique par défaut ; à augmenter pour une charge concurrente plus élevée. |
| `container_port` | `5230` | Port par défaut natif de Memos — aucun remappage effectué. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse (non utilisés par ce module, mais valeur par défaut de la plateforme). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `cpu_always_allocated` | `false` | Facturation à la requête — Memos n'effectue aucun travail entre les requêtes. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Memos dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique ; Memos n'a pas de chemin d'ingestion non authentifié distinct à protéger. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici (par exemple `MEMOS_INSTANCE_URL`). La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter en production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restauration depuis une sauvegarde au déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`
exécutent du SQL depuis un bucket GCS après le provisionnement. `nfs_instance_name` /
`nfs_instance_base_name` sont déclarés par cohérence avec la convention mais ne sont pas utilisés —
Memos n'utilise pas NFS. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets` — vide par défaut, puisque les pièces jointes de Memos ne reposent pas sur GCS dans ce module. |
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `false` | Non utilisé — Memos ne conserve aucun état en dehors de PostgreSQL dans le raccordement de ce module. |
| `gcs_volumes` | `[]` | Ajoutez une entrée ici (montée sur le répertoire de données de Memos) si la persistance des pièces jointes entre révisions est requise. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur applicatif de la base de données. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Non utilisé — Memos n'a aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 30s | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; à activer explicitement. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Memos ne dépend d'aucun cache ni d'aucune file d'attente ; laissez `false`, sauf pour intégrer une instance Redis externe à des fins personnalisées. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vide par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (inclut `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et leurs
> combinaisons au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire
> et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées
> en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé par inscription | Le créer immédiatement après le déploiement | Critical | Le **premier** compte inscrit devient l'hôte/administrateur — si l'inscription reste ouverte, le premier visiteur qui atteint l'URL s'approprie ce rôle. |
| Auto-inscription publique | La désactiver après le premier administrateur | High | Memos est livré avec l'inscription ouverte par défaut ; la laisser activée permet à quiconque dispose de l'URL de créer un compte. |
| `container_image_source` | `custom` (défaut) | High | `"prebuilt"` déploie directement l'image officielle, mais cette image ne contient aucune logique pour calculer `MEMOS_DSN` à partir des variables `DB_*` de la plateforme — elle doit être raccordée manuellement via `environment_variables`, sinon l'application ne parvient pas à se connecter à la base de données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer la tâche d'import. |
| `memory_limit` | `512Mi` (la valeur par défaut suffit) | Medium | L'empreinte de Memos est faible ; l'augmenter affecte surtout le coût, pas le bon fonctionnement. |
| `min_instance_count` | `0` (défaut) | Low | La mise à l'échelle à zéro ajoute un bref démarrage à froid (binaire Go, démarrage rapide) à la première requête après une période d'inactivité — bien plus court que pour les applications JVM/Node.js de ce catalogue. |
| `gcs_volumes` pour les pièces jointes | À ajouter explicitement si nécessaire | Medium | Sans lui, les pièces jointes binaires téléversées résident sur le système de fichiers éphémère de Cloud Run et ne survivent pas à un redémarrage de révision — les notes textuelles dans PostgreSQL ne sont pas affectées. |
| `enable_cloud_armor` | à activer en production | Medium | Le formulaire de connexion/d'inscription est accessible publiquement sans protection WAF par défaut. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Memos
partagée avec la variante GKE est décrite dans
**[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur Cloud Run](../labs/Memos_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Memos sur GKE Autopilot](Memos_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration applicative partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Personal Knowledge & Reading**.
