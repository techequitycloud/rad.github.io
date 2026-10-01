---
title: "Dolibarr sur Google Cloud Run"
description: "Référence de configuration pour déployer Dolibarr sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Dolibarr_CloudRun.md @ 3055034 sha256:2cbc6267663c -->

# Dolibarr sur Google Cloud Run {#dolibarr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_CloudRun.png" alt="Dolibarr sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open source couvrant les clients et
prospects, les devis, les commandes, les factures, les produits et les stocks, les RH,
les projets et la comptabilité au moyen d'une interface web PHP modulaire. Ce module
déploie Dolibarr sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Dolibarr et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dolibarr s'exécute comme un conteneur PHP/Apache unique sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDF téléversés persistent sous `/var/lib/dolibarr` d'un redémarrage à l'autre |
| Stockage objet | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`database_type = MYSQL_8_0`) ; les autres moteurs ne sont pas
  pris en charge.
- **Cloud SQL est joint en TCP sur l'IP privée.** Sur Cloud Run, cette variante définit
  par défaut `enable_cloudsql_volume = false` ; Dolibarr et le job `db-init` se
  connectent donc à l'IP privée de l'instance sur le port 3306 (Cloud SQL MySQL 8
  utilise `caching_sha2_password`, pris en charge par le job d'initialisation).
- **Instance unique par défaut.** `max_instance_count = 1`. Dolibarr conserve un état
  de session et de verrouillage qui n'est pas sûr en multi-instance sans stockage
  partagé et routage persistant (sticky) — n'augmentez pas `max_instance_count`
  au-delà de 1 sans l'avoir vérifié au préalable.
- **La mise à zéro est activée** (`min_instance_count = 0`). Les démarrages à froid
  ajoutent quelques secondes, plus le démarrage de PHP/Apache, à la première requête
  après une période d'inactivité ; définissez `min_instance_count = 1` pour un service
  toujours prêt.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/var/lib/dolibarr`)
  afin que les documents téléversés et les PDF générés survivent à la recréation du
  conteneur.
- **Installation automatique au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait
  créer le schéma par l'installateur Dolibarr au premier démarrage ; il n'y a pas de
  job de migration distinct.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur sert à créer le compte
  super-administrateur initial (nom d'utilisateur `DOLI_ADMIN_LOGIN`, `admin` par
  défaut).
- **`DOLI_URL_ROOT` est défini à partir de l'URL prévue du service** au moment du plan,
  afin que les liens absolus et les redirections de connexion pointent vers l'adresse
  Cloud Run réelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Dolibarr {#a-cloud-run--the-dolibarr-service}

Dolibarr s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dolibarr"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données applicatives (tiers, factures, produits,
utilisateurs, comptabilité) dans une instance Cloud SQL for MySQL 8.0 gérée. Avec la
valeur par défaut de Cloud Run `enable_cloudsql_volume = false`, le service se connecte
en **TCP à l'IP privée de l'instance** sur le port 3306 ; aucune IP publique n'est
exposée. Au premier déploiement, le job `db-init` crée la base de données applicative,
l'utilisateur et les droits ; l'installateur Dolibarr crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`, injecté par la couche
Common) est provisionné automatiquement, en plus du bucket standard de suffixe `data`
issu de `storage_buckets`. Par ailleurs, l'arborescence documentaire de Dolibarr réside
sur **NFS** dans `/var/lib/dolibarr`, afin que les fichiers téléversés et les PDF
générés survivent à la recréation du conteneur.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe du super-administrateur initial) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité propre à l'instance). Le mot de passe de
la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et
des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte à Cloud SQL (IP privée
  en TCP sur Cloud Run), crée de manière idempotente la base de données applicative,
  l'utilisateur et les droits, vérifie que l'utilisateur applicatif peut se connecter,
  puis arrête le sidecar Auth Proxy. Le job peut être relancé sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration distinct).**
  Avec `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au
  premier démarrage du conteneur et crée le schéma dans la base vide. Lors des montées
  de version, l'image applique ses propres étapes de mise à niveau au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom
  d'utilisateur est `DOLI_ADMIN_LOGIN` (`admin` par défaut) et dont le mot de passe est
  le secret généré `DOLI_ADMIN_PASSWORD`. Récupérez-le avant la première connexion.
- **Alias des variables d'environnement de la base.** La plateforme injecte les
  variables standard `DB_*` ; Dolibarr lit `DOLI_DB_*`. L'entrypoint du wrapper crée
  ces alias à l'exécution et privilégie les valeurs `DB_*` injectées par rapport aux
  valeurs par défaut `mysql`/`dolidb` intégrées à l'image — sans quoi le conteneur
  attend indéfiniment un hôte inexistant.
- **Chemin de santé.** La sonde de démarrage est en **TCP** sur le port 80 ; la sonde
  de vivacité est en **HTTP** `GET /` (la page de connexion renvoie 200 sans
  authentification). Prévoyez plusieurs minutes au premier démarrage pour
  l'installateur avant que la page de connexion soit servie.
- **`DOLI_INSTANCE_UNIQUE_ID` est un sel stable.** Gardez-le constant pendant toute la
  durée de vie du déploiement ; il sert aux URL cron et à la signature des jetons.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION" --filter="metadata.name~dolibarr"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Dolibarr ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `dolibarr/dolibarr` utilisée comme base du build personnalisé ; `latest` est épinglé sur un tag éprouvé (`23.0.3`) au moment du build. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour des modules lourds ou de grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement / de POST ; gardez `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Dolibarr est livré sous forme de build personnalisé léger ; gardez `custom`. |
