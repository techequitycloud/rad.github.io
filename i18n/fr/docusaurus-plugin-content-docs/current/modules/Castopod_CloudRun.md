---
title: "Castopod sur Google Cloud Run"
description: "Référence de configuration pour déployer Castopod sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Castopod_CloudRun.md @ 3055034 sha256:03979b48002b -->

# Castopod sur Google Cloud Run {#castopod-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_CloudRun.png" alt="Castopod sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod est une plateforme open source d'hébergement de podcasts, nativement compatible
ActivityPub, construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce module
déploie Castopod sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise Castopod et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Castopod s'exécute comme un conteneur PHP/FrankenPHP sur Cloud Run v2, à l'écoute sur le port
8080. Le déploiement assemble un ensemble restreint de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service FrankenPHP/Caddy, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Castopod ne prend en charge ni PostgreSQL ni aucun autre moteur |
| Stockage des médias | Cloud Storage + Cloud Filestore (NFS) | Un bucket `media` est provisionné ; NFS est activé par défaut pour conserver les fichiers téléversés entre les redémarrages |
| Cache | Redis (facultatif) | Le cache fichier (`CP_CACHE_HANDLER = file`) est la valeur par défaut ; Redis est optionnel |
| Secrets | Secret Manager | `CP_ANALYTICS_SALT` généré automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé
  (`database_type = "MYSQL_8_0"`) par le module ; choisir PostgreSQL ou tout autre moteur
  empêche le démarrage.
- **La configuration de la base de données est écrite dans le `.env` de Castopod, et non dans
  des variables d'environnement.** Castopod (CodeIgniter 4) lit des clés en notation pointée
  (`database.default.hostname` …) qui ne peuvent pas être des noms de variables
  d'environnement Cloud Run. Le point d'entrée du conteneur les matérialise dans `.env` à
  partir des variables `DB_*` injectées, et résout un hôte TCP (`DB_IP`), car le pilote
  `mysqli` de CI4 ne peut pas utiliser le répertoire de socket Cloud SQL.
