---
title: "Changedetection sur Google Cloud Run"
description: "Référence de configuration pour déployer Changedetection sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Changedetection_CloudRun.md @ 3055034 sha256:4ed3ccd1fbfc -->

# Changedetection sur Google Cloud Run {#changedetection-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_CloudRun.png" alt="Changedetection sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io est un service open source auto-hébergé qui surveille les modifications
de pages web et envoie des notifications lorsqu'elles se produisent. Ce module déploie
changedetection.io sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise changedetection.io et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

changedetection.io s'exécute comme un conteneur Python/Flask unique sur Cloud Run v2. Le
déploiement assemble un ensemble volontairement réduit de services Google Cloud — il n'y a ni
base de données ni cache :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Flask, 1 vCPU / 1 GiB par défaut, à l'écoute sur le port 5000 |
| Base de données | _Aucune_ | `database_type = NONE` — changedetection.io stocke tout son état sur disque, et non en SQL |
| Stockage de données persistant | Cloud Storage (GCS FUSE) | Un bucket de données monté sur `/datastore`, contenant la configuration des surveillances, les instantanés et l'historique |
| Cache et file d'attente | _Aucun_ | Redis n'est pas utilisé ; il est explicitement désactivé |
| Secrets | Secret Manager | Aucun secret d'application n'est injecté ; le jeton de l'API REST est créé dans l'interface web |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ni base de données, ni Redis.** changedetection.io est entièrement autonome. Il n'y a ni
  instance Cloud SQL, ni job `db-init`, ni étape de migration de schéma. Redis est désactivé
  (`enable_redis = false`) et `enable_cloudsql_volume = false`.
- **Tout l'état réside dans un seul bucket GCS.** Le bucket du stockage de données est monté
  sur `/datastore` via GCS FUSE (`enable_gcs_storage_volume = true`, ce qui nécessite
  l'environnement d'exécution gen2). Supprimer ou recréer ce bucket fait perdre toutes les
  surveillances et leur historique.
- **Instance unique par défaut.** `min_instance_count = 1` et `max_instance_count = 1`.
  changedetection.io exécute son planificateur de récupération dans le processus, sur un
  stockage de données unique sur disque ; exécuter plus d'une instance sur le même stockage
  monté via FUSE expose à une corruption par écritures concurrentes. Conservez
  `max_instance_count = 1`.
- **`min_instance_count = 1` (pas de mise à zéro).** L'instance unique reste active afin que
  le planificateur de récupération continue d'exécuter les vérifications de surveillance, même
  en l'absence de trafic web entrant.
- **Ingress public par défaut.** `ingress_settings = "all"`, afin que le tableau de bord web
  soit accessible depuis un navigateur. L'interface est livrée **sans authentification** —
  définissez immédiatement un mot de passe dans **Settings → General**, et/ou activez IAP.
- **`BASE_URL` est injectée automatiquement.** L'URL prévue du service Cloud Run est injectée
  sous `BASE_URL` (`service_url_env_var_name = "BASE_URL"`), de sorte que les liens des
  notifications pointent vers l'adresse réelle du service.
- **Épinglage de version.** Avec `application_version = "latest"`, le build de l'image épingle
  un tag connu pour fonctionner (`0.50.19`) via l'argument de build propre à l'application
  `CHANGEDETECTION_VERSION`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et
