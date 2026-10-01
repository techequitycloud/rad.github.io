---
title: "LimeSurvey sur Google Cloud Run"
description: "Référence de configuration pour déployer LimeSurvey sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LimeSurvey_CloudRun.md @ 3055034 sha256:724161746fdf -->

# LimeSurvey sur Google Cloud Run {#limesurvey-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LimeSurvey_CloudRun.png" alt="LimeSurvey sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LimeSurvey est une plateforme libre et open source (GPL) d'enquêtes et de
questionnaires en ligne écrite en PHP, prenant en charge un nombre illimité
d'enquêtes, le branchement conditionnel, les quotas et les questionnaires
multilingues avec des résultats exportables. Ce module déploie LimeSurvey sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LimeSurvey et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LimeSurvey s'exécute sous forme de conteneur PHP/Apache sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 8080, 1 vCPU / 2 GiB par défaut ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est imposé et InnoDB est forcé |
| Persistance des fichiers | Cloud Filestore (NFS) | Conserve `/var/www/html/upload` entre les redémarrages ; activé par défaut |
| Stockage d'objets | Cloud Storage | Un bucket `limesurvey-uploads` dédié provisionné automatiquement |
| Cache (facultatif) | Redis | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et InnoDB est forcé.** Le moteur est imposé par la
  couche applicative partagée (`database_type = MYSQL_8_0`). InnoDB est forcé car
  Cloud SQL désactive MyISAM — la valeur par défaut MyISAM de l'image ferait sinon
  échouer la création des tables au premier démarrage.
- **Le schéma est créé au premier démarrage du conteneur**, et non par un job de
  migration. Le job `db-init` provisionne uniquement une base de données vide et un
  utilisateur ; l'installateur en console de LimeSurvey (upstream) construit ensuite
  le schéma au démarrage de l'application. Prévoyez un délai de démarrage généreux
  lors du premier déploiement.
- **`ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret Manager. Le
  conteneur refuse de démarrer sans lui. Le premier super-administrateur est créé
  avec `admin` / `admin@techequity.cloud`.
- **Cloud SQL est joint en TCP par défaut** (`enable_cloudsql_volume = false`) —
  LimeSurvey se connecte à l'IP privée de Cloud SQL via le réseau privé ; MySQL en
  TCP sur IP privée ne nécessite pas de SSL.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les ressources
  téléversées survivent aux redémarrages du conteneur. Nécessite l'environnement
  d'exécution gen2 (valeur par défaut).
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`)
  avec `max_instance_count = 1`. Les démarrages à froid ajoutent de la latence après
  une période d'inactivité ; définissez `min_instance_count = 1` pour garder le
  service toujours chaud.