- **`CP_ANALYTICS_SALT` est généré automatiquement** et stocké dans Secret Manager.
  Conservez-le stable — il anonymise les statistiques d'écoute, et le modifier rompt la
  continuité de la déduplication pour les auditeurs déjà enregistrés.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`). Les démarrages à froid
  ajoutent quelques secondes de latence à la première requête après une période d'inactivité.
  Définissez `min_instance_count = 1` pour que Castopod reste toujours actif.
- **`max_instance_count = 1` par défaut.** Ne dépassez pas une instance tant qu'il n'est pas
  confirmé que le système de fichiers de médias partagé (NFS/GCS) et un cache partagé
  supportent plusieurs instances.
- **NFS est activé par défaut** (`enable_nfs = true`) pour conserver les médias téléversés
  entre les redémarrages du conteneur. Castopod stocke l'audio et les illustrations des
  épisodes sur le système de fichiers, et non dans la base de données.
- **L'URL de base est dérivée automatiquement.** Le point d'entrée définit `CP_BASEURL` à
  partir de `CLOUDRUN_SERVICE_URL` à l'exécution, de sorte que les URL du flux du podcast et
  des médias reflètent l'adresse réelle du service.
- **Les migrations CodeIgniter s'exécutent au démarrage du conteneur** — il n'y a pas de job
  de migration distinct, car le point d'entrée de la surcouche de la plateforme
  (`Castopod_Common/scripts/entrypoint.sh`) exécute explicitement `php spark migrate --all` à
  chaque démarrage ; l'image de base `castopod/castopod` ne le fait **pas** automatiquement. Le
  schéma est créé au premier démarrage, après que le job `db-init` a provisionné la base et
  l'utilisateur (voir §3 ci-dessous).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et
des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Castopod {#a-cloud-run--the-castopod-service}

Castopod s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge des
requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~castopod"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Castopod stocke toutes les données de l'application (podcasts, épisodes, utilisateurs,
statistiques) dans une instance gérée Cloud SQL for MySQL 8.0. Le service s'y connecte de
manière privée — le point d'entrée contacte l'IP privée de Cloud SQL en TCP (le pilote
`mysqli` de CodeIgniter ne peut pas utiliser le répertoire de socket de l'Auth Proxy) ; aucune
IP publique n'est exposée. Lors du premier déploiement, un Job d'initialisation crée la base
de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent
dans les [Outputs](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage et persistance des médias {#c-cloud-storage--media-persistence}

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement. Comme Castopod
écrit l'audio et les illustrations téléversés sur le système de fichiers du conteneur, sous
`/var/www/castopod/public/media`, **Cloud Filestore (NFS)** est activé par défaut
(`enable_nfs = true`, monté sur `nfs_mount_path`) afin que ces fichiers survivent aux
redémarrages.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~media"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut** — Castopod utilise un cache sur le système de fichiers
(`CP_CACHE_HANDLER = file`). Lorsque `enable_redis = true`, le module injecte `REDIS_HOST`
et `REDIS_PORT` pour le cache d'objets de Castopod. Lorsque `redis_host` est laissé vide et
que `enable_nfs` vaut true, l'IP de la VM du serveur NFS est utilisée comme point de
terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected cache/redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`CP_ANALYTICS_SALT` (utilisé pour anonymiser les statistiques d'écoute du podcast). Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, qui autorise l'accès public requis
pour les flux de podcast publics et les téléchargements de médias. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les
paramètres d'ingress et le contrôle de sortie VPC régissent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de Cloud Run et de
Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Castopod {#3-castopod-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation
  exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte via le socket du Cloud SQL Auth
  Proxy (ou, en repli, en TCP sur l'IP privée) et crée de manière idempotente la base de
  données et l'utilisateur de l'application, accorde les privilèges et vérifie que
  l'utilisateur de l'application peut se connecter. Le job peut être relancé sans risque.
- **Les migrations s'exécutent au démarrage du conteneur — via le point d'entrée de la
  plateforme, et non l'image de base.** L'image `castopod/castopod` (construite sur
  `serversideup/php`) n'a pas de hook de migration CodeIgniter propre ; son seul comportement
  de migration automatique est spécifique à Laravel (`php artisan migrate`, conditionné par
  `AUTORUN_ENABLED`, par défaut `false`) et n'exécuterait pas le `spark migrate` de CI4 même
  s'il était activé. Le point d'entrée de la surcouche de la plateforme
  (`Castopod_Common/scripts/entrypoint.sh`) exécute explicitement `php
  spark migrate --all` — idempotent, sans risque à chaque démarrage — une fois `.env`/la
  connectivité à la base écrits ; le schéma est donc créé au premier démarrage, et la mise à
  niveau de la version de l'application applique les changements de schéma au démarrage
  suivant, sans job de migration distinct.
  Si cet appel explicite venait à être supprimé, chaque requête renverrait une erreur 500 avec
  `Table '...' doesn't exist` alors même que `db-init` a réussi — vérifiez d'abord
  `entrypoint.sh` lorsque vous diagnostiquez ce symptôme.
- **La configuration de la base de données réside dans `.env`, injectée à l'exécution.** Le
  point d'entrée écrit `database.default.hostname|database|username|password|port` et
  `app.baseURL` dans le `.env` de Castopod à partir des valeurs `DB_*` et
  `CLOUDRUN_SERVICE_URL` injectées par la fondation. Il résout l'hôte de la base de données vers
  l'adresse TCP de l'IP privée, car le pilote `mysqli` de CI4 ne peut pas utiliser le
  répertoire de socket Cloud SQL.
- **`CP_ANALYTICS_SALT` doit rester stable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager ; le modifier rompt la continuité de la
  déduplication pour les auditeurs déjà enregistrés. Ne le renouvelez que délibérément.
- **Chemin de santé.** La sonde de démarrage est une sonde **TCP** sur le port du conteneur et
  la sonde de vivacité un **HTTP `GET /`** — la page d'accueil non authentifiée de Castopod
  renvoie 200 une fois l'application démarrée et connectée à MySQL. Prévoyez plusieurs minutes
  au premier démarrage pour que les migrations CodeIgniter se terminent (la sonde de démarrage
  prévoit un délai initial de 30 secondes plus une fenêtre de 20 tentatives).
