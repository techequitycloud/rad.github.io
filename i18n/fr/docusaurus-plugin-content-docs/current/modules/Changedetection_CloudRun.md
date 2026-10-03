---
title: "Changedetection sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Changedetection sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Changedetection_CloudRun.md @ 15fd4c7 sha256:5385999873f4 -->

# Changedetection sur Google Cloud Run {#changedetection-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_CloudRun.png" alt="Changedetection sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io est un service open source auto-hébergé qui surveille les pages web
pour détecter les changements et envoie des notifications lorsqu'ils se produisent. Ce
module déploie changedetection.io sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par changedetection.io et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud et de
la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, scaling et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

changedetection.io s'exécute comme un conteneur Python/Flask unique sur Cloud Run v2.
Le déploiement relie un ensemble délibérément restreint de services Google Cloud — il
n'y a pas de base de données et pas de cache :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Service Python/Flask, 1 vCPU / 1 GiB par défaut, écoute sur le port 5000 |
| Base de données | _Aucune_ | `database_type = NONE` — changedetection.io stocke tout l'état sur disque, pas en SQL |
| Datastore persistant | Cloud Storage (GCS FUSE) | Un bucket de données monté à `/datastore` contenant la configuration de surveillance, les instantanés et l'historique |
| Cache et file d'attente | _Aucun_ | Redis n'est pas utilisé ; explicitement désactivé |
| Secrets | Secret Manager | Aucun secret d'application n'est injecté ; le jeton de l'API REST est créé dans l'interface web |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données, pas de Redis.** changedetection.io est entièrement
  autonome. Il n'y a pas d'instance Cloud SQL, pas de job `db-init` et pas d'étape de
  migration de schéma. Redis est désactivé (`enable_redis = false`) et `enable_cloudsql_volume = false`.