- **`PUBLIC_URL` est défini à partir de l'URL du service** au moment du plan et
  corrigé à l'exécution par le point d'entrée du conteneur, afin que les liens
  d'enquête et les ressources se résolvent sur l'hôte réel.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin
  que les répondants puissent accéder aux enquêtes publiques. L'activation d'IAP
  bloquera les répondants anonymes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LimeSurvey {#a-cloud-run--the-limesurvey-service}

LimeSurvey s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge des requêtes, entre le nombre minimal et le nombre
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

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

LimeSurvey stocke toutes les données applicatives (enquêtes, questions, réponses,
utilisateurs, paramètres globaux) dans une instance gérée Cloud SQL for MySQL 8.0.
Par défaut, le service se connecte en **TCP sur IP privée**
(`enable_cloudsql_volume = false`) ; aucune IP publique n'est exposée. Lors du
premier déploiement, le job `db-init` crée la base de données applicative et
l'utilisateur ; le schéma est ensuite construit par l'installateur propre à
LimeSurvey au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Activée par défaut, une instance Cloud Filestore (NFS) est montée dans le service
afin que le répertoire de téléversement de LimeSurvey (`/var/www/html/upload` —
images de ressources, signatures, codes-barres, fichiers de réponses téléversés)
soit conservé entre les redémarrages du conteneur et les révisions. Les montages NFS
nécessitent l'environnement d'exécution gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de découverte du NFS
partagé.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié (`limesurvey-uploads`) est provisionné
automatiquement. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (cache d'objets facultatif) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Il s'agit d'un cache
d'objets facultatif, qui n'est pas nécessaire au fonctionnement de LimeSurvey.
Lorsque `redis_host` est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du
serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Inspect env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Le mot de passe du super-administrateur LimeSurvey (`ADMIN_PASSWORD`) est généré
automatiquement et stocké dans Secret Manager, puis injecté comme variable
d'environnement secrète. Le mot de passe de la base de données est géré séparément
par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### G. Réseau et entrée {#g-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, ce qui permet l'accès
public nécessaire aux répondants anonymes. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et
des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LimeSurvey {#3-limesurvey-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte via
  le socket Cloud SQL (s'il est monté) ou, à défaut, en TCP sur IP privée, puis crée
  de manière idempotente la base de données applicative et l'utilisateur, accorde les
  privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le
  job peut être réexécuté sans risque.
- **Schéma créé au démarrage du conteneur.** Il n'existe pas de job de migration
  distinct. Une fois que `db-init` a provisionné une base de données vide, le point
  d'entrée upstream `martialblog/limesurvey` exécute l'installateur en console /
  `updatedb` de LimeSurvey au démarrage pour construire (ou mettre à niveau) le
  schéma. Si le conteneur se déclare sain mais que chaque page renvoie une erreur 500
  avec « table settings_global not found », l'installateur a échoué silencieusement —
  presque toujours à cause d'un problème de moteur de stockage (voir la remarque sur
  InnoDB ci-dessous) ou d'une base de données que l'installateur n'a pas pu joindre.
- **InnoDB est forcé.** `DB_MYSQL_ENGINE = InnoDB` et `DBENGINE = InnoDB` sont
  définis car Cloud SQL désactive MyISAM. Ne les remplacez pas par MyISAM — la
  création des tables échouerait.
- **`ADMIN_PASSWORD` est obligatoire.** Le conteneur se termine avec le code 1 sans
  lui. Il est généré automatiquement et stocké dans Secret Manager, et crée le
  super-administrateur initial (`admin` / `admin@techequity.cloud`) au premier
  démarrage. Récupérez-le avant la première connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~admin-password' --format='value(name)' | head -1)" \
    --project "$PROJECT"
  ```
- **URL publique.** `PUBLIC_URL` est défini à partir de l'URL prévue du service au
  moment du plan et corrigé à l'exécution à partir de `CLOUDRUN_SERVICE_URL`, afin que
  les liens d'enquête et les ressources statiques se résolvent sur l'hôte Cloud Run
  réel. Vérifiez l'URL déployée :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est une sonde TCP sur le port du
  conteneur ; la sonde de vivacité est `GET /` (LimeSurvey renvoie un 200 non
  authentifié sur la page d'accueil racine). Prévoyez un délai généreux au premier
  démarrage pour l'installateur en console.
- **Fichiers téléversés.** Ils sont conservés sous `/var/www/html/upload` via le
  montage NFS. Sans NFS, les ressources téléversées sont perdues lorsque l'instance
  est recyclée.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LimeSurvey ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `limesurvey` | Nom de base du service, du dépôt du registre et des secrets. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `LimeSurvey` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Correspond au tag de base `martialblog/limesurvey` ; `latest` se résout en `6-apache` (version figée). Figez la version (par ex. `6-apache`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour LimeSurvey + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 512Mi minimum, 2Gi recommandé. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Conservez 1, sauf si le NFS partagé + la gestion des sessions multi-instances sont confirmés. |
| `container_port` | `8080` | LimeSurvey (Apache) écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les imports CSV volumineux. |
| `enable_cloudsql_volume` | `false` | `false` utilise le TCP sur IP privée vers MySQL ; définissez `true` pour le socket de l'Auth Proxy. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise les répondants anonymes. `internal` bloque le public. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les répondants anonymes.** |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore et le monte pour conserver `/var/www/html/upload`. Nécessite gen2. |
| `nfs_mount_path` | `/var/www/html/upload` | Chemin de montage du volume NFS dans le conteneur. |
| `create_cloud_storage` | `true` | Crée les buckets GCS déclarés. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Imposé à MySQL 8.0. Les autres moteurs ne sont pas pris en charge. |
| `db_name` | `limesurvey` | Nom de la base de données (injecté en tant que `DB_NAME`). Immuable après le premier déploiement. |
| `db_user` | `limesurvey` | Utilisateur de base de données de l'application (injecté en tant que `DB_USERNAME`). Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache d'objets facultatif ; non requis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
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
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, un `redis_port`/`backup_retention_days` hors plage, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB_MYSQL_ENGINE` / `DBENGINE` (auto `InnoDB`) | Ne jamais définir MyISAM | Critique | Cloud SQL désactive MyISAM ; le `CREATE TABLE … ENGINE=MyISAM` de l'installateur échoue et chaque page renvoie une erreur 500 (« table settings_global not found »). |
| `database_type` | `MYSQL_8_0` | Critique | LimeSurvey nécessite MySQL ; passer à Postgres/None empêche le démarrage. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et détruit toutes les données d'enquête. |
| `ADMIN_PASSWORD` (généré automatiquement) | À récupérer dans Secret Manager | Critique | Le conteneur se termine avec le code 1 sans lui ; le modifier recrée le super-administrateur au démarrage suivant. |
| `enable_backup_import` | `false` sauf pour une restauration | Critique | L'activer sans URI de sauvegarde valide fait échouer le job d'import. |
| `enable_nfs` | `true` | Élevé | Sans NFS, les ressources téléversées sous `/var/www/html/upload` sont perdues lorsque l'instance est recyclée. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances sans NFS partagé ni gestion des sessions confirmés entraînent un état incohérent des téléversements. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS/GCS nécessitent gen2 ; `gen1` échoue à la validation au moment du plan. |
| `ingress_settings` | `all` | Élevé | `internal` empêche les répondants anonymes d'accéder aux enquêtes publiques. |
| `enable_iap` | uniquement pour les enquêtes internes | Élevé | IAP exige une connexion Google pour chaque requête, ce qui bloque les répondants anonymes. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512Mi, risque d'OOM lors du rendu d'enquêtes volumineuses ou d'un import CSV. |
| `enable_cloudsql_volume` | `false` (TCP) | Moyen | LimeSurvey/MySQL utilise le TCP sur IP privée ; forcer le socket sans volume monté peut bloquer la connexion à la base de données. |
| `min_instance_count` | `1` en production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid sur la première requête après une période d'inactivité. |
| `application_version` | figée (par ex. `6-apache`) | Moyen | `latest` se résout en `6-apache` (version figée) ; une montée de version majeure non figée peut nécessiter une mise à niveau du schéma. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à LimeSurvey partagée avec la variante GKE est décrite dans
**[LimeSurvey_Common](LimeSurvey_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LimeSurvey sur Cloud Run](../labs/LimeSurvey_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LimeSurvey sur GKE Autopilot](LimeSurvey_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LimeSurvey Common — Configuration applicative partagée](LimeSurvey_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Community & Voice of Customer**.
