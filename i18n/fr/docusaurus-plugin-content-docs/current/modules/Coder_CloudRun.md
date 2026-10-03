---
title: "Coder sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Coder sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Coder_CloudRun.md @ 15fd4c7 sha256:a6df4d280786 -->

# Coder sur Google Cloud Run {#coder-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_CloudRun.png" alt="Coder sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open source auto-hébergée pour le provisionnement d'environnements de développement à distance (espaces de travail) définis comme du code avec Terraform — les développeurs obtiennent des environnements cohérents et prêts à coder tandis que les équipes de plateforme conservent le code source et les dépendances sur leur propre infrastructure. Ce module déploie le plan de contrôle Coder sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Coder et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Coder s'exécute comme un seul binaire Go (`coder server`) dans un conteneur sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service de plan de contrôle Go, 2 vCPU / 4 GiB par défaut, CPU toujours alloué |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (disponible pour l'opérateur) |
| Build d'image | Cloud Build + Artifact Registry | Wrapper personnalisé léger construit À PARTIR de `ghcr.io/coder/coder` |
| Secrets | Secret Manager | Mot de passe de base de données géré automatiquement — Coder n'a pas besoin de son propre secret d'application |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Coder nécessite PostgreSQL 13+ ; une validation au moment de la planification rejette les moteurs MySQL.
- **Le plan de contrôle est sans état.** Tout l'état — modèles, espaces de travail, utilisateurs, sessions, file d'attente de build et clés de signature auto-générées de Coder — réside dans PostgreSQL. Pas de NFS, pas de Redis, pas de secret d'application géré par Common.
- **`cpu_always_allocated = true` et `min_instance_count = 1`.** `coder server` exécute des démons de provisionnement intégrés qui interrogent continuellement la base de données pour les builds d'espaces de travail en attente et terminent les connexions des agents d'espace de travail — ce travail en arrière-plan est bloqué par la limitation du CPU basée sur les requêtes ou la mise à l'échelle à zéro.
- **L'URL de connexion est assemblée au moment de l'exécution.** Le point d'entrée personnalisé construit `CODER_PG_CONNECTION_URL` (une URL `postgres://` avec un mot de passe encodé en URL) à partir des variables `DB_*` injectées par la Fondation, préférant le chemin TCP IP privé avec `sslmode=require` sur Cloud Run.
- **`CODER_ACCESS_URL` est défini automatiquement** à partir de l'URL de service Cloud Run injectée, de sorte que les URL de connexion d'espace de travail/agent et les URI de redirection OAuth sont corrects dès la sortie de la boîte.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et le rôle Coder ; Coder exécute ses propres migrations de schéma au démarrage du serveur.
- **Les sondes de santé ciblent `/healthz`** (non authentifié) avec un délai initial de 60 secondes pour la migration de schéma au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.
- **`application_version = "latest"` correspond à une balise épinglée** (`v2.24.1`) via l'ARG de build `CODER_VERSION` spécifique à l'application — les balises GHCR de Coder sont préfixées par semver.

> Ce module déploie le **plan de contrôle** Coder. Le provisionnement d'espaces de travail réels nécessite en outre un provisionneur configuré et une cible de calcul (par exemple, un cluster Kubernetes ou un modèle de VM cloud), configurés après le déploiement via le système de modèles de Coder.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Coder {#a-cloud-run--the-coder-service}

Coder s'exécute en tant que service Cloud Run v2 avec un CPU toujours alloué et une instance minimale chaude, de sorte que les démons de provisionnement intégrés continuent d'interroger les builds d'espaces de travail même sans requêtes entrantes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — utilisateurs, organisations, modèles, état de l'espace de travail, file d'attente des jobs de provisionnement et ses clés de signature — dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte via IP privée avec `sslmode=require` (le DSN de Coder sous forme d'URL ne peut pas contenir le chemin du socket Unix) ; le job `db-init` crée la base de données et le rôle de l'application lors du premier déploiement.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement. Coder n'en a pas besoin pour le fonctionnement du plan de contrôle — le plan de contrôle ne conserve aucun fichier sur disque — mais il est disponible pour les actifs de modèle ou l'utilisation par l'opérateur.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

### D. Cloud Build et Artifact Registry {#d-cloud-build--artifact-registry}

`container_image_source = "custom"` déclenche un Cloud Build qui enveloppe `ghcr.io/coder/coder:<version>` avec le point d'entrée cloud et pousse le résultat vers Artifact Registry (l'image de base est d'abord mise en miroir, `enable_image_mirroring = true`).

