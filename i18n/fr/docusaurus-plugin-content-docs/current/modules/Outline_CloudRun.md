---
title: "Outline sur Google Cloud Run"
description: "Référence de configuration pour déployer Outline sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Outline_CloudRun.md @ 3055034 sha256:4400252dab69 -->

# Outline sur Google Cloud Run {#outline-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_CloudRun.png" alt="Outline sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline est une base de connaissances et un wiki d'équipe collaboratif et rapide, dans l'esprit de Notion, avec édition en temps réel, documents markdown riches et recherche puissante — une alternative open source à Confluence et Notion. Ce module déploie Outline sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Outline et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Outline s'exécute sous forme de conteneur Node.js sur Cloud Run v2, construit à partir d'une image personnalisée (`outlinewiki/outline` plus un point d'entrée de la plateforme). Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, facturation à la requête, mise à l'échelle à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — connexion via le socket Unix du Cloud SQL Auth Proxy ; extension `pg_trgm` activée |
| Cache et sessions | Redis | **Requis par Outline** ; activé par défaut, servi depuis l'hôte NFS partagé sauf si `redis_host` est défini |
| Fichiers partagés | Filestore (NFS) | Les pièces jointes téléversées (`FILE_STORAGE=local`) persistent entre les redémarrages et les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Secrets | Secret Manager | `SECRET_KEY`, `UTILS_SECRET` et le mot de passe de la base de données gérés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Outline est une application Sequelize/PostgreSQL ; MySQL n'est pas pris en charge.
- **`DATABASE_URL` et `REDIS_URL` sont assemblées au démarrage du conteneur.** La plateforme injecte les éléments individuels (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME`, `REDIS_HOST`, …) et le point d'entrée personnalisé construit les URL de connexion — ne définissez jamais `DATABASE_URL` vous-même.
- **L'URL du service est injectée sous le nom `URL`.** `service_url_env_var_name` vaut `URL` par défaut, car Outline a besoin de sa propre URL publique pour construire la `redirect_uri` OIDC. Sans elle, Outline n'enregistre **aucun** fournisseur d'authentification.
- **Le fournisseur d'authentification est une étape à la charge de l'opérateur.** Les variables d'environnement `OIDC_*` sont livrées **volontairement vides** — tant que vous n'avez pas configuré un fournisseur d'identité OIDC après le déploiement, la page de connexion est vide et le wiki est inutilisable. Voir le [§3](#3-outline-application-behaviour).
- **Redis est obligatoire, pas facultatif.** `enable_redis` vaut `true` par défaut ; lorsque `redis_host` est vide, le socle fait pointer `REDIS_URL` vers l'hôte NFS partagé, qui héberge aussi Redis.
- **Les téléversements vont sur NFS.** `FILE_STORAGE=local` avec `FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data`, adossé au montage Filestore situé au même chemin (plafond de 25 MiB par téléversement par défaut).
- **`FORCE_HTTPS=false` est défini délibérément.** TLS est terminé en amont par Cloud Run ; la redirection HTTPS par défaut d'Outline casserait les sondes de santé HTTP.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données PostgreSQL et l'utilisateur d'Outline.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`, `max_instance_count = 1`, facturation à la requête (`cpu_always_allocated = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Outline {#a-cloud-run--the-outline-service}

Outline s'exécute en tant que service Cloud Run v2 à l'écoute sur le port 3000, qui se met à l'échelle automatiquement selon la charge de requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs. Un WebSocket d'édition collaborative ouvert compte comme une requête active : le CPU reste donc alloué tant que quelqu'un édite, même avec la facturation à la requête.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Outline stocke toutes les données applicatives (documents, collections, utilisateurs, révisions) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique) ; le point d'entrée assemble automatiquement la `DATABASE_URL` sous forme de socket et l'extension `pg_trgm` est activée pour la recherche. Lors du premier déploiement, un Job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les pièces jointes et images téléversées sont écrites sur un partage **Filestore (NFS)** monté sur `/var/lib/outline/data`, de sorte que toutes les instances partagent les mêmes fichiers et que les téléversements survivent aux redémarrages. Un bucket **Cloud Storage** dédié (suffixe `storage`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Redis {#d-redis}

Outline **nécessite** Redis pour les sessions, la mise en cache et sa file d'attente en arrière-plan — il ne démarre pas sans point de terminaison Redis joignable. Lorsqu'aucun hôte Redis externe n'est configuré, le socle injecte une `REDIS_URL` pointant vers l'hôte NFS partagé, qui héberge aussi Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont gérés automatiquement : le mot de passe de la base de données (créé par le socle) ainsi que `SECRET_KEY` et `UTILS_SECRET` d'Outline — deux valeurs de 64 caractères hexadécimaux (le format `openssl rand -hex 32` exigé en amont) créées par `Outline_Common` et injectées dans le service à l'exécution. Le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. N'oubliez pas que l'`URL` d'Outline doit correspondre à l'hôte que les utilisateurs consultent réellement — si vous placez un domaine personnalisé devant le service, définissez `URL` en conséquence.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Outline {#3-outline-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` (`postgres:15-alpine`) se connecte à Cloud SQL via le socket de l'Auth Proxy et, de manière idempotente, crée la base de données et l'utilisateur d'Outline, accorde les privilèges et attribue le rôle de l'utilisateur à `postgres` afin de pouvoir définir la propriété. Le job s'exécute à chaque apply et peut être réexécuté sans risque.
- **Migrations à chaque démarrage.** Outline n'effectue pas de migration automatique. Le point d'entrée personnalisé attend PostgreSQL (`pg_isready`, jusqu'à ~3 minutes), puis exécute les migrations Sequelize (`sequelize db:migrate --env=production-ssl-disabled`) avant de démarrer le serveur ; les mises à niveau de version appliquent ainsi les modifications de schéma sans étape manuelle.
- **Les URL de connexion sont assemblées, pas configurées.** Le point d'entrée construit `DATABASE_URL` à partir des variables `DB_*` injectées par la plateforme — sous forme de socket (`?host=/cloudsql/…&sslmode=disable`) sur Cloud Run — et `REDIS_URL` à partir de `REDIS_HOST`/`REDIS_PORT`, avec repli sur l'hôte NFS. Ne définissez manuellement aucune de ces deux variables.
- **`URL` est injectée automatiquement.** Le socle injecte l'URL prévue du service sous le nom `URL` (via `service_url_env_var_name = "URL"`). Outline l'utilise pour construire la `redirect_uri` OIDC et tous les liens absolus. Ne la remplacez que si vous servez l'application depuis un domaine personnalisé.
- **L'authentification est une étape OBLIGATOIRE après le déploiement.** Les espaces réservés `OIDC_*` sont livrés vides, et tant qu'ils le restent la page de connexion n'affiche **aucun fournisseur** — le déploiement est sain mais personne ne peut se connecter. Pour utiliser Google comme IdP, par exemple :
  ```bash
  gcloud run services update <service-name> --project "$PROJECT" --region "$REGION" \
    --update-env-vars=OIDC_AUTH_URI=https://accounts.google.com/o/oauth2/v2/auth,\
  OIDC_TOKEN_URI=https://oauth2.googleapis.com/token,\
  OIDC_USERINFO_URI=https://openidconnect.googleapis.com/v1/userinfo,\
  OIDC_USERNAME_CLAIM=email
  ```
  Liez ensuite les identifiants du client sous forme de secrets. **Piège :** `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` sont livrées comme *variables d'environnement simples et vides*, et gcloud refuse de convertir une variable d'environnement en référence de secret en une seule étape (« already set with a different type ») — supprimez-les d'abord, puis mettez à jour :
  ```bash
  gcloud run services update <service-name> --region "$REGION" \
    --remove-env-vars=OIDC_CLIENT_ID,OIDC_CLIENT_SECRET
  gcloud run services update <service-name> --region "$REGION" \
    --update-secrets=OIDC_CLIENT_ID=<client-id-secret>:latest,OIDC_CLIENT_SECRET=<client-secret-secret>:latest
  ```
  Enregistrez `<URL>/auth/oidc.callback` comme URI de redirection autorisée sur le **même hôte** que `URL` — l'URL, le callback enregistré et le navigateur doivent tous s'accorder sur un seul nom d'hôte.
- **Redirection HTTPS désactivée volontairement.** `FORCE_HTTPS=false`, car TLS est terminé par le frontal de Cloud Run ; la redirection 301 vers HTTPS d'Outline enverrait les sondes de santé HTTP vers un port sans écouteur et ferait redémarrer le conteneur en boucle. Les opérateurs qui terminent eux-mêmes TLS peuvent remplacer ce réglage via `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui répond une fois les migrations terminées et Redis connecté. La sonde de démarrage accorde un délai initial de 60 secondes plus six tentatives de 10 secondes.
- **Vérification.** Confirmez que la révision déployée a bien reçu l'`URL` injectée et le câblage de la base de données :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="json(spec.template.spec.containers[0].env)" | grep -E '"URL"|DB_HOST|REDIS'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Outline ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `outline` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Outline` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Outline ; incrémentez-le pour déclencher un nouveau build et une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour Outline. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 2 GiB recommandés en production (recherche plein texte, gestion des ressources). |
| `cpu_always_allocated` | `false` | Facturation à la requête. Un WebSocket d'édition ouvert compte comme une requête active ; ne définissez `true` que si vous comptez sur l'exécution de la file d'attente en arrière-plan d'Outline (notifications par e-mail, indexation des rétroliens) entre les requêtes. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût ; augmentez-le pour une édition simultanée plus intensive. |
| `enable_cloudsql_volume` | `true` | Socket du Cloud SQL Auth Proxy. Obligatoire — la connexion Postgres d'Outline utilise la forme socket. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `timeout_seconds` | `300` | Timeout par requête ; augmentez-le pour les exports volumineux. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (tous / internes / équilibreur de charge uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionnées par-dessus la configuration intégrée d'Outline. C'est ici que vous configurez le fournisseur d'authentification **obligatoire** (`OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`, …) et, éventuellement, remplacez `URL`. Ne définissez **pas** `DATABASE_URL`/`REDIS_URL` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (à utiliser pour `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`). |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. Outline doit connaître son URL publique — définissez `URL` en conséquence. |
| `enable_cdn` / `enable_cloud_armor` / `admin_ip_ranges` | désactivés | Options CDN / WAF. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les fichiers téléversés. Nécessite gen2. |
| `nfs_mount_path` | `/var/lib/outline/data` | Chemin de montage — doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(définies)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `storage` est toujours provisionné automatiquement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Outline nécessite PostgreSQL — ne passez pas à MySQL. |
| `db_name` | `outline` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `outline` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `service_url_env_var_name` | `URL` | Injecte l'URL prévue du service sous le nom `URL`. **Ne la videz pas** — sans `URL`, Outline n'enregistre aucun fournisseur d'authentification. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s, 6 échecs | Laisse le temps aux migrations du premier démarrage et à la connexion Redis. |
| `liveness_probe` | HTTP `/`, délai initial de 60s, période de 30s | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — Outline ne fonctionne pas sans Redis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'hôte NFS partagé (qui héberge aussi Redis). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variables d'environnement `OIDC_*` | configurées après le déploiement | Critique | Livrées volontairement vides — tant qu'aucun IdP n'est configuré, la page de connexion n'affiche **aucun fournisseur** et le wiki est inutilisable, même si le déploiement est sain. |
| `service_url_env_var_name` | `URL` | Critique | La vider supprime l'`URL` injectée ; Outline ne peut pas construire la `redirect_uri` OIDC et n'enregistre aucun fournisseur d'authentification. |
| `database_type` | `POSTGRES_15` | Critique | Outline nécessite PostgreSQL ; MySQL fait échouer le démarrage. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les documents. |
| `enable_redis` | `true` | Critique | Outline nécessite Redis pour les sessions et sa file d'attente ; sans lui, le conteneur ne devient jamais sain. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les pièces jointes téléversées sont perdues entre les instances/redémarrages. |
| `enable_cloudsql_volume` | `true` | Critique | La connexion Postgres du point d'entrée utilise le socket de l'Auth Proxy ; une connexion TCP directe par IP privée est rejetée par Cloud SQL sans configuration SSL. |
| `DATABASE_URL` / `REDIS_URL` dans `environment_variables` | ne jamais les définir | Élevé | Le point d'entrée assemble correctement les deux pour chaque plateforme ; une valeur définie à la main la remplace avec une forme d'hôte incorrecte. |
| `FORCE_HTTPS` | `false` (valeur par défaut du module) | Élevé | Le réactiver amène Outline à rediriger en 301 les sondes de santé HTTP → échec de la sonde → redémarrages en boucle. TLS est déjà terminé par Cloud Run. |
| Liaison des secrets OIDC | supprimer puis mettre à jour | Élevé | `OIDC_CLIENT_ID`/`SECRET` sont des variables d'environnement simples et vides ; un `--update-secrets` unique échoue avec « already set with a different type » — appliquez-leur d'abord `--remove-env-vars`. |
| URI de redirection OIDC | `<URL>/auth/oidc.callback` sur le même hôte que `URL` | Élevé | Une différence d'hôte entre `URL`, le callback enregistré et le navigateur rompt l'aller-retour OAuth. |
| `nfs_mount_path` | `/var/lib/outline/data` | Élevé | Doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR`, sinon les téléversements atterrissent sur un disque éphémère et disparaissent. |
| `startup_probe` initial_delay_seconds | `60` | Élevé | Le réduire tue Outline avant la fin des migrations Sequelize du premier démarrage. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `memory_limit` | `1Gi`+ (`2Gi` en prod) | Moyen | Une mémoire trop faible provoque des OOM de Node.js pendant l'indexation de la recherche ou les exports volumineux. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Moyen | `0` ajoute un démarrage à froid (avec vérification des migrations) à la première requête après une période d'inactivité. |
| `backup_retention_days` | `7` (augmenter en prod) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle auquel ce guide fait référence — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Outline partagée avec la variante GKE est décrite dans **[Outline_Common](Outline_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Outline sur Cloud Run](../labs/Outline_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Outline sur GKE Autopilot](Outline_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Outline Common — Configuration applicative partagée](Outline_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Stirling-PDF sur Google Cloud Run](StirlingPDF_CloudRun.md) dans la solution **Knowledge Base & Documentation**.
