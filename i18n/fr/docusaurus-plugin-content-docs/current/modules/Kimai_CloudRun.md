---
title: "Kimai sur Google Cloud Run"
description: "Référence de configuration pour déployer Kimai sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Kimai_CloudRun.md @ 3055034 sha256:d015882471ea -->

# Kimai sur Google Cloud Run {#kimai-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kimai_CloudRun.png" alt="Kimai sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kimai est une application de suivi du temps gratuite et open source (Symfony/PHP) utilisée par
les indépendants et les agences pour le suivi des heures facturables, les feuilles de temps et
les rapports qui alimentent la facturation. Ce module déploie Kimai sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Kimai et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Kimai s'exécute comme un conteneur Symfony/PHP (l'image officielle `kimai/kimai2:apache`,
encapsulée dans un build personnalisé léger) sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Symfony/PHP, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — `Kimai_Common` fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage objet | Cloud Storage | Un bucket `storage`, monté via GCS-FUSE sur `/opt/kimai/var/data` pour les logos/modèles de facture téléversés et les données des plugins |
| Secrets | Secret Manager | `APP_SECRET` (clé de signature Symfony) et `ADMINPASS` (mot de passe administrateur) générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Kimai_Common` ; choisir un autre moteur casse le déploiement.
- **L'image d'encapsulation personnalisée est obligatoire, et non optionnelle.** `container_image_source
  = "custom"` construit une image légère `FROM kimai/kimai2` dont le point d'entrée compose
  l'unique chaîne de connexion `DATABASE_URL` de Kimai au démarrage du conteneur à partir des
  valeurs secrètes injectées par le socle — Cloud Run ne peut pas le faire au moment du plan
  (voir §3).
- **`container_port = 8001`**, et non le port 80 — confirmé par des tests locaux avec `docker run`
  et par un déploiement réel. C'est le port d'écoute effectif de la variante d'image `:apache`.
- **`enable_cloudsql_volume = false`.** Cloud Run se connecte à Cloud SQL via
  l'**IP privée directement (TCP)**, et non via le socket Unix de l'Auth Proxy. La variante
  GKE exécute à la place un sidecar Auth Proxy.
- **Deux secrets Secret Manager, générés une seule fois.** `APP_SECRET` (clé de signature
  CSRF/session de Symfony) et `ADMINPASS` (mot de passe initial du super-administrateur) —
  tous deux réinjectés depuis Secret Manager à chaque démarrage du conteneur, si bien qu'aucun
  volume persistant n'est nécessaire simplement pour les maintenir stables.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première requête
  après une période d'inactivité ; définissez `min_instance_count = 1` pour l'éviter.
- **`enable_nfs` vaut `true` par défaut mais n'est pas utilisé en pratique.** Il monte
  Cloud Filestore NFS sur `/var/lib/kimai`, mais le véritable chemin de stockage persistant
  est le bucket `storage` monté via GCS-FUSE sur `/opt/kimai/var/data`.
  Rien n'écrit sur le montage NFS. Il peut être désactivé sans risque.
- **Pas de tâche de migration distincte.** `kimai:install` (création du schéma et
  migrations) s'exécute à chaque démarrage du conteneur, de manière idempotente, dans le cadre de la
  chaîne de points d'entrée propre à l'éditeur — seule une tâche `db-init` est nécessaire pour
  créer au préalable la base de données et l'utilisateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des
ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Kimai {#a-cloud-run--the-kimai-service}

Kimai s'exécute comme un service Cloud Run v2 qui se met à l'échelle selon la charge des requêtes entre
les nombres minimal et maximal d'instances. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Kimai stocke toutes les données applicatives (projets, activités, feuilles de temps, utilisateurs,
factures) dans une instance gérée Cloud SQL for MySQL 8.0. Le service se connecte
via l'**IP privée de l'instance en TCP** (et non via le socket de l'Auth Proxy —
`enable_cloudsql_volume` vaut `false` par défaut pour ce module). Lors du premier déploiement, une
tâche `db-init` crée la base de données et l'utilisateur de l'application ; `kimai:install`
crée ensuite le schéma au premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Deux buckets GCS peuvent exister pour ce déploiement : un bucket `storage` provisionné
par `Kimai_Common` et monté via GCS-FUSE sur `/opt/kimai/var/data` (logos/modèles de facture
téléversés, données des plugins), et un bucket générique **distinct** au niveau du
socle (`storage_buckets`, par défaut un bucket nommé
`data`) que Kimai ne lit ni n'écrit, sauf si vous le raccordez explicitement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`APP_SECRET` (clé de signature CSRF/session de Symfony) et `ADMINPASS` (le mot de passe initial
du compte super-administrateur). Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte optionnels.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Kimai {#3-kimai-application-behaviour}

- **Une `DATABASE_URL` unique composée entièrement à l'exécution, et non transmise par
  Terraform.** La couche Doctrine DBAL de Kimai lit une seule chaîne de connexion,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  et non des variables `DB_*` distinctes. Comme le mot de passe de la base de données est un secret
  d'exécution inconnu au moment du plan, et que Cloud Run n'interpole pas les références `$(VAR)`
  comme le fait Kubernetes, `Kimai_Common` construit une image
  d'encapsulation personnalisée légère `FROM kimai/kimai2` dont l'`entrypoint.sh` compose
  `DATABASE_URL` au démarrage du conteneur à partir des variables d'environnement
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` injectées par le socle — en encodant le
  mot de passe pour l'URL avec `php -r 'echo rawurlencode(...)'` (l'image ne contient pas
  `python3` ; c'*est* une image PHP) — avant de passer la main, sans modification, au
  `docker-php-entrypoint /entrypoint.sh` propre à l'éditeur.
