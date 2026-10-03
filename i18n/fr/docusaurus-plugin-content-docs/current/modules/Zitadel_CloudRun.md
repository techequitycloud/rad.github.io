---
title: "Zitadel sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Zitadel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Zitadel_CloudRun.md @ 15fd4c7 sha256:2a36250e7434 -->

# Zitadel sur Google Cloud Run {#zitadel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_CloudRun.png" alt="Zitadel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source de gestion des identités et des accès (IAM)
native du cloud, offrant OpenID Connect, OAuth 2.0, SAML et la gestion des
utilisateurs/organisations. Ce module déploie Zitadel sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Zitadel utilise et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 2 vCPU / 4 GiB par défaut ; HTTP/2 (gRPC + REST) sur le port 8080 |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (utilisation par l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout l'état dans PostgreSQL — pas de Redis, pas de file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` auto-générée et mot de passe administrateur initial ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut (publique) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une validation au
  moment de la planification rejette MySQL et tout moteur non-Postgres. PostgreSQL 13/14
  sont également acceptés.
- **`ZITADEL_MASTERKEY` est générée automatiquement et immuable.** Elle fait
  exactement 32 octets et chiffre toutes les données sensibles au repos. **Ne la faites
  jamais pivoter après le premier démarrage** — cela rendrait illisibles les données
  précédemment chiffrées (secrets client, matériel de clé).
- **Zitadel exécute sa propre configuration + migrations.** Le conteneur démarre avec
  `zitadel start-from-init`, qui crée le schéma et applique les migrations de manière
  idempotente au premier démarrage — il n'y a pas de job de migration séparé.
- **Un administrateur de première instance est créé au premier démarrage.**
  L'organisation `ZITADEL` et l'administrateur humain `zitadel-admin` sont
  initialisés avec un mot de passe généré par Secret Manager (`PASSWORDCHANGEREQUIRED = false`),
  afin que vous puissiez vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`, `ZITADEL_EXTERNALPORT = 443`,
  `ZITADEL_TLS_ENABLED = false`. Zitadel sert HTTP/2 en clair sur 8080 et fait confiance à Cloud Run
  pour terminer TLS sur `:443`. Définissez `container_protocol = "h2c"` si vous avez
  besoin d'HTTP/2 de bout en bout pour les clients API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` est dérivé de l'URL du service.** Le point d'entrée le
  définit à partir de l'hôte `run.app` d'exécution. Derrière un domaine
  personnalisé, vous devez le remplacer (voir le tableau des pièges) ou l'émetteur OIDC
  et les redirections de la console pointeront vers le mauvais hôte.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que la console et les
  points de terminaison OIDC soient accessibles. L'activation d'IAP place la connexion
  Google devant tout, y compris les clients OIDC/machine.
- **Le service est maintenu chaud.** `cpu_always_allocated = true` et `min_instance_count = 1` (pas de
  mise à l'échelle à zéro), de sorte que les points de terminaison de jeton n'ont pas de
  latence de démarrage à froid ; `max_instance_count = 5`.
- **NFS est désactivé par défaut.** Zitadel conserve tout l'état dans PostgreSQL et
  n'écrit jamais sur un montage NFS, donc `enable_nfs = false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Zitadel {#a-cloud-run--the-zitadel-service}

Zitadel s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre le nombre minimum et maximum d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~zitadel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the entrypoint's derived external domain / DB SSL mode:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 \
    | grep cloud-entrypoint
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données d'application (organisations, utilisateurs, projets,
applications, sessions, clés) dans une instance gérée Cloud SQL pour PostgreSQL 15. Le
service se connecte en privé via le **proxy d'authentification Cloud SQL** sur un socket
Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données de l'application et un rôle avec
`CREATEDB`/`CREATEROLE` ; Zitadel crée ensuite son propre schéma via
`start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (prévention de l'accès
public appliquée). Zitadel conserve son état principal dans PostgreSQL, de sorte que le
bucket est disponible pour l'utilisation par l'opérateur (exportations, actifs). Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`ZITADEL_MASTERKEY` (chiffre toutes les données au repos) et le mot de passe
administrateur initial (initialise l'utilisateur humain de première instance au
démarrage). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[Zitadel_Common](Zitadel_Common.md) pour la criticité de la clé maîtresse.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet
l'accès public dont la console et les points de terminaison OIDC ont besoin. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud
Armor peuvent être superposés ; les paramètres d'entrée et le contrôle d'égression VPC
contrôlent la connectivité. Étant donné que Zitadel sert gRPC + REST sur HTTP/2,
définissez `container_protocol = "h2c"` pour HTTP/2 de bout en bout si nécessaire.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte facultatives. Les lignes de journal `[cloud-entrypoint]`
affichent le mode SSL de la base de données résolu et le domaine externe.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente la
  base de données de l'application et un rôle avec `LOGIN CREATEDB CREATEROLE`, puis accorde
  les privilèges sur la base de données et le schéma `public`. Le job peut être
  réexécuté en toute sécurité. Il ne crée **pas** le schéma de Zitadel — Zitadel le fait
  lui-même.
- **Configuration + migrations au démarrage.** Le conteneur exécute
  `zitadel start-from-init`, qui crée le schéma et applique les migrations de manière
  idempotente à chaque démarrage. La mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration séparée.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Elle est générée
  une seule fois (exactement 32 octets) et écrite dans Secret Manager. La modifier rend
  toutes les données précédemment chiffrées illisibles. Ne la touchez que lors d'une
  migration planifiée et comprise.
- **Administrateur de première exécution.** Connectez-vous avec le nom d'utilisateur
  `zitadel-admin` (par défaut) et le mot de passe de Secret Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le compte
  initialisé, et configurez vos organisations, projets et applications OIDC/SAML dans la
  console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur OIDC et les
  URI de redirection de la console sont construits à partir de `ZITADEL_EXTERNALDOMAIN`. Le
  point d'entrée le dérive de l'URL `run.app` ; derrière un domaine
  personnalisé, définissez `ZITADEL_EXTERNALDOMAIN` (via `environment_variables`) sur cet hôte
  ou les connexions/échanges de jetons échoueront.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/debug/healthz` — un point de terminaison `200` non authentifié.
  Prévoyez environ 7 à 8 minutes au premier démarrage (délai initial de 60 secondes plus
  une fenêtre de nouvelle tentative d'environ 450 secondes) pour la configuration + les
  migrations.
- **Inspecter la configuration / les jobs en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Zitadel sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Zitadel` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Zitadel ; mappé à un tag épinglé (`v2.71.0`) lorsque `latest`. Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Zitadel est une construction personnalisée fine À PARTIR de l'image ghcr — laissez comme `custom`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur 8080. |
| `container_protocol` | `http1` | Définissez `h2c` pour HTTP/2 de bout en bout vers les clients API gRPC. |
| `min_instance_count` | `1` | Maintenu chaud (pas de mise à l'échelle à zéro) afin que les points de terminaison de jeton n'aient pas de démarrage à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances ; sûr à augmenter — tout l'état est dans PostgreSQL. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance ; maintient Zitadel réactif pour le trafic d'authentification. |
| `enable_cloudsql_volume` | `true` | Connexion socket du proxy d'authentification Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour la console et les points de terminaison OIDC/OAuth. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les clients OIDC/machine** — activer uniquement pour les consoles privées. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires (par exemple, `ZITADEL_EXTERNALDOMAIN`, remplacements d'organisation/administrateur). Les valeurs principales de la base de données/TLS/clé maîtresse sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. **Ne pas activer la rotation de la clé maîtresse.** |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Domaines personnalisés — n'oubliez pas de définir `ZITADEL_EXTERNALDOMAIN` pour correspondre. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend HTTPS LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le(s) bucket(s) GCS déclaré(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Le bucket auto-provisionné ; étendre la liste pour des buckets supplémentaires. |
| `enable_nfs` | `false` | Désactivé par défaut : Zitadel est entièrement basé sur PostgreSQL et n'écrit jamais sur le montage. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté au moment de la planification. |
| `db_name` | `zitadel` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `zitadel` | Utilisateur de la base de données de l'application (autorisé `CREATEDB`/`CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de démarrage. Prévoir environ 7 à 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring (points de terminaison publics uniquement). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

Zitadel n'utilise pas Redis (tout l'état est dans PostgreSQL). `enable_redis` est
par défaut `false` et doit être désactivé ; les entrées `redis_*`
sont inertes pour ce module.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (la console Zitadel). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un
> `database_type` non-Postgres, `enable_cloudsql_volume` avec `database_type = NONE`,
> `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, un
> `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (auto-générée) | Ne jamais faire pivoter après le premier démarrage | Critique | La faire pivoter rend toutes les données précédemment chiffrées (secrets client, matériel de clé) définitivement illisibles. |
| `database_type` | `POSTGRES_15` | Critique | Zitadel ne prend en charge que PostgreSQL ; MySQL/autre est rejeté au moment de la planification, et un mauvais moteur bloque le démarrage. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `ZITADEL_EXTERNALDOMAIN` | Correspondre au navigateur/hôte | Critique | S'il ne correspond pas à l'hôte que les utilisateurs atteignent, l'émetteur OIDC et les redirections de la console sont incorrects et chaque connexion/échange de jetons échoue. Définissez-le explicitement derrière un domaine personnalisé. |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket du proxy d'authentification est requis pour la connectivité PostgreSQL ; sa désactivation avec une base de données configurée est bloquée par une protection au moment de la planification. |
| `ingress_settings` | `all` | Élevé | `internal` bloque la console et tous les clients OIDC/OAuth externes. |
| `enable_iap` | uniquement pour les consoles privées | Élevé | IAP nécessite la connexion Google pour toutes les requêtes, bloquant les clients OIDC/machine et les points de terminaison de jetons. |
| `application_version` | Épingler une version | Élevé | `latest` correspond à un tag épinglé aujourd'hui, mais l'épinglage explicite évite les migrations surprises lors du redéploiement. |
| `memory_limit` | `4Gi` | Moyen | Un réglage trop bas risque un OOM sous charge ; gen2 impose également un plancher de 512 MiB. |
| `min_instance_count` | `1` | Moyen | `0` (mise à l'échelle à zéro) ajoute une latence de démarrage à froid aux requêtes de jeton/connexion après l'inactivité. |
| `enable_nfs` | `false` (par défaut) | Faible | Zitadel ne stocke aucun état sur disque ; l'activer n'ajoute qu'un montage NFS inutilisé. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données d'identité. |
| `enable_cloud_armor` | activer pour la production | Moyen | La console et les points de terminaison OIDC sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Zitadel
partagée avec la variante GKE est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Zitadel sur Cloud Run](../labs/Zitadel_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur GKE Autopilot](Zitadel_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — Configuration d'application partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