- **Console :** Cloud Build → Historique ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --limit 5
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est le seul secret du déploiement — stocké dans Secret Manager et injecté au moment de l'exécution en tant que `DB_PASSWORD`, puis encodé en URL dans l'URL de connexion par le point d'entrée. Coder auto-génère ses clés de signature et les persiste dans PostgreSQL, de sorte qu'aucun secret de session/application n'existe à gérer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut ; le point d'entrée exporte cette URL en tant que `CODER_ACCESS_URL`, à partir de laquelle Coder construit les URL de connexion d'espace de travail et d'agent. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et de VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs de conteneur (structurés, vers STDOUT) sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (`postgres:15-alpine`) se connecte en tant que superutilisateur `postgres` et crée de manière idempotente le rôle Coder (`LOGIN CREATEDB`), crée la base de données, accorde tous les privilèges et réaffecte la propriété du schéma `public` au rôle de l'application (les migrations de Coder créent tous les objets là). Le job s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage.** Coder applique ses propres migrations de schéma chaque fois que `coder server` démarre — les mises à niveau de version n'ont pas besoin d'étape de migration manuelle. Le premier démarrage sur une base de données vierge prend plus de temps ; la sonde de démarrage autorise jusqu'à ~8 minutes avant d'abandonner.
- **Assemblage du DSN au moment de l'exécution.** Le point d'entrée cloud construit `CODER_PG_CONNECTION_URL` à partir de `DB_HOST`/`DB_IP`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` : sur Cloud Run, il préfère l'IP privée avec `sslmode=require` (le chemin du socket Cloud SQL ne peut pas résider dans une autorité d'URL) ; le mot de passe est encodé en pourcentage afin que les caractères spéciaux ne cassent jamais l'URL. Un `CODER_PG_CONNECTION_URL` explicitement fourni l'emporte.
- **URL d'accès.** `CODER_ACCESS_URL` est défini à partir de `CLOUDRUN_SERVICE_URL` injecté. Coder construit les URL de connexion d'espace de travail/agent et les URI de redirection OAuth à partir de celle-ci — si vous placez le service derrière un domaine personnalisé, définissez `CODER_ACCESS_URL` dans `environment_variables` sur ce domaine.
- **Pas de secrets d'application.** Coder génère et persiste ses clés de signature dans PostgreSQL. La recréation de conteneurs, la mise à l'échelle et les redéploiements sont sûrs ; rien ne se désynchronise.
- **Configuration initiale.** La première visite à l'URL du service vous invite à créer le compte administrateur (propriétaire) initial — complétez-le rapidement, car le point de terminaison est publiquement accessible jusqu'alors (`ingress_settings = "all"` par défaut).
- **Le provisionnement de l'espace de travail est une étape du jour 2.** Le plan de contrôle seul n'exécute aucun espace de travail. Créez un modèle (Terraform) pointant vers une cible de calcul — par exemple, un cluster GKE ou des VM GCE — et assurez-vous que le provisionneur dispose des identifiants pour celle-ci.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/healthz`, que Coder sert sans authentification avec HTTP 200 une fois le serveur démarré.

Vérification :