- **`DB_IP`, et non le `DB_HOST` standard.** L'encapsulation lit l'hôte depuis
  `$DB_IP` (alias défini via `db_host_env_var_name = "DB_IP"`), qui se résout en
  IP privée brute de Cloud SQL sur Cloud Run — un hôte simple sans deux-points,
  qui peut être placé directement dans la partie autorité d'une URL `mysql://...`. Le
  `DB_HOST` standard peut au contraire être un chemin de répertoire de socket Unix Cloud SQL contenant
  des deux-points, ce qui casserait l'analyse de l'URL s'il était utilisé de la même manière.
- **Vérifié localement avant tout passage dans le cloud.** L'étape d'encodage du mot de passe
  pour l'URL et la vérification préalable d'attente de la base de données propre à l'éditeur ont toutes deux été
  confirmées en construisant l'image d'encapsulation et en l'exécutant localement contre un
  véritable conteneur MySQL avec un mot de passe contenant des caractères spéciaux
  (`@:/?`), ce qui a permis de détecter et corriger des problèmes avant la première tentative de déploiement dans le cloud.
- **Comportement du contrôle de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /en/login` (la page de connexion de Kimai), qui renvoie `200` une fois
  l'application prête. `/` fonctionne aussi de manière générique (Kimai émet une redirection `302`
  depuis le chemin racine), mais `/en/login` est la cible précise et vérifiée
  réellement configurée.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/en/login"   # expect 200
  ```
