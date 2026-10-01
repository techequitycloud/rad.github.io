---
title: "Monica sur Google Cloud Run"
description: "Référence de configuration pour déployer Monica sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Monica_CloudRun.md @ 3055034 sha256:b4ecb3734f1f -->

# Monica sur Google Cloud Run {#monica-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_CloudRun.png" alt="Monica sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica est une application open source de gestion des relations personnelles (PRM) — un « CRM personnel » pour organiser la façon dont vous restez en contact avec vos amis, votre famille et vos relations. Ce module déploie Monica sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Monica et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Monica s'exécute sous forme de conteneur PHP/Laravel (image Apache officielle) sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle jusqu'à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Monica est liée à MySQL |
| Stockage d'objets | Cloud Storage | Un bucket dédié `monica-uploads` pour les photos et documents des contacts |
| Persistance | NFS (activé par défaut) | Assure la durabilité des téléversements du répertoire `storage/` de Laravel à travers les démarrages à froid et les révisions |
| Cache | Redis (facultatif) | Désactivé par défaut ; utilisé pour le cache et les sessions lorsqu'il est activé |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** `database_type = "MYSQL_8_0"` est défini par la couche applicative partagée ; Monica ne s'exécute pas sur PostgreSQL ici.
- **L'image est l'image officielle précompilée `monica:<version>`.** Pas d'étape Cloud Build — `container_image_source = "prebuilt"` récupère la variante Apache depuis Docker Hub, qui sert sur le **port 80**.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager. C'est une clé de chiffrement Laravel qui ne doit jamais faire l'objet d'une rotation après le premier démarrage — sa rotation corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image exécute `php artisan migrate --force` à chaque démarrage du conteneur, de sorte que le schéma est créé et mis à niveau au démarrage (après que le job `db-init` a provisionné la base de données et l'utilisateur).
- **Connexion TCP directe à Cloud SQL via l'adresse IP privée par défaut.** `enable_cloudsql_volume = false` sur Cloud Run — Monica se connecte à MySQL via l'adresse IP privée de l'instance (le modèle Laravel-sur-MySQL de SnipeIT/Matomo), sans socket Auth Proxy et sans SSL requis.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les fichiers téléversés dans le répertoire `storage/` de Laravel survivent aux démarrages à froid et aux nouvelles révisions.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`, `max = 1`). Les démarrages à froid ajoutent quelques secondes de latence, plus le démarrage d'Apache et des migrations, à la première requête après une période d'inactivité ; définissez `min_instance_count = 1` pour garder une instance active.
- **`APP_URL` est défini à partir de l'URL prévue du service** afin que Laravel construise des liens absolus corrects et que la redirection `/` → configuration/inscription aboutisse sur le bon hôte.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Monica {#a-cloud-run--the-monica-service}

Monica s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~monica"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Monica stocke toutes les données applicatives (contacts, activités, rappels, entrées de journal, utilisateurs) dans une instance gérée Cloud SQL for MySQL 8.0. Sur Cloud Run, le service se connecte par défaut via l'**adresse IP privée de l'instance** (`enable_cloudsql_volume = false`) ; aucune adresse IP publique n'est exposée. Au premier déploiement, le job `db-init` crée la base de données applicative et l'utilisateur et accorde les privilèges ; le point d'entrée du conteneur exécute ensuite les migrations Laravel.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les options et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `monica-uploads`) est provisionné automatiquement pour les fichiers téléversés de Monica (photos des contacts, documents). Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, le socle injecte `REDIS_HOST`/`REDIS_PORT` ; si `redis_host` est laissé vide alors que NFS est activé, l'adresse IP de la VM du serveur NFS est utilisée comme point de terminaison Redis (la VM NFS héberge aussi Redis).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : l'**`APP_KEY`** Laravel (utilisé pour le chiffrement AES-256-CBC des colonnes chiffrées et pour la signature des sessions/cookies). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, le service est joignable via son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

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

## 3. Comportement de l'application Monica {#3-monica-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte via le socket Cloud SQL (lorsqu'il est monté) ou via l'adresse IP privée, puis crée de manière idempotente la base de données applicative et l'utilisateur, accorde les privilèges et vérifie que l'utilisateur applicatif peut se connecter. Le job peut être réexécuté sans risque.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image officielle Monica exécute `php artisan migrate --force` à chaque démarrage du conteneur — il n'existe pas de job de migration distinct. Le schéma est créé au premier démarrage (après `db-init`) et mis à niveau automatiquement lorsque vous augmentez `application_version`.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une seule fois et écrit dans Secret Manager. Le modifier corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions — n'effectuez sa rotation que pendant une fenêtre de maintenance planifiée, avec un plan complet de re-chiffrement des données.
- **Configuration initiale dans l'interface.** Monica n'a **aucun identifiant par défaut**. Ouvrez l'URL du service : un visiteur non authentifié est redirigé vers la page d'inscription/de configuration. Le premier compte que vous créez devient l'administrateur. Inscrivez-vous avec `admin@techequity.cloud` pour les déploiements RAD.
- **Les téléversements de fichiers nécessitent de la persistance.** Les photos et documents téléversés résident sous le répertoire `storage/` de Laravel. NFS est activé par défaut afin qu'ils survivent aux démarrages à froid et aux révisions ; le bucket GCS `monica-uploads` est également provisionné. Désactiver NFS fait courir le risque de perdre les fichiers téléversés au prochain démarrage à froid.
- **Chemin de santé.** La sonde de démarrage est en **TCP** sur `/` (elle réussit dès qu'Apache se lie au port) et la sonde de vivacité est en **HTTP** `GET /` (la page d'accueil de Monica renvoie `200`). Prévoyez une fenêtre généreuse au premier démarrage pour le lancement d'Apache et le `php artisan migrate --force` initial.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Monica ou notables pour celle-ci sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `monica` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | _(défini)_ | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Monica ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Récupère directement l'image officielle `monica` — ne la remplacez pas par `custom`. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro ; définissez `1` pour éviter la latence du démarrage à froid et des migrations. |
| `max_instance_count` | `1` | Une seule instance suffit pour un CRM personnel. |
| `container_port` | `80` | L'image Apache de Monica écoute sur le port 80. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte à MySQL en TCP via l'adresse IP privée ; le socket Auth Proxy est désactivé. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut — rend persistants les téléversements du répertoire `storage/` de Laravel à travers les démarrages à froid et les révisions. |
| `nfs_mount_path` | `/var/www/html/storage` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` | `true` | Provisionne le bucket `monica-uploads` (ainsi que ceux de `storage_buckets`). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé à MySQL 8.0. |
| `db_name` | `monica` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `db_user` | `monica` | Nom de base de l'utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, 20 retries | Réussit lorsqu'Apache se lie au port ; fenêtre généreuse pour la migration au premier démarrage. |
| `liveness_probe` | HTTP `/` 300s delay | La page d'accueil de Monica renvoie `200`. |

### Groupe 21/22 — Cache Redis {#group-2122--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | À activer pour adosser le cache et les sessions à Redis ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (adresse IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`monica-uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, un `database_type` en dehors de l'ensemble pris en charge, IAP sans identités autorisées. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais en faire la rotation après le premier démarrage | Critique | Sa rotation corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | Monica est une application MySQL ; un moteur autre que MySQL casse le pilote et les migrations. |
| `enable_nfs` | `true` | Élevé | Le désactiver fait perdre les photos et documents des contacts téléversés au prochain démarrage à froid ou à la prochaine révision. |
| `container_image_source` | `prebuilt` | Élevé | Définir `custom` fait pointer le service vers une image Artifact Registry jamais construite (`Image not found`). |
| `container_port` | `80` | Élevé | L'image Apache écoute sur 80 ; un port différent fait échouer la sonde de démarrage. |
| `APP_URL` (défini automatiquement) | URL réelle du service | Élevé | Une URL erronée casse les liens absolus et la redirection `/` → configuration/inscription (404 sur le mauvais hôte). |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Moyen | Monica se connecte en TCP via l'adresse IP privée ; imposer le socket est inutile et peut laisser `DB_HOST` sous la forme d'un chemin de socket que le client gère mal. |
| `min_instance_count` | `0` (ou `1` pour une instance active) | Moyen | La mise à l'échelle jusqu'à zéro ajoute la latence du démarrage à froid, d'Apache et des migrations à la première requête après une période d'inactivité. |
| `memory_limit` | `2Gi` | Moyen | Réduire trop fortement la mémoire expose à des OOM PHP pendant les migrations du premier démarrage et sur les pages lourdes. |
| `enable_redis` | désactivé sauf besoin | Faible | Cache et sessions Redis facultatifs ; s'il est activé sans hôte et avec NFS désactivé, le point de terminaison Redis est vide. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Monica partagée avec la variante GKE est décrite dans **[Monica_Common](Monica_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Monica sur Cloud Run](../labs/Monica_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Monica sur GKE Autopilot](Monica_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Monica Common — Configuration applicative partagée](Monica_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Radicale sur Google Cloud Run](Radicale_CloudRun.md), [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Personal Organiser**.