```bash
SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"     # expect 200
curl -s "$SERVICE_URL/api/v2/buildinfo"                             # Coder version info
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Coder sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Coder` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Balise de version de Coder ; `latest` correspond à la balise épinglée `v2.24.1` via l'ARG de build `CODER_VERSION`. Incrémentez pour déclencher un nouveau build d'image et une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Coder nécessite au moins 2 Gi pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Garder ≥ 1 — les démons de provisionnement intégrés doivent rester chauds pour prendre en charge les builds d'espaces de travail. |
| `max_instance_count` | `1` | Garder à 1 — plus d'une instance est le mode haute disponibilité de Coder, qui nécessite une licence premium. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance. Garder `true` — le polling du provisionneur et les connexions des agents sont bloqués par la limitation basée sur les requêtes. Définir `false` uniquement pour une évaluation de l'interface utilisateur. |
| `container_port` | `3000` | Port HTTP de Coder (`CODER_HTTP_ADDRESS = 0.0.0.0:3000`). |
| `container_image_source` | `custom` | Requis — l'image amont ne contient pas le point d'entrée qui assemble l'URL de connexion à la base de données et l'URL d'accès. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; le point d'entrée se connecte toujours via TCP IP privée car le DSN de Coder sous forme d'URL ne peut pas contenir le chemin du socket. |
| `enable_image_mirroring` | `true` | L'image de base GHCR est mise en miroir dans Artifact Registry avant le build. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Coder doit être accessible par les développeurs et les agents d'espace de travail ; restreindre avec IAP ou Cloud Armor plutôt qu'avec un ingress interne uniquement. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'authentification propre à Coder. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration `CODER_*` supplémentaire (par exemple `CODER_OIDC_*` pour le SSO, `CODER_ACCESS_URL` pour un domaine personnalisé). `CODER_HTTP_ADDRESS`, `CODER_TELEMETRY_ENABLE=false` et `CODER_VERBOSE=false` sont prédéfinis par `Coder_Common`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, un secret client OIDC). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupes 7-10 — Sauvegarde, CI/CD, SQL personnalisé, LB et CDN {#groups-710--backup-cicd-custom-sql-lb--cdn}

Comportement standard de App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `backup_schedule`, `enable_backup_import`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_cloud_armor`, `application_domains`, `enable_cdn`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — le plan de contrôle est sans état ; tout l'état réside dans PostgreSQL. |
| `nfs_mount_path` | `/home/coder/data` | Uniquement lorsque `enable_nfs=true`. Doit être un répertoire réel — jamais un sous-chemin de `/opt/coder`, qui est le **binaire** coder (un fichier) ; le monter par-dessus empêche le démarrage du conteneur. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder nécessite PostgreSQL 13+ — MySQL est rejeté par une validation au moment de la planification. |
| `db_name` | `coder` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `coder` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64) ; les caractères spéciaux sont sûrs — le point d'entrée encode le mot de passe en URL. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, délai initial de 60s, 30 échecs | Seuil généreux (~8 min) pour la migration de schéma au premier démarrage sur une instance Cloud SQL vierge. |
| `liveness_probe` | HTTP `/healthz`, délai initial de 60s | Sonde de vivacité contre le point de terminaison de santé non authentifié de Coder. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring ; pointez-le vers `/healthz` lors de l'activation. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 21 — Redis / Groupe 22 — VPC-SC {#group-21--redis--group-22--vpc-sc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente de build résident dans PostgreSQL. |
| `enable_vpc_sc` | `false` | Application standard du périmètre — voir [App_CloudRun](App_CloudRun.md). |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (URL d'accès de Coder). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Les validations au moment de la planification dans `validation.tf` détectent les pires combinaisons tôt : ordre min/max des instances, Redis sans hôte, moteurs non-PostgreSQL et un sidecar proxy Cloud SQL avec `database_type = "NONE"`.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment de la planification. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les modèles, espaces de travail, utilisateurs et clés de signature. |
| `container_image_source` | `custom` | Critique | L'image amont ne peut pas assembler `CODER_PG_CONNECTION_URL` à partir des variables `DB_*` de la Fondation — le serveur ne se connecte jamais à PostgreSQL. |
| `container_port` | `3000` | Critique | Doit correspondre à `CODER_HTTP_ADDRESS = 0.0.0.0:3000` ; une non-concordance échoue à chaque sonde de santé. |
| `cpu_always_allocated` | `true` | Élevé | Sous facturation basée sur les requêtes, les démons de provisionnement intégrés sont limités à ~0 entre les requêtes — les builds d'espaces de travail sont bloqués silencieusement. |
| `min_instance_count` | `1` | Élevé | À `0`, le plan de contrôle se met à l'échelle à zéro et aucun provisionneur n'interroge — les builds d'espaces de travail en file d'attente attendent la prochaine requête entrante pour réveiller une instance. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | Élevé | En dessous de 2 Gi, le serveur Go risque un OOM lors des pics de build d'espaces de travail et des importations de modèles. |
| `application_version` | balise épinglée (par exemple `v2.24.1`) | Élevé | Les balises GHCR de Coder sont préfixées par semver (`vX.Y.Z`) ; `latest` est mappé à une épingle par le module — ne remplacer qu'avec une vraie balise. |
| Chemin / délai `startup_probe` | `/healthz`, 60s | Élevé | Pointer les sondes vers un chemin authentifié renvoie 401/403 et la révision ne devient jamais prête ; couper le seuil tue les premiers démarrages en pleine migration. |
| `CODER_ACCESS_URL` (via `environment_variables`) | URL du service (auto) ou domaine personnalisé | Élevé | Une URL d'accès incorrecte rompt les connexions des agents d'espace de travail et les URI de redirection OAuth — définissez-la explicitement lorsque vous utilisez un domaine personnalisé. |
| `enable_nfs` / `nfs_mount_path` | `false` / répertoire réel | Élevé | NFS est inutile ; si activé, un montage sous `/opt/coder` masque le binaire coder et le conteneur ne peut pas démarrer. |
| `enable_redis` | `false` | Moyen | Coder ne lit jamais Redis ; l'activer provisionne un point de terminaison que rien n'utilise. |
| `enable_iap` / `enable_cloud_armor` | activer pour les équipes privées | Moyen | Jusqu'à la création du premier compte administrateur, la page de configuration est publiquement accessible à l'URL `run.app`. |
| `enable_backup_import` | `false` sauf restauration | Moyen | L'activation sans un `backup_file` valide échoue au job d'importation. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Coder partagée avec la variante GKE est décrite dans **[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Coder sur Cloud Run](../labs/Coder_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Coder sur GKE Autopilot](Coder_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration d'application partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [code-server sur Google Cloud Run](CodeServer_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Environnements de développement cloud**.