- **L'amorçage de l'administrateur s'exécute à chaque démarrage, de manière idempotente.** Le point d'entrée
  propre à l'éditeur exécute `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` à chaque démarrage du conteneur dès que `ADMINPASS` est défini — sans
  effet une fois le compte existant. **Le nom d'utilisateur est toujours `admin`**,
  codé en dur par l'image de l'éditeur quelle que soit la valeur de `admin_email`.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Kimai ou notables pour lui sont listés ; toutes les autres entrées sont
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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kimai` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Kimai` | Nom lisible affiché dans la console. |
| `description` | `Kimai IT asset management on Cloud Run` | Texte générique résiduel dans la valeur par défaut livrée (hérité d'une source clonée antérieure — Kimai fait du suivi du temps, pas de la gestion de parc) ; purement cosmétique, sans effet sur le déploiement. |
| `application_version` | `latest` | Tag d'image qui pilote le build `kimai/kimai2`. `"latest"` correspond au tag glissant maintenu `:apache` ; toute autre valeur correspond à `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | Adresse e-mail du compte super-administrateur, injectée sous la forme `ADMINMAIL`. Le nom d'utilisateur du compte est toujours `admin`, codé en dur par le point d'entrée de l'éditeur. |
| `php_memory_limit` | `512M` | `memory_limit` de PHP (le point d'entrée de l'éditeur lit directement la variable d'environnement `memory_limit` en minuscules). |
| `enable_gcs_storage_volume` | `true` | Monte via GCS-FUSE le bucket `storage` sur `/opt/kimai/var/data`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit via Cloud Build l'image d'encapsulation qui compose `DATABASE_URL` — obligatoire, et non optionnelle, pour ce module. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `8001` | La variante d'image `:apache` de Kimai écoute sur 8001, ce qui a été confirmé par des tests locaux et un déploiement réel. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte directement en TCP à l'IP privée de Cloud SQL au lieu du socket de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `DATABASE_URL` ici — elle est composée à l'exécution par le point d'entrée d'encapsulation. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; à augmenter en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS générique `data`. Kimai ne le lit ni ne l'écrit. |
| `enable_nfs` | `false` | **Non utilisé en pratique** — monté sur `/var/lib/kimai`, mais le véritable stockage persistant de Kimai est le bucket `storage` monté via GCS-FUSE sur `/opt/kimai/var/data`. Peut être désactivé sans risque. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires (nécessite gen2), fusionnés avec le montage du bucket `storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Kimai_Common`. |
| `db_name` / `db_user` | `kimai` | Préfixés par le tenant au moment du déploiement. Immuables après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` | `DB_IP` | Crée un alias de l'hôte de la base de données afin que la composition de `DATABASE_URL` par l'encapsulation lise un hôte simple, sans deux-points — le `DB_HOST` standard peut être un chemin de répertoire de socket sur Cloud Run, ce qui casserait l'analyse de l'URL. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (les quatre) | **Non utilisées par Kimai** — l'encapsulation lit directement les variables standard `DB_USER`/`DB_NAME`/`DB_PASSWORD` et code en dur le port `3306`. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` unique intégrée. Il n'y a pas de tâche de migration distincte — `kimai:install` s'exécute à chaque démarrage du conteneur, de manière idempotente. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `GET /en/login`, délai de 30s, 20 tentatives | Généreuse — couvre la vérification préalable d'attente de la base de données et `kimai:install` au premier démarrage. |
| `liveness_probe` | `GET /en/login`, délai de 60s, 3 tentatives | Page de connexion de Kimai, 200 une fois prête. |
| `uptime_check_config` | `{ enabled = false }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai n'a pas d'intégration Redis native utilisée par ce module — son backend de cache par défaut est le système de fichiers local. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Nom de la tâche de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | **Critique** | Passer à `prebuilt` déploie l'image `kimai/kimai2` d'origine sans point d'entrée d'encapsulation — `DATABASE_URL` n'est jamais composée, si bien que l'application ne peut pas du tout atteindre MySQL (Kimai n'a aucun autre moyen de recevoir une chaîne de connexion valide sur Cloud Run). |
| `db_host_env_var_name` | `DB_IP` | Critique | L'encapsulation compose `DATABASE_URL` à partir de cet alias précis. L'effacer, ou le renommer autrement que ce qu'attend `entrypoint.sh`, fait lire un hôte vide à l'encapsulation et l'application ne peut pas se connecter. |
| `container_port` | `8001` | Critique | La variante d'image `:apache` écoute sur 8001, et non 80 — diriger la plateforme vers le mauvais port rend le service inaccessible alors que le conteneur est sain. |
| `db_name` / `db_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les feuilles de temps, tous les projets et toutes les factures. |
| `APP_SECRET` (généré automatiquement) | Ne jamais le modifier à la main dans Secret Manager après le premier démarrage | Élevé | Kimai l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et les sessions actives. |
| Compte administrateur par défaut (nom d'utilisateur toujours `admin`, mot de passe dans le secret `ADMINPASS`) | Récupérez le mot de passe généré dans Secret Manager et connectez-vous rapidement | Élevé | Contrairement à certaines applications du catalogue, le mot de passe administrateur est ici un véritable secret généré par déploiement — et non une valeur par défaut publique bien connue — mais il reste utile de vérifier qui dispose d'un accès en lecture au secret. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `min_instance_count` | `1` en production | Moyen | La mise à l'échelle jusqu'à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_nfs` | `false` sauf besoin pour un autre usage | Faible / coût | Vaut `true` par défaut et provisionne un partage Filestore que Kimai n'utilise jamais — un coût récurrent inutile ; la véritable persistance est le bucket `storage` monté via GCS-FUSE. |
| `enable_cloud_armor` | à activer en production | Moyen | Par défaut, le service est accessible publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Kimai
partagée avec la variante GKE est décrite dans
**[Kimai_Common](Kimai_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kimai sur Cloud Run](../labs/Kimai_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Kimai sur GKE Autopilot](Kimai_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kimai Common — Configuration applicative partagée](Kimai_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) et [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