| `cpu_limit` | `1000m` | 1 vCPU minimum pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandés en production. |
| `min_instance_count` | `0` | Mise à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Gardez 1**, sauf si le partage multi-instance a été vérifié. |
| `container_port` | `80` | Dolibarr s'exécute sur Apache, port 80. |
| `enable_cloudsql_volume` | `false` | `false` = connexion TCP sur IP privée (valeur par défaut de Cloud Run). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les documents téléversés persistent. |
| `nfs_mount_path` | `/var/lib/dolibarr` | Emplacement où Dolibarr stocke les documents/PDF. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket supplémentaire en plus du bucket `dolibarr-documents` provisionné automatiquement, que la couche Common injecte via `module_storage_buckets`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur fixe — Dolibarr exige MySQL. |
| `db_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `dolibarr` | Utilisateur applicatif de la base ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 80, délai de 30s, 20 tentatives | Il suffit que l'écouteur Apache soit lié. |
| `liveness_probe` | HTTP `/` délai de 300s | La page de connexion renvoie 200 sans authentification. |
| `uptime_check_config` | désactivé (`path = "/"`) | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache d'objets facultatif ; désactivé par défaut. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis lorsqu'il est activé. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
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
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `container_port` invalide, un `timeout_seconds`/`backup_retention_days` hors limites, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Choisir un moteur autre que MySQL casse l'installateur et toutes les requêtes. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `DOLI_INSTANCE_UNIQUE_ID` (généré automatiquement) | Ne jamais le modifier | Critique | Modifier le sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les documents/PDF téléversés éphémères — perdus à chaque recréation du conteneur. |
| `max_instance_count` | `1` | Élevé | L'augmenter sans stockage partagé ni routage persistant (sticky) expose à des sessions scindées, à de la contention de verrous et à un état documentaire incohérent. |
| `enable_backup_import` | `false` sauf pour une restauration | Élevé | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `DOLI_URL_ROOT` (défini automatiquement) | URL réelle du service | Élevé | Une URL racine erronée casse les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512Mi, le conteneur PHP/Apache subit un OOM sous charge ; gen2 impose un plancher de 512Mi. |
| `DOLI_ADMIN_PASSWORD` (généré automatiquement) | Le récupérer avant la première connexion | Moyen | Sans lui, vous ne pouvez pas accéder au premier compte super-administrateur tant qu'il n'est pas réinitialisé via la base. |
| `ingress_settings` | `all` | Moyen | `internal` bloque l'accès public à l'interface Dolibarr. |
| `min_instance_count` | `1` en production | Moyen | La mise à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface est accessible publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Dolibarr,
partagée avec la variante GKE, est décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur Cloud Run](../labs/Dolibarr_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Dolibarr sur GKE Autopilot](Dolibarr_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration applicative partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) et [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
