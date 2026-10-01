---
title: "Coder sur Google Cloud Run"
description: "Référence de configuration pour déployer Coder sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Coder_CloudRun.md @ 3055034 sha256:2b89d0beeb4b -->

# Coder sur Google Cloud Run {#coder-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_CloudRun.png" alt="Coder sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open source auto-hébergée qui provisionne des environnements de développement distants (espaces de travail) définis sous forme de code avec Terraform — les développeurs disposent d'environnements cohérents et prêts à l'emploi, tandis que les équipes plateforme conservent le code source et les dépendances sur leur propre infrastructure. Ce module déploie le plan de contrôle Coder sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Coder et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Coder s'exécute sous forme d'un binaire Go unique (`coder server`) dans un conteneur sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service de plan de contrôle Go, 2 vCPU / 4 GiB par défaut, CPU toujours allouée |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Coder exige PostgreSQL 13+ ; MySQL est rejeté au moment du plan |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (à la disposition de l'opérateur) |
| Build d'image | Cloud Build + Artifact Registry | Fine surcouche personnalisée construite FROM `ghcr.io/coder/coder` |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement — Coder n'a besoin d'aucun secret applicatif propre |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Coder exige PostgreSQL 13+ ; une validation au moment du plan rejette les moteurs MySQL.
- **Le plan de contrôle est sans état.** Tout l'état — modèles, espaces de travail, utilisateurs, sessions, file d'attente des builds et clés de signature auto-générées par Coder — réside dans PostgreSQL. Pas de NFS, pas de Redis, pas de secret applicatif géré par Common.
- **`cpu_always_allocated = true` et `min_instance_count = 1`.** `coder server` exécute dans son processus des démons de provisionnement intégrés qui interrogent en continu la base de données pour détecter les builds d'espaces de travail en attente et terminent les connexions des agents d'espace de travail — ce travail en arrière-plan se bloque avec la limitation de CPU basée sur les requêtes ou la mise à l'échelle à zéro.
- **L'URL de connexion est assemblée à l'exécution.** Le point d'entrée personnalisé construit `CODER_PG_CONNECTION_URL` (une URL `postgres://` avec un mot de passe encodé pour URL) à partir des variables `DB_*` injectées par le socle, en privilégiant le chemin TCP par IP privée avec `sslmode=require` sur Cloud Run.
- **`CODER_ACCESS_URL` est défini automatiquement** à partir de l'URL du service Cloud Run injectée, de sorte que les URL de connexion des espaces de travail et des agents ainsi que les URI de redirection OAuth sont correctes d'emblée.
- **Une tâche `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et le rôle Coder ; Coder exécute ses propres migrations de schéma au démarrage du serveur.
- **Les sondes de santé ciblent `/healthz`** (non authentifié) avec un délai initial de 60 secondes pour la migration de schéma du premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.
- **`application_version = "latest"` correspond à un tag épinglé** (`v2.24.1`) via l'ARG de build propre à l'application `CODER_VERSION` — les tags GHCR de Coder sont préfixés selon semver.

> Ce module déploie le **plan de contrôle** de Coder. Provisionner de véritables espaces de travail nécessite en outre un provisionneur configuré et une cible de calcul (par exemple un cluster Kubernetes ou un modèle de VM cloud), mis en place après le déploiement via le système de modèles de Coder.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Coder {#a-cloud-run--the-coder-service}

Coder s'exécute comme un service Cloud Run v2 avec une CPU toujours allouée et une instance minimale maintenue active, de sorte que les démons de provisionnement intégrés continuent d'interroger les builds d'espaces de travail même en l'absence de requêtes entrantes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — utilisateurs, organisations, modèles, état des espaces de travail, file d'attente des tâches de provisionnement et ses clés de signature — dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte par IP privée avec `sslmode=require` (le DSN sous forme d'URL de Coder ne peut pas contenir le chemin du socket Unix) ; le Job `db-init` crée la base de données et le rôle de l'application au premier déploiement.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement. Coder n'en a pas besoin pour le fonctionnement du plan de contrôle — celui-ci ne conserve aucun fichier sur disque — mais il reste disponible pour les ressources des modèles ou l'usage de l'opérateur.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

### D. Cloud Build et Artifact Registry {#d-cloud-build--artifact-registry}

`container_image_source = "custom"` déclenche un Cloud Build qui encapsule `ghcr.io/coder/coder:<version>` avec le point d'entrée cloud et pousse le résultat vers Artifact Registry (l'image de base est d'abord mise en miroir, `enable_image_mirroring = true`).

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --limit 5
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est le seul secret du déploiement — stocké dans Secret Manager et injecté à l'exécution sous la forme `DB_PASSWORD`, puis encodé pour URL dans l'URL de connexion par le point d'entrée. Coder génère lui-même ses clés de signature et les conserve dans PostgreSQL ; il n'existe donc aucun secret de session ou applicatif à gérer.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` ; le point d'entrée exporte cette URL sous la forme `CODER_ACCESS_URL`, à partir de laquelle Coder construit les URL de connexion des espaces de travail et des agents. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur (structurés, vers STDOUT) sont envoyés à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` (`postgres:15-alpine`) se connecte en tant que super-utilisateur `postgres` et, de manière idempotente, crée le rôle Coder (`LOGIN CREATEDB`), crée la base de données, accorde tous les privilèges et réattribue la propriété du schéma `public` au rôle de l'application (les migrations de Coder y créent tous les objets). La tâche s'exécute à chaque apply et peut être relancée sans risque.
- **Les migrations s'exécutent au démarrage.** Coder applique ses propres migrations de schéma à chaque démarrage de `coder server` — les mises à niveau de version ne nécessitent aucune étape de migration manuelle. Le premier démarrage sur une base de données vierge prend plus de temps ; la sonde de démarrage accorde jusqu'à ~8 minutes avant d'abandonner.
- **Assemblage du DSN à l'exécution.** Le point d'entrée cloud construit `CODER_PG_CONNECTION_URL` à partir de `DB_HOST`/`DB_IP`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` : sur Cloud Run, il privilégie l'IP privée avec `sslmode=require` (le chemin du socket Cloud SQL ne peut pas figurer dans la partie autorité d'une URL) ; le mot de passe est encodé en pourcentage afin que les caractères spéciaux ne cassent jamais l'URL. Un `CODER_PG_CONNECTION_URL` fourni explicitement a la priorité.
- **URL d'accès.** `CODER_ACCESS_URL` est défini à partir de `CLOUDRUN_SERVICE_URL` injecté. Coder en dérive les URL de connexion des espaces de travail et des agents ainsi que les URI de redirection OAuth — si vous placez un domaine personnalisé devant le service, définissez `CODER_ACCESS_URL` sur ce domaine dans `environment_variables`.
- **Aucun secret applicatif.** Coder génère ses clés de signature et les conserve dans PostgreSQL. La recréation des conteneurs, la mise à l'échelle et les redéploiements sont sans risque ; rien ne se désynchronise.
- **Configuration initiale.** La première visite de l'URL du service vous invite à créer le compte administrateur initial (propriétaire) — faites-le rapidement, car le point de terminaison reste accessible publiquement jusque-là (`ingress_settings = "all"` par défaut).
- **Le provisionnement des espaces de travail est une étape post-déploiement.** Le plan de contrôle seul n'exécute aucun espace de travail. Créez un modèle (Terraform) pointant vers une cible de calcul — par exemple un cluster GKE ou des VM GCE — et assurez-vous que le provisionneur dispose d'identifiants pour celle-ci.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/healthz`, que Coder sert sans authentification avec un HTTP 200 dès que le serveur est opérationnel.

