---
title: "Memos sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Memos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Memos_CloudRun.md @ 15fd4c7 sha256:934628173717 -->

# Memos sur Google Cloud Run {#memos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_CloudRun.png" alt="Memos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes auto-hébergé, open-source, sous licence
MIT, conçu pour la capture rapide de markdown — un binaire Go unique d'environ
20 Mo avec un frontend React. Ce module déploie Memos sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Memos et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Memos s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
connecte un ensemble délibérément restreint de services Google Cloud — Memos
n'a pas de file d'attente, pas de cache et pas de workers en arrière-plan :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur, mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module standardise sur Postgres via une URL de connexion unique `MEMOS_DSN` |
| Stockage de fichiers | Cloud Filestore (NFS) | `enable_nfs = true` par défaut, monté dans le répertoire de données de Memos `/var/opt/memos` — voir la note sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos n'a pas de dépendance de file d'attente ou de cache |
| Secrets | Secret Manager | Seul le mot de passe de la base de données (géré par la Fondation) ; Memos lui-même n'a pas de secret au niveau de l'application |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Memos_Common` corrige
  `database_type = "POSTGRES_15"`. Memos lui-même prend également en charge MySQL et SQLite
  en amont, mais ce module ne connecte pas ces chemins.
- **Il n'existe pas de secret d'amorçage administrateur.** Le **premier compte
  créé via l'interface utilisateur web devient l'hôte/administrateur** — il
  n'y a pas de variable d'environnement de type `DEFAULTUSER` et rien à
  récupérer de Secret Manager pour la première connexion.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Memos ne fait aucun travail sans une requête entrante,
  donc la facturation basée sur les requêtes est la bonne valeur par défaut —
  contrairement aux applications avec des planificateurs en arrière-plan ou des
  push WebSocket, il n'y a aucune raison de forcer un CPU toujours actif ici.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, et
  non intégré à l'image. `memos-entrypoint.sh` lit les variables `DB_*`
  injectées par la plateforme et construit l'URL de connexion unique `MEMOS_DSN`
  que Memos attend, en se basant sur le fait que Cloud Run lui a fourni un
  répertoire de socket Unix ou un hôte TCP, et en encodant l'URL du mot de
  passe.
- **Les pièces jointes sont sur NFS par défaut.** Memos écrit les pièces
  jointes téléchargées sous forme de fichiers sous `/var/opt/memos/assets`, et non
  dans PostgreSQL. `enable_nfs = true` monte le volume Filestore partagé à
  `nfs_mount_path` (`/var/opt/memos`), de sorte que les pièces jointes
  survivent aux révisions et à la mise à l'échelle à zéro. Gardez NFS activé
  sauf si le déploiement est uniquement textuel ; s'il est désactivé, les
  pièces jointes résident sur le système de fichiers éphémère du conteneur et
  sont perdues à chaque redémarrage.
- **L'inscription publique est ouverte par défaut**, comme toute nouvelle
  installation de Memos. Désactivez l'auto-inscription depuis l'interface
  utilisateur de Memos après avoir créé le premier compte (administrateur), si
  le déploiement ne doit pas accepter d'autres inscriptions publiques.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Memos {#a-cloud-run--the-memos-service}

Memos s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données de l'application (notes, tags, utilisateurs,
métadonnées de ressources) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur
de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module —
entièrement géré par la Fondation, et non par `Memos_Common`. Memos génère sa
propre clé de signature de session interne et la stocke dans sa propre base de
données au premier démarrage ; il n'y a pas d'entrée Secret Manager
correspondante à inspecter.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
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

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité
et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle
  et la base de données de l'application. Le job peut être réexécuté en toute
  sécurité.
- **Migrations de schéma au démarrage.** Memos applique sa propre
  configuration de schéma GORM auto-migrée interne à chaque démarrage — aucun
  job de migration séparé n'est nécessaire, et la mise à niveau de `application_version`
  applique automatiquement les modifications de schéma.
- **Aucune information d'identification d'amorçage administrateur à récupérer.**
  Le premier compte créé via le formulaire d'inscription de l'interface
  utilisateur web devient l'hôte/administrateur. Il n'y a rien dans Secret
  Manager à récupérer avant la première connexion — cela diffère de la plupart
  des applications de ce catalogue.
- **Le DSN de la base de données est calculé, et non statique.** `memos-entrypoint.sh`
  construit `MEMOS_DSN` à partir de
  `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` au
  démarrage du conteneur (voir [Memos_Common](Memos_Common.md) pour la logique
  de branchement exacte), puis se connecte au point d'entrée de l'image
  upstream, qui abandonne les privilèges à un utilisateur non root avant de
  lancer le binaire compilé.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` — la page de connexion/d'accueil publique de Memos,
  accessible sans authentification. Aucun endpoint `/health` ou
  `/healthz` dédié n'est documenté en amont.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Memos sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Memos note-taking service on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Memos_Common` mappe `"latest"` à l'argument de build Dockerfile `MEMOS_VERSION = "0.28.0"` épinglé, de sorte qu'une nouvelle build ne résout jamais un tag `latest` upstream inexistant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper avec le point d'entrée DSN calculé. `"prebuilt"` déploie directement l'image officielle mais nécessite ensuite de connecter manuellement `MEMOS_DRIVER`/`MEMOS_DSN` via `environment_variables`. |
