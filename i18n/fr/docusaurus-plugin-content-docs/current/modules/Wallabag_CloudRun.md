---
title: "Wallabag sur Google Cloud Run"
description: "Référence de configuration pour déployer Wallabag sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wallabag_CloudRun.md @ 3055034 sha256:855e2094c4af -->

# Wallabag sur Google Cloud Run {#wallabag-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_CloudRun.png" alt="Wallabag sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag est une application gratuite, open source et auto-hébergée d'archivage d'articles
à « lire plus tard » — une alternative à Pocket. Enregistrez des articles depuis une extension de navigateur, un bookmarklet,
une application mobile ou l'API REST, puis lisez-les plus tard dans une vue épurée et sans distraction,
avec recherche plein texte, étiquettes, annotations et flux RSS de vos éléments
enregistrés. Ce module déploie Wallabag sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Wallabag et sur la manière de les explorer et
de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallabag s'exécute sous la forme d'un conteneur PHP/Symfony (nginx + php-fpm sous s6-overlay) sur
Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Symfony, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à zéro par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Wallabag_Common fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Wallabag ne le lit ni ne l'écrit — tout le contenu réside dans MySQL |
| Secrets | Secret Manager | `APP_SECRET` généré automatiquement (jeton de sécurité Symfony) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par `Wallabag_Common` ;
  choisir un autre moteur fait échouer le déploiement.
- **`enable_cloudsql_volume = false`.** Cloud Run se connecte à Cloud SQL en
  **TCP via l'IP privée**, et non via le socket Unix de l'Auth Proxy. La variante GKE
  utilise au contraire le sidecar Auth Proxy sur `127.0.0.1`.
- **Un seul secret Secret Manager.** `APP_SECRET` (un jeton de sécurité Symfony) est
  généré automatiquement et remplace la valeur par défaut intégrée de Wallabag, connue publiquement.
  Il n'existe pas de secret distinct pour un mot de passe administrateur généré.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première requête après
  une période d'inactivité ; définissez `min_instance_count = 1` pour l'éviter.
- **`enable_nfs` vaut `true` par défaut mais n'a aucune utilité fonctionnelle.** Il monte le NFS Cloud
  Filestore dans `/var/lib/wallabag`, mais le `WORKDIR` de l'image de Wallabag est
  `/var/www/wallabag` — rien n'écrit dans le chemin monté. Vous pouvez le désactiver sans risque.
- **Pas de job de migration distinct.** La commande `bin/console wallabag:install` de Wallabag
  gère à la fois la création du schéma et la configuration initiale en une seule étape idempotente.