Vérification :

```bash
SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"     # expect 200
curl -s "$SERVICE_URL/api/v2/buildinfo"                             # Coder version info
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Coder ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Coder` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de version de Coder ; `latest` correspond au tag épinglé `v2.24.1` via l'ARG de build `CODER_VERSION`. Incrémentez-le pour déclencher un nouveau build d'image et une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Coder exige au moins 2Gi pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Conservez ≥ 1 — les démons de provisionnement intégrés doivent rester actifs pour prendre en charge les builds d'espaces de travail. |
| `max_instance_count` | `5` | Plafond de coût. |
| `cpu_always_allocated` | `true` | Facturation à l'instance. Conservez `true` — l'interrogation par le provisionneur et les connexions des agents se bloquent avec la limitation basée sur les requêtes. Ne définissez `false` que pour une évaluation limitée à l'interface. |
| `container_port` | `3000` | Port HTTP de Coder (`CODER_HTTP_ADDRESS = 0.0.0.0:3000`). |
| `container_image_source` | `custom` | Obligatoire — l'image en amont ne contient pas le point d'entrée qui assemble l'URL de connexion à la base de données et l'URL d'accès. |
| `enable_cloudsql_volume` | `true` | Side-car Cloud SQL Auth Proxy ; le point d'entrée se connecte néanmoins en TCP par IP privée, car le DSN sous forme d'URL de Coder ne peut pas contenir le chemin du socket. |
| `enable_image_mirroring` | `true` | L'image de base GHCR est mise en miroir dans Artifact Registry avant le build. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Coder doit être accessible aux développeurs et aux agents d'espace de travail ; restreignez l'accès avec IAP ou Cloud Armor plutôt qu'avec une entrée interne uniquement. |
| `enable_iap` | `false` | Exiger une connexion Google en amont de l'authentification propre à Coder. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration `CODER_*` supplémentaire (par exemple `CODER_OIDC_*` pour le SSO, `CODER_ACCESS_URL` pour un domaine personnalisé). `CODER_HTTP_ADDRESS`, `CODER_TELEMETRY_ENABLE=false` et `CODER_VERBOSE=false` sont prédéfinis par `Coder_Common`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple un secret client OIDC). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7–10 — Sauvegarde, CI/CD, SQL personnalisé, LB et CDN {#groups-710--backup-cicd-custom-sql-lb--cdn}

