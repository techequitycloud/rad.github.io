---
title: "Wallos sur Google Cloud Run"
description: "Référence de configuration pour déployer Wallos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wallos_CloudRun.md @ 3055034 sha256:391ddf2ba6de -->

# Wallos sur Google Cloud Run {#wallos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallos_CloudRun.png" alt="Wallos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallos est un outil open source et auto-hébergé de suivi des abonnements et des
dépenses récurrentes, construit en PHP 8.3 pur + php-fpm (sans framework MVC). Il
suit les abonnements récurrents, convertit les prix entre devises, envoie des
notifications de renouvellement et prend en charge un mode multi-utilisateur pour
le foyer. Ce module déploie Wallos sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Wallos et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallos s'exécute comme un conteneur PHP unique sur Cloud Run v2. Il est
volontairement minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — mais il exécute BIEN un véritable démon cron toujours actif, ce qui
détermine plusieurs des valeurs par défaut ci-dessous :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/php-fpm unique, 1 vCPU / 1 GiB par défaut ; `min = max = 1`, `cpu_always_allocated = true` |
| État persistant | NFS + Cloud Storage (GCS FUSE) | Le répertoire SQLite `/var/www/html/db` est servi depuis **NFS** (`enable_nfs = true`) — GCS FUSE ne peut pas fournir les verrous POSIX dont SQLite a besoin ; le bucket `uploads` est monté via GCS FUSE sur `/var/www/html/images/uploads/logos` (logos de fournisseurs personnalisés) |
| Base de données | Aucune (SQLite embarqué) | `database_type = NONE` ; aucun Cloud SQL n'est provisionné ; il est confirmé qu'aucune prise en charge de MySQL/Postgres n'existe dans l'application |
| Cache et file d'attente | Aucun | Wallos n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret applicatif généré ; les utilisateurs résident dans la base SQLite |
| Entrée | URL Cloud Run / Cloud Load Balancing | L'entrée par défaut est **`all`** — le service est joignable publiquement dès l'installation |
| Jobs en arrière-plan | Démon cron dans le conteneur | 8 tâches planifiées intégrées (actualisation des taux de change, notifications de renouvellement, une interrogation de vérification d'e-mail toutes les 2 minutes, etc.) — non modélisées comme un Cloud Run Job ; elles s'exécutent en continu dans le conteneur principal |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'état réside sur deux volumes distincts.**
  Wallos n'a pas de base de données Cloud SQL. Ses abonnements, catégories,
  paramètres et utilisateurs sont stockés dans `/var/www/html/db/wallos.db`, monté
  depuis **NFS** (`enable_nfs = true`, `nfs_mount_path = "/var/www/html/db"`,
  `enable_gcs_db_volume = false`) ; les logos de fournisseurs personnalisés
  téléversés par les utilisateurs résident dans `/var/www/html/images/uploads/logos`
  (GCS FUSE, bucket `uploads`).
  Les deux chemins sont fixes — aucune variable d'environnement ne permet de les
  déplacer. Perdre ou effacer l'un ou l'autre volume fait perdre cet état.
- **CRITIQUE — instance unique toujours active, pas un simple réglage contre les démarrages à froid.**
  `min_instance_count = max_instance_count = 1` **et** `cpu_always_allocated =
  true`. C'est une contrainte plus forte que le schéma habituel « éviter les
  démarrages à froid » : la base SQLite de Wallos ne prend pas en charge plusieurs
  écrivains (d'où l'obligation de `max = 1`), et son démon cron intégré ne
  déclenche les tâches planifiées que lorsqu'une instance s'exécute effectivement
  avec du CPU alloué (d'où l'obligation de `min = 1` et de `cpu_always_allocated =
  true`). La mise à zéro arrête silencieusement toutes les tâches planifiées sans
  aucune erreur — les notifications de renouvellement cessent simplement d'arriver.
- **L'identifiant par défaut est `admin` / `admin`.** Wallos crée cet identifiant
  au premier démarrage. Modifiez-le dans l'interface web immédiatement après le
  déploiement.
- **L'entrée vaut `all` (publique) par défaut.** Le service est joignable depuis
  l'internet public dès l'installation. Pour le restreindre, définissez
  `ingress_settings = "internal"` (VPC uniquement) ou
  `internal-and-cloud-load-balancing`, ou placez-le derrière l'équilibreur de
  charge HTTPS (`enable_cloud_armor = true` + `application_domains`).
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun
  job `db-init` ne s'exécute ; l'application est prête dès que le conteneur
  démarre.
- **Port du conteneur 80.** Wallos sert du HTTP/1.1 simple sur le port 80
  (`container_protocol = http1`).
- **Image précompilée.** `bellamy/wallos` est une véritable image étiquetée
  « latest », maintenue par un tiers (il n'existe pas d'image officielle du projet
  Wallos) ; aucun Dockerfile ni aucune étape Cloud Build n'est utilisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Wallos {#a-cloud-run--the-wallos-service}

Wallos s'exécute comme un service Cloud Run v2 limité à une instance unique, avec
CPU toujours alloué. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~wallos"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. NFS et Cloud Storage — état persistant {#b-nfs-and-cloud-storage--persistent-state}

Wallos n'a pas de base de données Cloud SQL. Sa base SQLite embarquée
(`/var/www/html/db/wallos.db`) est servie depuis le volume **NFS** partagé, tandis
que les logos de fournisseurs téléversés par les utilisateurs
(`/var/www/html/images/uploads/logos`) résident dans un bucket Cloud Storage monté
dans le conteneur via GCS FUSE (les deux montages nécessitent l'environnement
d'exécution `gen2`).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  gcloud storage ls gs://<uploads-bucket>/          # user-uploaded logo files
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### C. Secret Manager {#c-secret-manager}

Wallos ne génère **aucun secret applicatif** — il n'y a ni clé de chiffrement ni
secret JWT à gérer, car tout l'état d'identité réside dans la base SQLite. Secret
Manager reste utilisé par le socle pour les secrets gérés par la plateforme (par
exemple les jetons CI/CD s'ils sont configurés).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et entrée {#d-networking--ingress}

L'entrée du service vaut **`all`** par défaut — joignable depuis l'internet public
dès l'installation. Pour la restreindre, définissez `ingress_settings = "internal"`
(VPC uniquement), ou ajoutez un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run à
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs. Comme le démon cron de Wallos s'exécute dans le processus, l'activité
(ou les échecs) de ses tâches planifiées n'est visible que dans les journaux du
conteneur — il n'existe pas de Cloud Run Job distinct à inspecter.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wallos {#3-wallos-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni
  job `db-init` ni instance Cloud SQL. Au premier démarrage, Wallos crée sa base
  SQLite dans `/var/www/html/db/wallos.db` (sur le montage NFS) si elle n'existe
  pas déjà et crée l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les abonnements, catégories, paramètres et
  utilisateurs résident entièrement dans `/var/www/html/db/wallos.db`. Comme ce
  fichier se trouve sur le volume NFS persistant, il survit aux redémarrages et aux
  redéploiements. Les logos de fournisseurs personnalisés sont conservés
  séparément dans le bucket `uploads`.
- **Les identifiants par défaut doivent être modifiés.** L'identifiant initial
  `admin`/`admin` est bien connu. Connectez-vous et modifiez le mot de passe (et
  idéalement le nom d'utilisateur) dans l'interface web immédiatement après le
  premier déploiement.
- **Contrainte d'écrivain unique.** La base SQLite embarquée ne prend pas en charge
  des écrivains concurrents répartis sur plusieurs instances sur un montage réseau
  partagé. Conservez `max_instance_count = 1` ; monter en charge horizontalement
  risque de corrompre la base de données.
- **Démon cron toujours actif — non déclenché par les requêtes.** Les 8 tâches
  planifiées intégrées de Wallos (actualisation des taux de change, notifications
  de renouvellement, une interrogation de vérification d'e-mail toutes les
  2 minutes, etc.) s'exécutent en continu dans le même conteneur. C'est pourquoi
  `min_instance_count = 1` et `cpu_always_allocated = true` sont tous deux
  obligatoires — avec une facturation à la requête (CPU limité) ou une mise à zéro,
  ces tâches seraient bloquées ou ne s'exécuteraient jamais.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent **`/`** — la
  page de connexion non authentifiée de Wallos. `bellamy/wallos` ne documente aucun
  point de terminaison `/health` dédié ; il s'agit donc d'un signal de disponibilité
  grossier (à vérifier au premier déploiement) :
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"    # 200 once the server is up
  ```
- **Pas de Redis.** `enable_redis = false` ; Wallos est une application autonome
  sans file d'attente ni cache en dehors de son propre démon cron.
- **Inspecter l'environnement et les montages de la révision en cours :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Wallos ou notables pour
lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Wallos` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Étiquette de l'image Wallos — `bellamy/wallos:latest` est une véritable version « latest », et non un artefact de build épinglé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure de support. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; couvre les workers php-fpm ainsi que le démon cron toujours actif. |
| `min_instance_count` | `1` | **CRITIQUE — doit rester à `1`.** Le démon cron ne se déclenche que lorsqu'une instance s'exécute. |
| `max_instance_count` | `1` | **CRITIQUE — doit rester à `1`.** SQLite sur GCS FUSE ne peut pas accepter d'écrivains concurrents. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Wallos. |
| `container_protocol` | `http1` | Wallos sert du HTTP/1.1 simple. |
| `execution_environment` | `gen2` | Requis pour les montages GCS FUSE. |
| `enable_cloudsql_volume` | `false` | Wallos n'a pas de Cloud SQL ; laissez `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Wallos dans Artifact Registry (évite les limites de débit de Docker Hub). |
| `container_image_source` | `prebuilt` | **Doit rester transmis au socle** — `bellamy/wallos` ne nécessite aucune étape de build ; sinon, la valeur par défaut propre à App_CloudRun (`custom`) l'emporterait silencieusement. |
| `cpu_always_allocated` | `true` | **CRITIQUE — doit rester à `true`.** Le démon cron a besoin de CPU entre les requêtes pour exécuter réellement ses tâches planifiées. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | **Public par défaut.** Définissez `internal` pour restreindre l'accès au VPC uniquement, ou `internal-and-cloud-load-balancing` derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. Wallos n'en utilise aucune par défaut. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **non applicables** à Wallos (pas de base de données
SQL). Laissez les valeurs par défaut.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets Wallos `db` et `uploads` (ainsi que tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus des buckets `db`/`uploads` provisionnés automatiquement. |
| `enable_nfs` | `true` | Activé par défaut — le répertoire SQLite de Wallos est servi depuis NFS, et non depuis GCS FUSE. |
| `nfs_mount_path` | `/var/www/html/db` | Wallos code en dur ici le répertoire de sa base SQLite ; ne pas modifier. |
| `enable_gcs_db_volume` | `false` | GCS FUSE sur `/var/www/html/db` casse le verrouillage SQLite — la base de données provient plutôt de NFS. |
| `enable_gcs_uploads_volume` | `true` | Monte le bucket `uploads` sur `/var/www/html/images/uploads/logos` (écritures de fichiers entiers, aucun verrouillage nécessaire). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket `uploads` est ajouté automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — Wallos n'a pas de base de données SQL. `database_type` est fixé à
`NONE` par `Wallos_Common`, et `database_password_length`, les entrées
`db_*_env_var_name` et la rotation des mots de passe ne sont transmis que pour la
compatibilité avec le socle.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation par défaut. Ne fournissez des jobs que pour un chargement ou une migration de données personnalisés. |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run supplémentaires — distincts des 8 tâches planifiées propres à Wallos dans le conteneur. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Sonde de démarrage ; aucun point de terminaison `/health` dédié n'est documenté pour cette image. |
| `liveness_probe` | HTTP `/` 30s delay | Sonde de vivacité sur la page de connexion non authentifiée. |
| `uptime_check_config` | disabled, path `/health` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `wallos_url` | URL de l'interface web de Wallos (port 80). Interne au VPC lorsque `ingress_settings = internal`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`db` et `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation (vide par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec des montages GCS FUSE, `min_instance_count > max_instance_count`, des délais d'expiration hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `min_instance_count` | `1` | Critique | La mise à zéro arrête silencieusement le démon cron de Wallos — les notifications de renouvellement et toutes les autres tâches planifiées cessent de se déclencher, sans aucune erreur nulle part. |
| `max_instance_count` | `1` | Critique | Une valeur >1 place des écrivains concurrents sur le fichier SQLite du volume NFS partagé, ce qui corrompt la base de données. |
| `cpu_always_allocated` | `true` | Critique | `false` réduit le CPU à presque zéro entre les requêtes, privant le démon cron des cycles CPU dont il a besoin pour exécuter les tâches planifiées. |
| Volume NFS / bucket GCS `uploads` | Ne jamais supprimer | Critique | La base SQLite embarquée (NFS) et les logos personnalisés (bucket `uploads`) résident ici ; supprimer l'un ou l'autre détruit définitivement cet état. |
| `admin` / `admin` (identifiant initial) | À modifier à la première connexion | Critique | Conserver l'identifiant par défaut permet à quiconque peut joindre le service d'en prendre le contrôle total. |
| `ingress_settings` | `all` (ou `internal` pour restreindre) | Élevé | La valeur par défaut `all` expose le service à l'internet public — associez-la à IAP ou Cloud Armor si ce n'est pas souhaité ; définissez `internal` pour un accès limité au VPC. |
| `container_port` | `80` | Élevé | Wallos écoute sur le port 80 ; un autre port fait échouer la sonde de démarrage et la révision ne devient jamais Ready. |
| Chemin de `startup_probe` / `liveness_probe` | `/` | Moyen | Aucun point de terminaison `/health` dédié n'est documenté pour `bellamy/wallos` — si l'application venait à protéger son chemin racine par une authentification, le chemin de la sonde devrait être ajusté. |
| `container_image_source` | `prebuilt` (transmis) | Élevé | S'il n'est pas transmis, la valeur par défaut propre à App_CloudRun (`custom`) l'emporte silencieusement et déclenche un build Kaniko depuis les sources pour une image sans Dockerfile — le déploiement échoue. |
| `enable_cloudsql_volume` | `false` | Moyen | Wallos n'a pas de Cloud SQL ; l'activer ajoute un sidecar Auth Proxy inutile. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter les volumes NFS ou GCS FUSE, donc l'état n'est pas conservé. |
| Masquage par les volumes `db`/`uploads` | À vérifier au premier déploiement | Élevé | Si `bellamy/wallos` place des ressources par défaut dans `/var/www/html/db` ou `/var/www/html/images/uploads/logos`, monter un nouveau volume vide exactement sur ce chemin les masque au premier démarrage — ce point n'a été confirmé dans aucun sens lors des recherches. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Wallos, partagée avec la variante GKE, est décrite dans
**[Wallos_Common](Wallos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallos sur Cloud Run](../labs/Wallos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wallos sur GKE Autopilot](Wallos_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallos Common — Configuration applicative partagée](Wallos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Finance & Wealth Tracking**.