| `container_image` | `ghcr.io/usememos/memos` | Référence de l'image de base utilisée par la build personnalisée. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance — suffisante pour la faible empreinte de Memos. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro — Memos n'a pas de travail en arrière-plan à maintenir actif. |
| `max_instance_count` | `1` | Valeur par défaut pour une seule instance ; augmentez pour une charge concurrente plus élevée. |
| `container_port` | `5230` | Port natif par défaut de Memos — aucune remappage effectué. |
| `execution_environment` | `gen2` | Gen2 est requis pour le montage NFS qui contient les pièces jointes. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Memos ne fait aucun travail entre les requêtes. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Memos dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public ; Memos n'a pas de chemin d'ingestion non authentifié séparé à protéger. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici (par exemple `MEMOS_INSTANCE_URL`). La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`
exécutent du SQL à partir d'un bucket GCS après le provisionnement. `nfs_instance_name` /
`nfs_instance_base_name` sélectionnent le serveur NFS partagé dont le volume contient le
répertoire de données de Memos (voir Groupe 11). Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets` — vide par défaut, car les pièces jointes Memos ne sont pas sauvegardées par GCS dans ce module. |
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `true` | Monte le volume NFS partagé à `nfs_mount_path` (`/var/opt/memos`), où Memos stocke les pièces jointes téléchargées. Le désactiver place les pièces jointes sur un disque éphémère. |
| `gcs_volumes` | `[]` | Non nécessaire pour les pièces jointes, qui sont sur NFS par défaut. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Memos n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s de délai | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Memos n'a pas de dépendance de cache/file d'attente ; laissez `false` sauf si vous intégrez une instance Redis externe à des fins personnalisées. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

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
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vides par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (inclut `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide échoue la **planification** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé via l'inscription | Le créer immédiatement après le déploiement | Critique | Le **premier** compte à s'inscrire devient hôte/administrateur — s'il est laissé ouvert, tout visiteur qui atteint l'URL en premier revendique ce rôle. |
| Auto-inscription publique | Désactiver après le premier administrateur | Élevé | Memos est livré avec l'inscription ouverte par défaut ; le laisser activé permet à quiconque ayant l'URL de créer un compte. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, mais cette image n'a pas de logique pour calculer `MEMOS_DSN` à partir des variables `DB_*` de la plateforme — elle doit être connectée manuellement via `environment_variables` ou l'application ne parvient pas à se connecter à la base de données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_file` valide échoue le job d'importation. |
| `memory_limit` | `512Mi` (la valeur par défaut est suffisante) | Moyen | L'empreinte de Memos est petite ; l'augmentation de cette valeur affecte principalement le coût, pas la correction. |
| `min_instance_count` | `0` (par défaut) | Faible | La mise à l'échelle à zéro ajoute un bref démarrage à froid (binaire Go, démarrage rapide) à la première requête après l'inactivité — beaucoup plus court que les applications JVM/Node.js de ce catalogue. |
| `enable_nfs` pour les pièces jointes | Laisser `true` | Moyen | Avec NFS désactivé, les pièces jointes téléchargées résident sur le système de fichiers éphémère de Cloud Run et ne survivent pas à un redémarrage de révision ou à une mise à l'échelle à zéro — les notes textuelles dans PostgreSQL ne sont pas affectées. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le formulaire de connexion/inscription est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Memos partagée avec la variante GKE est décrite
dans **[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur Cloud Run](../labs/Memos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Memos sur GKE Autopilot](Memos_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration d'application partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Connaissances personnelles et lecture**.