- **L'auto-inscription est désactivée.** `SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`
  — seul le compte administrateur initial existe jusqu'à ce qu'un opérateur
  active explicitement l'inscription ou crée d'autres comptes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Wallabag {#a-cloud-run--the-wallabag-service}

Wallabag s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre
le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Wallabag stocke toutes les données de l'application (articles enregistrés, étiquettes, utilisateurs, annotations)
dans une instance gérée Cloud SQL for MySQL 8.0. Le service se connecte via
l'**IP privée de l'instance en TCP** (et non via le socket de l'Auth Proxy — `enable_cloudsql_volume`
de Cloud Run vaut `false` par défaut pour ce module). Lors du premier déploiement, un
job `db-init` crée la base de données et l'utilisateur de l'application, suivi de
`wallabag-install`, qui exécute le programme d'installation de Wallabag pour créer le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et le renouvellement du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée `storage_buckets`
du socle), mais Wallabag lui-même ne le lit ni ne l'écrit jamais — tout
le contenu réside dans MySQL, et `gcs_volumes` (qui monterait un bucket via Fuse dans
le conteneur) est vide par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager : `APP_SECRET`
(matérialisé sous cette clé simple ; associé au véritable nom `SYMFONY__ENV__SECRET`
par le point d'entrée d'enveloppe). Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de renouvellement.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wallabag {#3-wallabag-application-behaviour}

- **Chaîne d'initialisation en deux étapes, et non une étape de migration séparée à la Laravel.**
  `db-init` (`mysql:8.0-debian`) crée la base de données vide et l'utilisateur de l'application
  et accorde les privilèges. `wallabag-install` dépend ensuite de `db-init` et réutilise
  la même image applicative personnalisée (afin que l'association des variables d'environnement par le point d'entrée d'enveloppe s'exécute toujours)
  avec sa commande remplacée par `bin/console wallabag:install --env=prod -n`.
  Cette commande unique effectue à la fois la création du schéma *et* la configuration initiale
  (y compris la création du compte administrateur par défaut) — il n'y a pas de job de migration
  distinct à exécuter lors des mises à niveau ; relancer `wallabag:install` sur une
  base de données déjà installée est sûr et idempotent.
- **Comportement des contrôles de santé.** La sonde de démarrage est en **TCP** sur le port 80 — elle n'a
  besoin que de la liaison de nginx, indépendamment de l'avancement du programme d'installation. La sonde de vivacité est
  en **HTTP `GET /`** : une requête non authentifiée vers le chemin racine renvoie une
  **redirection HTTP 302 vers `/login`**, que les sémantiques de contrôle de santé de Cloud Run comme de Kubernetes
  considèrent comme une réponse valide (tout code 2xx–3xx). N'attendez pas
  un simple 200 sur `/` — une redirection 302 vers `/login` est le résultat attendu et sain.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **Compte administrateur initial.** `wallabag:install --env=prod -n` crée
  le compte administrateur par défaut de Wallabag à l'aide des valeurs d'installation par défaut
  documentées de Wallabag (nom d'utilisateur et mot de passe tous deux `wallabag`) — aucun
  secret Secret Manager ne contient de mot de passe administrateur généré. **Modifiez ce
  mot de passe immédiatement après la première connexion** (Settings → votre compte → modification du
  mot de passe, ou `bin/console fos:user:change-password wallabag` dans le
  conteneur). Les nouveaux comptes ne peuvent pas s'inscrire eux-mêmes (`SYMFONY__ENV__FOSUSER_REGISTRATION
  = "false"`) — créez des utilisateurs supplémentaires depuis l'interface d'administration ou avec `bin/console
  fos:user:create`.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Wallabag ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallabag` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Wallabag` | Nom lisible affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image de base `wallabag/wallabag`. `"latest"` correspond à un tag épinglé (`2.6.14`) au moment du build, via l'ARG de build propre à l'application `WALLABAG_VERSION`. |
| `php_memory_limit`, `upload_max_filesize`, `post_max_size` | `512M` / `64M` / `64M` | Déclarées par souci de cohérence avec la convention mais **transmises nulle part** — les définir n'a aucun effet sur le conteneur déployé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image d'enveloppe via Cloud Build. `"prebuilt"` contourne entièrement l'enveloppe d'association base de données/secrets — ne l'utilisez pas sans votre propre transposition. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `80` | Le nginx de Wallabag écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte en TCP via l'IP privée au lieu du socket de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne remplacez pas `SYMFONY__ENV__DATABASE_*` ici — elles sont calculées par le point d'entrée d'enveloppe au démarrage du conteneur. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de renouvellement de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS générique `data`. Ni lu ni écrit par Wallabag. |
| `enable_nfs` | `false` | **Sans utilité fonctionnelle** — monté dans `/var/lib/wallabag`, mais l'image de Wallabag n'y écrit rien. Vous pouvez le désactiver sans risque. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). Vide par défaut — rien n'est monté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Wallabag_Common`. |
| `db_name` / `db_user` | `wallabag` | Préfixés par le tenant au moment du déploiement. Immuables après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (toutes vides) | **Inutilisées par Wallabag** — le point d'entrée d'enveloppe lit directement les variables standard `DB_*` et les associe lui-même à `SYMFONY__ENV__DATABASE_*`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `wallabag-install`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 80, délai de 30s, 20 tentatives | N'a besoin que de la liaison de nginx. |
| `liveness_probe` | HTTP `GET /`, délai de 300s, 3 tentatives | Wallabag renvoie une redirection 302 vers `/login` — une réponse valide. |
| `uptime_check_config` | `{ enabled = true }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Entièrement facultatif — utilisé uniquement par la fonction d'import en masse asynchrone de Wallabag (import Pocket/Instapaper). L'enregistrement, la lecture et l'utilisation de l'API normaux ne sollicitent jamais Redis. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `wallabag-install`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement du pilote de base de données (`SYMFONY__ENV__DATABASE_DRIVER`, codée en dur dans `entrypoint.sh`) | doit être définie explicitement (`pdo_mysql` ici) | **Critical** | Le `parameters.yml` livré avec Wallabag fixe `database_driver` à `pdo_sqlite` par défaut. Définir uniquement `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` sans variable de pilote explicite installe quand même silencieusement l'application sur un fichier SQLite local jetable — l'installation « réussit », l'application semble fonctionner, mais toutes les données résident dans un fichier éphémère effacé à chaque redémarrage ou redéploiement, et MySQL n'est jamais sollicité. Aucune erreur n'est levée. **Si ce module est un jour cloné comme modèle pour une autre application basée sur Symfony, vérifiez que la variable d'environnement du pilote de base de données est définie explicitement** — cette catégorie de défaillance est indétectable de l'extérieur ; seule la comparaison des journaux de démarrage du conteneur (`"Configuring the SQLite database..."` par rapport à une ligne de connexion MySQL) la révèle. Consultez [App_CloudRun](App_CloudRun.md) et [App_GKE](App_GKE.md) pour savoir comment le socle injecte de manière générique les variables d'environnement de la base de données — la transposition propre à l'application et les éléments manquants relèvent toujours de la responsabilité du module appelant. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les articles enregistrés. |
| `APP_SECRET` (généré automatiquement) | Ne jamais le modifier à la main dans Secret Manager après le premier démarrage | High | Wallabag l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et toutes les URL signées déjà émises. |
| Identifiants administrateur par défaut (`wallabag` / `wallabag`, créés par `wallabag:install`) | À modifier immédiatement après la première connexion | High | Le programme d'installation crée les identifiants par défaut bien connus de Wallabag — toute personne connaissant l'URL du service et la valeur par défaut publique peut se connecter tant que le mot de passe n'a pas été modifié. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `container_image_source` | `custom` | Critical | Passer à `prebuilt` déploie l'image `wallabag/wallabag` standard sans point d'entrée d'enveloppe — l'association des variables d'environnement de base de données et de secrets ne s'exécute jamais, et l'application ne peut pas du tout atteindre MySQL. |
| `min_instance_count` | `1` en production | Medium | La mise à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_nfs` | `false` sauf besoin pour un autre usage | Low / coût | Vaut `true` par défaut et provisionne un partage Filestore que Wallabag n'utilise jamais — un coût récurrent inutile. |
| `enable_cloud_armor` | à activer en production | Medium | Le service est accessible publiquement sans protection WAF par défaut. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Wallabag
partagée avec la variante GKE est décrite dans
**[Wallabag_Common](Wallabag_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallabag sur Cloud Run](../labs/Wallabag_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Wallabag sur GKE Autopilot](Wallabag_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallabag Common — Configuration applicative partagée](Wallabag_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md), [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Personal Knowledge & Reading**.