des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service changedetection.io {#a-cloud-run--the-changedetectionio-service}

changedetection.io s'exécute comme un service Cloud Run v2 à l'écoute sur le port 5000.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs. Comme le planificateur de récupération
s'exécute dans le processus, le service est normalement limité à une seule instance toujours
active.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Base de données — non utilisée {#b-database--not-used}

changedetection.io n'utilise **aucune base de données SQL**. `database_type = NONE` est fixé
par [Changedetection_Common](Changedetection_Common.md) ; aucune instance Cloud SQL n'est
créée et il n'y a pas de job d'initialisation `db-init`. Tout l'état persistant réside dans le
bucket GCS du stockage de données décrit ci-dessous.

### C. Cloud Storage — le stockage de données {#c-cloud-storage--the-datastore}

Un bucket **Cloud Storage** unique est provisionné automatiquement et monté sur `/datastore`
en tant que volume **GCS FUSE** (`DATASTORE_PATH = /datastore`). Il contient le JSON de
configuration des surveillances, les instantanés de pages et l'historique des modifications —
tout ce que l'application conserve.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<data-bucket>/url-watches.json
  ```

GCS FUSE nécessite l'environnement d'exécution gen2 (la valeur par défaut). Consultez
[App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### D. Cache et file d'attente — non utilisés {#d-cache--queue--not-used}

changedetection.io n'utilise ni Redis ni aucune file d'attente externe ; son planificateur de
surveillances s'exécute dans le processus. `enable_redis = false` est défini explicitement et
aucune entrée Redis n'est raccordée.

### E. Secret Manager {#e-secret-manager}

Aucun secret d'application n'est injecté dans le conteneur — le jeton facultatif de l'API REST
est généré dans l'interface web (**Settings → API**), et le stockage de données n'utilise
aucune clé de chiffrement. Secret Manager reste disponible pour les éventuelles
`secret_environment_variables` fournies par l'opérateur.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings = "all"`), ce qui
permet un accès public au tableau de bord depuis un navigateur. Un équilibreur de charge HTTPS
externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres
d'ingress et le contrôle de sortie VPC régissent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de Cloud Run vers
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application changedetection.io {#3-changedetectionio-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni base de
  données ni job d'initialisation. Au premier démarrage, changedetection.io crée ses fichiers
  de stockage (`url-watches.json` et les répertoires d'historique par surveillance) sous
  `/datastore` s'ils n'existent pas déjà.
- **Aucune migration de schéma.** Les mises à niveau du format du stockage de données sont
  gérées en interne par l'application au démarrage ; il n'y a aucune étape de migration
  distincte à exécuter.
- **Le stockage de données est le seul élément avec état.** Tout ce que l'application conserve
  — surveillances, instantanés, historique des différences, configuration des notifications et
  éventuel mot de passe de l'interface — réside dans le bucket GCS du stockage de données.
  Protégez-le en conséquence ; recréer le bucket efface tout l'état.
- **Aucune authentification par défaut.** Le tableau de bord est livré ouvert. Définissez un
  mot de passe sous **Settings → General → Password** immédiatement après le premier accès,
  et/ou activez IAP devant le service. Il n'existe ni compte administrateur ni identifiant par
  défaut.
- **Le jeton de l'API REST est créé dans l'interface.** Pour utiliser l'API REST, générez un
  jeton sous **Settings → API** et transmettez-le dans l'en-tête `x-api-key`. Il n'est pas
  injecté via une variable d'environnement.
- **`BASE_URL` pour les liens des notifications.** L'URL prévue du service est injectée sous
  `BASE_URL`, afin que le corps des notifications contienne des liens absolus fonctionnels.
  Vérifiez qu'elle correspond à l'URL réelle du service après le déploiement :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — l'interface web,
  qui renvoie HTTP 200 dès que le serveur Flask est prêt. Le premier démarrage est rapide (pas
  de migrations) ; la sonde de démarrage par défaut prévoit un délai initial de 15 secondes
  plus une fenêtre de 10 tentatives.
- **Contrainte de mise à l'échelle.** Conservez `max_instance_count = 1`. Plusieurs instances
  partageraient le même stockage de données monté via FUSE et entreraient en concurrence lors
  des écritures ; l'application ne dispose d'aucune coordination distribuée.
- **Inspecter l'environnement en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à changedetection.io ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `changedetection` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Changedetection.io` | Nom lisible affiché dans la console. |
| `description` | `changedetection.io — self-hosted website change detection and monitoring/notification service` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image. `latest` épingle le build sur `0.50.19` via `CHANGEDETECTION_VERSION` ; épinglez explicitement pour des déploiements reproductibles. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance (le plancher de gen2 est de 512Mi). |
| `min_instance_count` | `1` | Maintient une instance active pour que le planificateur de récupération continue de tourner. |
| `max_instance_count` | `1` | **Conservez 1** — plusieurs instances entrent en concurrence sur le stockage de données partagé. |
| `container_port` | `5000` | changedetection.io écoute sur le port 5000. |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE du stockage de données. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — le sidecar Auth Proxy n'est pas nécessaire. |
| `enable_image_mirroring` | `true` | Met en miroir l'image changedetection.io dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public au tableau de bord depuis un navigateur. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant le tableau de bord (recommandé — l'application n'a pas d'authentification par défaut). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `FETCH_WORKERS`, `PLAYWRIGHT_DRIVER_URL`). `DATASTORE_PATH` et `BASE_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). Comme il n'y a pas de base de données, sauvegardez le bucket du stockage de données. |
| `backup_retention_days` | `7` | Durée de conservation ; à augmenter pour la production et la conformité. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS (corrige aussi `BASE_URL`). |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS du stockage de données. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires, en plus du bucket de stockage de données provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé ; le stockage de données utilise GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (lorsque NFS est activé). |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Changedetection_Common ; changedetection.io n'a pas de base de données SQL. |
| `service_url_env_var_name` | `BASE_URL` | Nom de la variable d'environnement pour l'URL de service injectée. changedetection.io lit `BASE_URL` pour les liens des notifications. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation intégré — changedetection.io ne nécessite aucun amorçage. À fournir uniquement pour un chargement de données personnalisé. |
| `cron_jobs` | `[]` | Jobs facultatifs planifiés par la plateforme (changedetection.io planifie lui-même ses vérifications de surveillance en interne). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 15s | Sonde de démarrage sur l'interface web. |
| `liveness_probe` | HTTP `/`, délai de 30s | Sonde de vivacité sur l'interface web. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `changedetection_url` | URL du service pour le tableau de bord / l'API REST de changedetection.io (port 5000). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket du stockage de données). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide par défaut). |
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

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages GCS FUSE, un `backup_retention_days` hors plage, `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket GCS du stockage de données | Ne jamais supprimer ni recréer | Critical | Le bucket contient chaque surveillance, chaque instantané et chaque entrée d'historique — le supprimer fait perdre définitivement tout l'état de surveillance. |
| `max_instance_count` | `1` | Critical | Plusieurs instances écrivent simultanément dans le même stockage de données monté via FUSE et corrompent `url-watches.json` ; l'application n'a pas de verrouillage distribué. |
| Mot de passe de l'interface web | À définir immédiatement | High | Le tableau de bord est livré **sans authentification** ; le laisser ouvert avec un ingress public expose toutes les surveillances et la configuration des notifications à quiconque possède l'URL. |
| `application_name` | À définir une seule fois | High | Immuable après le premier déploiement ; le renommer recrée le bucket du stockage de données et rend orphelines les données existantes. |
| `enable_gcs_storage_volume` / montage du stockage de données | À laisser activé | High | Sans le montage `/datastore`, l'état est écrit sur le disque éphémère du conteneur et perdu à chaque révision ou redémarrage. |
| `execution_environment` | `gen2` | High | GCS FUSE nécessite gen2 ; `gen1` ne peut pas monter le bucket du stockage de données (bloqué au moment du plan). |
| `ingress_settings` | `all` (ou IAP) | High | Ingress public + aucune authentification = tableau de bord ouvert. Associez `all` à un mot de passe dans l'interface ou à IAP ; `internal` bloque entièrement l'accès depuis un navigateur. |
| `service_url_env_var_name` / `BASE_URL` | URL réelle du service | Medium | Une `BASE_URL` erronée produit des liens absolus cassés dans les notifications de modification. |
| `min_instance_count` | `1` | Medium | La mise à zéro (`0`) arrête le planificateur de récupération intégré pendant l'inactivité ; les surveillances ne sont donc pas vérifiées avant la requête entrante suivante. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | Low | changedetection.io n'a pas de base de données ; activer le raccordement Cloud SQL provisionne une infrastructure inutilisée. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires de la sauvegarde du stockage de données. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
changedetection.io, partagée avec la variante GKE, est décrite dans
**[Changedetection_Common](Changedetection_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Changedetection sur Cloud Run](../labs/Changedetection_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Changedetection sur GKE Autopilot](Changedetection_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Changedetection Common — Configuration applicative partagée](Changedetection_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Umami sur Google Cloud Run](Umami_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Privacy-first Web Analytics**.