- **Tout l'état réside dans un seul bucket GCS.** Le bucket de datastore est monté à
  `/datastore` via GCS FUSE (`enable_gcs_storage_volume = true`, nécessite l'environnement
  d'exécution gen2). La suppression ou la recréation de ce bucket entraîne la perte de
  chaque surveillance et de son historique.
- **Instance unique par défaut.** `min_instance_count = 1` et `max_instance_count = 1`.
  changedetection.io exécute son planificateur de récupération en cours de processus
  par rapport à un seul datastore sur disque ; l'exécution de plusieurs instances par
  rapport au même datastore monté en FUSE risque une corruption par écriture
  simultanée. Gardez `max_instance_count = 1`.
- **`min_instance_count = 1` (pas de mise à l'échelle à zéro).** L'instance unique est maintenue
  active afin que le planificateur de récupération continue d'exécuter les vérifications
  de surveillance même sans trafic web entrant. Le CPU reste basé sur les requêtes
  (`cpu_always_allocated = false`), ce qui est suffisant pour les vérifications HTTP simples ;
  définissez-le sur `true` pour les récupérations de navigateur/Playwright ou les
  filtres lourds.
- **Ingress public par défaut.** `ingress_settings = "all"` afin que le tableau de bord web soit
  accessible depuis un navigateur. L'interface utilisateur est livrée **sans
  connexion** — définissez un mot de passe dans **Settings → General**
  immédiatement, et/ou activez IAP.
- **`BASE_URL` est injecté automatiquement.** L'URL de service Cloud Run prédite est
  injectée sous `BASE_URL` (`service_url_env_var_name = "BASE_URL"`) afin que les liens de
  notification se résolvent à l'adresse de service réelle.
- **Épinglage de version.** Avec `application_version = "latest"`, la build de l'image épingle un tag
  connu et fonctionnel (`0.50.19`) via l'argument de build spécifique à l'application
  `CHANGEDETECTION_VERSION`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service changedetection.io {#a-cloud-run--the-changedetectionio-service}

changedetection.io s'exécute comme un service Cloud Run v2 écoutant sur le port 5000.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs. Étant donné que le planificateur de récupération
s'exécute en cours de processus, le service est normalement épinglé à une seule
instance toujours active.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Base de données — non utilisée {#b-database--not-used}

changedetection.io n'utilise **aucune base de données SQL**. `database_type = NONE` est fixé par
[Changedetection_Common](Changedetection_Common.md) ; aucune instance Cloud SQL n'est
créée et il n'y a pas de job d'initialisation `db-init`. Tout l'état persistant réside
dans le bucket de datastore GCS décrit ci-dessous.

### C. Cloud Storage — le datastore {#c-cloud-storage--the-datastore}

Un seul bucket **Cloud Storage** est provisionné automatiquement et monté à
`/datastore` en tant que volume **GCS FUSE** (`DATASTORE_PATH = /datastore`). Il contient la
configuration de surveillance JSON, les instantanés de page et l'historique des
modifications — tout ce que l'application persiste.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<data-bucket>/url-watches.json
  ```

GCS FUSE nécessite l'environnement d'exécution gen2 (le défaut). Voir
[App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### D. Cache et file d'attente — non utilisés {#d-cache--queue--not-used}

changedetection.io n'utilise pas Redis ni aucune file d'attente externe ; son
planificateur de surveillance est en cours de processus. `enable_redis = false` est défini
explicitement et aucune entrée Redis n'est câblée.

### E. Secret Manager {#e-secret-manager}

Aucun secret d'application n'est injecté dans le conteneur — le jeton d'API REST
optionnel est généré dans l'interface web (**Settings → API**), et le datastore
n'utilise pas de clé de chiffrement. Secret Manager est toujours disponible pour tout
`secret_environment_variables` fourni par l'opérateur.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`), ce qui
permet un accès public au tableau de bord via un navigateur. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés ; les paramètres d'ingress et le contrôle d'égresse VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL de service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte optionnels.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application changedetection.io {#3-changedetectionio-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de
  base de données et pas de job d'initialisation. Au premier démarrage,
  changedetection.io crée ses fichiers de datastore (`url-watches.json` et les répertoires
  d'historique par surveillance) sous `/datastore` s'ils n'existent pas déjà.
- **Pas de migrations de schéma.** Les mises à niveau du format du datastore sont
  gérées en interne par l'application au démarrage ; il n'y a pas d'étape de migration
  distincte à exécuter.
- **Le datastore est le seul actif avec état.** Tout ce dont l'application se souvient
  — surveillances, instantanés, historique des différences, configuration des
  notifications et tout mot de passe d'interface utilisateur — réside dans le bucket de
  datastore GCS. Protégez-le en conséquence ; la recréation du bucket efface tout
  l'état.
- **Pas de connexion par défaut.** Le tableau de bord est livré ouvert. Définissez un
  mot de passe sous **Settings → General → Password** immédiatement après le premier
  accès, et/ou activez IAP devant le service. Il n'y a pas de compte administrateur ou
  de credential par défaut.
- **Le jeton de l'API REST est créé dans l'interface utilisateur.** Pour utiliser
  l'API REST, générez un jeton sous **Settings → API** et transmettez-le comme en-tête
  `x-api-key`. Il n'est pas injecté via une variable d'environnement.
- **`BASE_URL` pour les liens de notification.** L'URL de service prédite est injectée
  sous `BASE_URL` afin que les corps de notification contiennent des liens absolus
  fonctionnels. Vérifiez qu'elle correspond à l'URL de service réelle après le
  déploiement :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` —
  l'interface web, qui renvoie HTTP 200 une fois que le serveur Flask est prêt. Le
  premier démarrage est rapide (pas de migrations) ; la sonde de démarrage par défaut
  permet un délai initial de 15 secondes plus une fenêtre de 10 tentatives.
- **Contrainte de scaling.** Gardez `max_instance_count = 1`. Plusieurs instances partagent le même
  datastore monté en FUSE et entreraient en concurrence sur les écritures ; l'application
  n'a pas de coordination distribuée.
- **Inspecter l'environnement d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour changedetection.io sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `changedetection` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Changedetection.io` | Nom lisible par l'homme affiché dans la console. |
| `description` | `changedetection.io — self-hosted website change detection and monitoring/notification service` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image. `latest` épingle la build à `0.50.19` via `CHANGEDETECTION_VERSION` ; épinglez explicitement pour des déploiements reproductibles. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance (le plancher gen2 est de 512Mi). |
| `min_instance_count` | `1` | Maintient une instance active afin que le planificateur de récupération continue de fonctionner. |
| `cpu_always_allocated` | `false` | Le CPU basé sur les requêtes est suffisant pour les vérifications légères du planificateur intégré. Définissez `true` lorsque les surveillances utilisent le récupérateur de navigateur/Playwright ou des filtres lourds, qui sont sinon limités entre les requêtes. |
| `max_instance_count` | `1` | **Gardez à 1** — plusieurs instances entrent en concurrence sur le datastore partagé. |
| `container_port` | `5000` | changedetection.io écoute sur le port 5000. |
| `execution_environment` | `gen2` | Requis pour le montage du datastore GCS FUSE. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — le sidecar Auth Proxy n'est pas nécessaire. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image changedetection.io dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public au tableau de bord via un navigateur. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant le tableau de bord (recommandé — l'application n'a pas de connexion par défaut). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `FETCH_WORKERS`, `PLAYWRIGHT_DRIVER_URL`). `DATASTORE_PATH` et `BASE_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). Puisqu'il n'y a pas de base de données, sauvegardez le bucket de datastore. |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS (corrige également `BASE_URL`). |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket GCS du datastore. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de datastore auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé ; le datastore utilise GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (lorsque NFS est activé). |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Changedetection_Common ; changedetection.io n'a pas de base de données SQL. |
| `service_url_env_var_name` | `BASE_URL` | Nom de la variable d'environnement pour l'URL de service injectée. changedetection.io lit `BASE_URL` pour les liens de notification. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation intégré — changedetection.io ne nécessite pas de bootstrap. Fournir uniquement pour le chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs planifiés par la plateforme (changedetection.io planifie ses propres vérifications de surveillance en interne). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s de délai | Sonde de démarrage contre l'interface web. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité contre l'interface web. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Règles d'alerte métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 23 — VPC Service Controls et Audit Logging {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `changedetection_url` | URL du service pour le tableau de bord changedetection.io / API REST (port 5000). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de datastore). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un runtime `gen1` avec des montages GCS FUSE, un `backup_retention_days` hors plage, `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket GCS du datastore | Ne jamais supprimer/recréer | Critique | Le bucket contient chaque surveillance, instantané et entrée d'historique — le supprimer entraîne la perte permanente de tout l'état de surveillance. |
| `max_instance_count` | `1` | Critique | Plusieurs instances écrivent simultanément dans le même datastore monté en FUSE et corrompent `url-watches.json` ; l'application n'a pas de verrouillage distribué. |
| Mot de passe de l'interface web | Définir immédiatement | Élevé | Le tableau de bord est livré **sans connexion** ; le laisser ouvert sur un ingress public expose toutes les surveillances et la configuration des notifications à quiconque ayant l'URL. |
| `application_name` | Définir une fois | Élevé | Immuable après le premier déploiement ; le renommage recrée le bucket de datastore et orpheline les données existantes. |
| `enable_gcs_storage_volume` / montage du datastore | Garder activé | Élevé | Sans le montage `/datastore`, l'état est écrit sur le disque de conteneur éphémère et perdu à chaque révision/redémarrage. |
| `execution_environment` | `gen2` | Élevé | GCS FUSE nécessite gen2 ; `gen1` ne peut pas monter le bucket de datastore (bloqué au moment de la planification). |
| `ingress_settings` | `all` (ou IAP) | Élevé | Ingress public + pas de connexion = tableau de bord ouvert. Associez `all` à un mot de passe d'interface utilisateur ou à IAP ; `internal` bloque entièrement l'accès au navigateur. |
| `service_url_env_var_name` / `BASE_URL` | URL de service réelle | Moyen | Un `BASE_URL` erroné produit des liens absolus cassés dans les notifications de changement. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) arrête le planificateur de récupération en cours de processus lorsqu'il est inactif, de sorte que les surveillances ne sont pas vérifiées avant la prochaine requête entrante. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | Faible | changedetection.io n'a pas de base de données ; l'activation du câblage Cloud SQL provisionne une infrastructure inutilisée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité de la sauvegarde du datastore. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
scaling et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
changedetection.io partagée avec la variante GKE est décrite dans
**[Changedetection_Common](Changedetection_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Changedetection sur Cloud Run](../labs/Changedetection_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Changedetection sur GKE Autopilot](Changedetection_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Changedetection Common — Configuration d'application partagée](Changedetection_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Umami sur Google Cloud Run](Umami_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Analyse web axée sur la confidentialité**.
