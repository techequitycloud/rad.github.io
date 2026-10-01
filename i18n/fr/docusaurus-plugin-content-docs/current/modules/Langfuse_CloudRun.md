---
title: "Langfuse sur Google Cloud Run"
description: "Référence de configuration pour déployer Langfuse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Langfuse_CloudRun.md @ 3055034 sha256:e1da7286dd33 -->

# Langfuse sur Google Cloud Run {#langfuse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_CloudRun.png" alt="Langfuse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse est une plateforme open source d'ingénierie et d'observabilité des LLM, sous
licence MIT — traçage, gestion des prompts, évaluations et métriques pour les
applications reposant sur de grands modèles de langage. Ce module déploie Langfuse
sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Langfuse et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Langfuse s'exécute dans un conteneur Next.js sur Cloud Run v2. Ce module déploie la
**branche v2** (Postgres uniquement) ; Langfuse v3 requiert en plus ClickHouse, Redis
et S3, et sort du périmètre de ce module. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique serverless |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Langfuse v2 ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket dédié provisionné automatiquement ; partage NFS facultatif pour les exports |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `SALT` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Langfuse v2 (Postgres uniquement) est épinglé.** L'image est construite
  `FROM langfuse/langfuse:2` via l'ARG de build `LANGFUSE_VERSION`. Même
  `application_version = "latest"` se résout en `2`. Déployer la v3 nécessiterait
  ClickHouse + Redis + S3, que ce module ne provisionne pas.
- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **`NEXTAUTH_SECRET` et `SALT` sont générés automatiquement** et stockés dans Secret
  Manager. La validation des variables d'environnement par zod de Langfuse refuse de
  démarrer sans les deux — `NEXTAUTH_SECRET` signe les JWT de session et `SALT` hache
  les clés d'API. Leur rotation invalide les sessions / les clés d'API stockées.
- **Les migrations Prisma s'exécutent à chaque démarrage.** Le point d'entrée cloud
  compose `DATABASE_URL` à partir des variables `DB_*` injectées, puis passe la main
  au démarrage propre de Langfuse, qui exécute `prisma migrate deploy`. Le job
  `db-init` ne crée que le rôle et la base de données.
- **Le premier utilisateur à s'inscrire devient le propriétaire.**
  `AUTH_DISABLE_SIGNUP = "false"` est injecté ; il n'existe aucun identifiant
  administrateur prédéfini. Désactivez l'inscription après la prise en main.
- **`min_instance_count = 1` avec `cpu_always_allocated = true`.** Une instance reste
  active afin que le traitement en arrière-plan de Langfuse (ingestion par lots,
  travaux planifiés) continue entre les requêtes ; le CPU n'est pas ramené à zéro au
  repos.
- **L'entrée publique est la valeur par défaut.** `ingress_settings = "all"`, afin
  que l'interface et les points de terminaison d'ingestion/API soient joignables par
  les clients SDK de votre application LLM. Activer IAP bloquera le trafic SDK non
  authentifié.
- **Pas de Redis.** Langfuse v2 utilise une file d'attente et un cache adossés à
  PostgreSQL ; `enable_redis` reste à `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Langfuse {#a-cloud-run--the-langfuse-service}

Langfuse s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Langfuse stocke toutes les données applicatives (traces, observations, scores,
prompts, utilisateurs, projets, clés d'API) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de façon privée via le **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Au premier
déploiement, un job d'initialisation crée le rôle applicatif et la base de
données ; Langfuse applique ensuite son schéma via `prisma migrate deploy` au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement. Langfuse v2
conserve toutes les données de traces et d'observabilité dans PostgreSQL ; le bucket
(et le partage NFS monté en option) servent aux exports et aux médias plutôt qu'à
l'état principal.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `NEXTAUTH_SECRET` (signe les JWT de session d'authentification) et `SALT`
(hache les clés d'API). Tous deux sont injectés comme variables d'environnement
secrètes et sont requis au démarrage. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, ce qui offre l'accès public
dont les clients SDK de votre application LLM ont besoin pour envoyer (POST) des
traces à l'API d'ingestion. Un équilibreur de charge HTTPS externe avec domaine
personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus ; les paramètres
d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Langfuse {#3-langfuse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` à l'aide de `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle
  applicatif et la base de données, puis accorde les privilèges. Il ne crée **pas**
  les tables — le job peut être relancé sans risque.
- **Migrations Prisma au démarrage.** Le point d'entrée cloud compose `DATABASE_URL`,
  puis délègue au démarrage propre de Langfuse, qui exécute `prisma migrate deploy`
  avant de lancer le serveur. Mettre à niveau la version de l'application applique
  donc les modifications de schéma sans étape de migration distincte — prévoyez un
  délai supplémentaire au premier démarrage après une mise à niveau.
- **`NEXTAUTH_SECRET` et `SALT` sont immuables après le premier démarrage.** Ils sont
  générés une seule fois et écrits dans Secret Manager. Modifier `NEXTAUTH_SECRET`
  invalide toutes les sessions actives ; modifier `SALT` invalide définitivement toutes
  les clés d'API existantes (les clients SDK reçoivent alors `401`). Ne procédez à une
  rotation que pendant une fenêtre de maintenance planifiée.