- **Configuration au premier lancement.** Après le déploiement, ouvrez l'URL du service et
  suivez l'assistant d'installation web de Castopod pour créer le premier compte
  super-administrateur et définir le nom de l'instance et les paramètres par défaut des
  podcasts. Les médias téléversés sont ensuite conservés dans le répertoire de médias adossé à
  NFS.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Castopod ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `castopod` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Castopod` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Castopod ; `latest` est épinglé sur la version stable actuelle (`1.15.5`). Épinglez explicitement en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Castopod nécessite au minimum 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512Mi, 2Gi recommandé pour les grandes médiathèques. |
| `min_instance_count` | `0` | `0` active la mise à zéro ; définissez `1` pour que Castopod reste toujours actif. |
| `max_instance_count` | `1` | Conservez 1 sauf s'il est confirmé que les médias et le cache partagés supportent plusieurs instances. |
| `container_port` | `8080` | FrankenPHP/Caddy écoute sur le port 8080. |
| `enable_cloudsql_volume` | `false` | Laissez désactivé — le point d'entrée se connecte à MySQL en TCP sur l'IP privée, et non via le socket du Cloud SQL Auth Proxy. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les flux de podcast publics et les téléchargements de médias. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Cloud Filestore pour conserver les médias téléversés entre les redémarrages ; requis pour des médias durables. |
| `nfs_mount_path` | `/var/lib/castopod` | Chemin de montage du volume NFS dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur MySQL 8.0 fixe. Ne le modifiez pas — Castopod ne prend pas en charge PostgreSQL. |
| `db_name` | `castopod` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `castopod` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Sonde de démarrage TCP sur le port du conteneur ; la fenêtre de 20 tentatives couvre les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 300s | Sonde de vivacité sur la page d'accueil non authentifiée de Castopod (renvoie 200 une fois démarrée). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Bascule le cache d'objets de Castopod vers Redis ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `media`). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Castopod ne fonctionne qu'avec MySQL ; tout autre moteur empêche le démarrage et les migrations. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base et l'utilisateur et détruit toutes les données des podcasts. |
| `enable_nfs` | `true` | Critical | Sans NFS, l'audio et les illustrations des épisodes téléversés résident sur un disque éphémère et sont perdus à chaque redémarrage ou redéploiement. |
| `CP_ANALYTICS_SALT` (généré automatiquement) | Ne pas modifier après le premier démarrage | High | Le modifier rompt la continuité de la déduplication des auditeurs pour les statistiques déjà enregistrées. |
| `max_instance_count` | `1` sauf si l'état partagé est confirmé | High | Dépasser 1 sans système de fichiers de médias et cache partagés entraîne des médias et un cache incohérents entre les instances. |
| `memory_limit` | `2Gi` | High | En dessous de 512Mi, Castopod (PHP 8) ne démarre pas ; les grandes médiathèques nécessitent davantage de marge. |
| `ingress_settings` | `all` | High | `internal` bloque l'accès public au flux du podcast et aux médias. |
| `enable_iap` | uniquement pour les instances privées | High | IAP bloque tout accès non authentifié, y compris les flux RSS publics et les téléchargements de médias. |
| `CP_BASEURL` (dérivé automatiquement) | URL réelle du service | High | Une URL de base erronée produit des liens de flux et de médias cassés ; le point d'entrée la dérive de `CLOUDRUN_SERVICE_URL`. |
| `min_instance_count` | `1` en production | Medium | La mise à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_cloud_armor` | à activer en production | Medium | L'interface publique et l'administration sont accessibles sans protection WAF. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Castopod, partagée
avec la variante GKE, est décrite dans **[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Castopod sur Cloud Run](../labs/Castopod_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Castopod sur GKE Autopilot](Castopod_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Castopod Common — Configuration applicative partagée](Castopod_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Creator & Media Publishing**.