Comportement standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées principales : `backup_schedule`, `enable_backup_import`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_cloud_armor`, `application_domains`, `enable_cdn`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — le plan de contrôle est sans état ; tout l'état réside dans PostgreSQL. |
| `nfs_mount_path` | `/home/coder/data` | Uniquement lorsque `enable_nfs=true`. Doit être un véritable répertoire — jamais un sous-chemin de `/opt/coder`, qui est le **binaire** coder (un fichier) ; un montage par-dessus empêche le démarrage du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder exige PostgreSQL 13+ — MySQL est rejeté par une validation au moment du plan. |
| `db_name` | `coder` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `coder` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64) ; les caractères spéciaux ne posent pas de problème — le point d'entrée encode le mot de passe pour URL. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, délai initial de 60s, 30 échecs | Seuil généreux (~8 min) pour la migration de schéma du premier démarrage sur une instance Cloud SQL vierge. |
| `liveness_probe` | HTTP `/healthz`, délai initial de 60s | Sonde de vivacité sur le point de terminaison de santé non authentifié de Coder. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring ; pointez-le vers `/healthz` lorsque vous l'activez. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis / Groupe 22 — VPC-SC {#group-21--redis--group-22--vpc-sc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente des builds résident dans PostgreSQL. |
| `enable_vpc_sc` | `false` | Application standard du périmètre — consultez [App_CloudRun](App_CloudRun.md). |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (URL d'accès de Coder). |
| `service_location` | Région dans laquelle s'exécute le service. |
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
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Les validations au moment du plan dans `validation.tf` détectent tôt les pires combinaisons : ordre entre minimum et maximum d'instances, Redis sans hôte, moteurs autres que PostgreSQL, et side-car de proxy Cloud SQL avec `database_type = "NONE"`.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Coder exige PostgreSQL 13+ ; MySQL est rejeté au moment du plan. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les modèles, espaces de travail, utilisateurs et clés de signature. |
| `container_image_source` | `custom` | Critique | L'image en amont ne peut pas assembler `CODER_PG_CONNECTION_URL` à partir des variables `DB_*` du socle — le serveur ne se connecte jamais à PostgreSQL. |
| `container_port` | `3000` | Critique | Doit correspondre à `CODER_HTTP_ADDRESS = 0.0.0.0:3000` ; une incohérence fait échouer toutes les sondes de santé. |
| `cpu_always_allocated` | `true` | Élevé | Avec la facturation à la requête, les démons de provisionnement intégrés sont limités à ~0 entre les requêtes — les builds d'espaces de travail se bloquent sans aucun message. |
| `min_instance_count` | `1` | Élevé | À `0`, le plan de contrôle est mis à l'échelle à zéro et aucun provisionneur n'interroge — les builds d'espaces de travail en file d'attente attendent qu'une requête entrante réveille une instance. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | Élevé | En dessous de 2Gi, le serveur Go risque un OOM lors des pics de builds d'espaces de travail et des importations de modèles. |
| `application_version` | tag épinglé (par ex. `v2.24.1`) | Élevé | Les tags GHCR de Coder sont préfixés selon semver (`vX.Y.Z`) ; `latest` est associé à un tag épinglé par le module — ne le remplacez que par un tag réel. |
| `startup_probe` chemin / délai | `/healthz`, 60s | Élevé | Pointer les sondes vers un chemin authentifié renvoie 401/403 et la révision ne devient jamais prête ; réduire le seuil interrompt les premiers démarrages en pleine migration. |
| `CODER_ACCESS_URL` (via `environment_variables`) | URL du service (auto) ou domaine personnalisé | Élevé | Une URL d'accès erronée casse les connexions des agents d'espace de travail et les URI de redirection OAuth — définissez-la explicitement lorsque vous placez un domaine personnalisé en amont. |
| `enable_nfs` / `nfs_mount_path` | `false` / véritable répertoire | Élevé | NFS est inutile ; s'il est activé, un montage sous `/opt/coder` masque le binaire coder et le conteneur ne peut pas démarrer. |
| `enable_redis` | `false` | Moyen | Coder ne lit jamais Redis ; l'activer provisionne un point de terminaison que rien n'utilise. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les équipes privées | Moyen | Tant que le premier compte administrateur n'est pas créé, la page de configuration est accessible publiquement à l'URL `run.app`. |
| `enable_backup_import` | `false` sauf en cas de restauration | Moyen | L'activer sans `backup_file` valide fait échouer la tâche d'importation. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Coder partagée avec la variante GKE est décrite dans **[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Coder sur Cloud Run](../labs/Coder_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Coder sur GKE Autopilot](Coder_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration applicative partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [code-server sur Google Cloud Run](CodeServer_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Cloud Development Environments**.