- **Le premier utilisateur est le propriétaire.** Lors de la première visite, la page
  d'inscription de Langfuse crée le compte initial, qui devient le propriétaire de
  l'instance (aucun identifiant prédéfini). Après la prise en main, définissez
  `AUTH_DISABLE_SIGNUP = "true"` dans `environment_variables` et appliquez-le via
  **Update** (mise à jour) pour empêcher toute nouvelle inscription en libre-service.
- **Points de terminaison d'ingestion.** La valeur par défaut
  `ingress_settings = "all"` permet aux clients SDK de votre application LLM d'envoyer
  (POST) des traces à l'API d'ingestion publique. Activer IAP bloque ces appels non
  authentifiés — laissez IAP désactivé si les SDK doivent atteindre le service, ou
  autorisez explicitement les appelants.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut
  dans `variables.tf` — et non le point de terminaison dédié `/api/public/health` de
  l'application, qui n'est pas câblé comme valeur par défaut. Prévoyez une fenêtre
  généreuse au premier démarrage (la sonde de démarrage utilise un seuil d'échec élevé
  et un délai initial de 60 s) afin que les migrations Prisma se terminent ; envisagez
  de remplacer `path` par `/api/public/health` pour un signal de disponibilité plus
  précis.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Langfuse ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

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
| `application_name` | `langfuse` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Langfuse Helpdesk` | Nom lisible affiché dans la console. Texte résiduel hérité d'un clonage dans `variables.tf` (Langfuse est une plateforme d'observabilité des LLM, et non un helpdesk) — remplacez-le, par exemple par `"Langfuse"`, pour obtenir un nom d'affichage exact. |
| `description` | `Langfuse - Open-source helpdesk and customer support platform` | Description du service. Même résidu de clonage que `display_name` — remplacez-la pour obtenir une description exacte. |
| `application_version` | `2` | Tag de l'image Langfuse. Épinglé sur la branche v2 (Postgres uniquement). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Langfuse construit une image d'encapsulation légère à partir de `langfuse/langfuse:2`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 2 GiB minimum. |
| `cpu_always_allocated` | `true` | Garde le CPU alloué afin que le traitement en arrière-plan s'exécute entre les requêtes. |
| `min_instance_count` | `1` | Garde une instance active pour le traitement en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de la mise à l'échelle automatique. |
| `container_port` | `3000` | Langfuse (Next.js) écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Langfuse dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les points de terminaison publics d'ingestion des SDK. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque l'ingestion SDK non authentifiée.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas ici `NEXTAUTH_SECRET`, `SALT` ni `DATABASE_URL` — ils sont gérés par le module. Définissez ici `AUTH_DISABLE_SIGNUP = "true"` après la prise en main. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention des images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner. |
| `enable_nfs` | `true` | Monte un partage NFS sur `/opt/langfuse/storage` pour les exports/médias facultatifs. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Langfuse requiert PostgreSQL. |
| `db_name` | `langfuse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `langfuse` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs planifiés Cloud Scheduler + Cloud Run Jobs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, seuil d'échec élevé | Sonde de démarrage. Prévoyez un délai généreux pour les migrations Prisma du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 utilise une file d'attente et un cache adossés à PostgreSQL — laissez `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisés uniquement en cas d'externalisation vers Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives, obligeant chacun à se reconnecter immédiatement. |
| `SALT` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Sa rotation invalide définitivement toutes les clés d'API existantes — chaque client SDK qui les utilise reçoit `401` jusqu'à l'attribution de nouvelles clés. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base et l'utilisateur et détruit toutes les données de traces. |
| `application_version` | `2` (branche v2) | Critique | Indiquer un tag v3 fait pointer le build vers une image nécessitant ClickHouse + Redis + S3, que ce module ne provisionne pas — le service ne démarre pas. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans sauvegarde valide fait échouer le job d'importation. |
| `memory_limit` | `4Gi` (≥ 2Gi) | Élevé | En dessous de 2 GiB, le serveur Next.js de Langfuse est tué (OOM) pendant les migrations du premier démarrage ou sous la charge d'ingestion. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque tous les appels d'ingestion SDK externes. |
| `enable_iap` | uniquement lorsque l'ingestion SDK n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion des traces par les SDK. |
| `AUTH_DISABLE_SIGNUP` (injecté automatiquement à `"false"`) | Désactiver après le premier propriétaire | Élevé | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `min_instance_count` | `1` | Moyen | La mise à zéro (`0`) arrête le traitement en arrière-plan et ajoute la latence du démarrage à froid à la première requête après une période d'inactivité. |
| `cpu_always_allocated` | `true` | Moyen | La facturation à la requête réduit le traitement en arrière-plan à ~0 CPU entre les requêtes. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface et les points de terminaison d'ingestion sont joignables publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Langfuse partagée avec la variante GKE est décrite dans
**[Langfuse_Common](Langfuse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Langfuse sur Cloud Run](../labs/Langfuse_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Langfuse sur GKE Autopilot](Langfuse_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Langfuse Common — Configuration applicative partagée](Langfuse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) et [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Private AI Assistant**.
