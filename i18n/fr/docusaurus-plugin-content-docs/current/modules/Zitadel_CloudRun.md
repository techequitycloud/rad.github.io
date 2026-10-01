---
title: "Zitadel sur Google Cloud Run"
description: "Référence de configuration pour déployer Zitadel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Zitadel_CloudRun.md @ 3055034 sha256:2c54dfaf6d33 -->

# Zitadel sur Google Cloud Run {#zitadel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_CloudRun.png" alt="Zitadel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source et cloud native de gestion des identités et
des accès (IAM) qui fournit OpenID Connect, OAuth 2.0, SAML ainsi que la gestion des
utilisateurs et des organisations. Ce module déploie Zitadel sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Zitadel et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute sous forme d'un unique conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 2 vCPU / 4 GiB par défaut ; HTTP/2 (gRPC + REST) sur le port 8080 |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté lors du plan |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (à l'usage de l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout son état dans PostgreSQL — ni Redis, ni file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (publique) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une
  validation lors du plan rejette MySQL et tout moteur autre que Postgres. PostgreSQL
  13/14 sont également acceptés.
- **`ZITADEL_MASTERKEY` est généré automatiquement et immuable.** Il fait exactement
  32 octets et chiffre toutes les données sensibles au repos. **Ne le renouvelez
  jamais après le premier démarrage** — cela rendrait illisibles les données
  précédemment chiffrées (secrets clients, matériel de clés).
- **Zitadel exécute lui-même sa configuration initiale et ses migrations.** Le
  conteneur démarre avec `zitadel start-from-init`, qui crée le schéma et applique les
  migrations de manière idempotente au premier démarrage — il n'existe pas de job de
  migration distinct.
- **Un administrateur de la première instance est créé au premier démarrage.**
  L'organisation `ZITADEL` et l'administrateur humain `zitadel-admin` sont initialisés
  avec un mot de passe généré, issu de Secret Manager (`PASSWORDCHANGEREQUIRED = false`),
  pour que vous puissiez vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel sert du HTTP/2
  en clair sur 8080 et compte sur Cloud Run pour terminer TLS sur `:443`. Définissez
  `container_protocol = "h2c"` si vous avez besoin de HTTP/2 de bout en bout pour les
  clients de l'API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` est dérivé de l'URL du service.** Le point d'entrée le
  définit à partir de l'hôte `run.app` à l'exécution. Derrière un domaine personnalisé,
  vous devez le remplacer (voir le tableau des pièges), sinon l'émetteur OIDC et les
  redirections de la console pointeront vers le mauvais hôte.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que la console et les
  points de terminaison OIDC soient joignables. Activer IAP place une connexion Google
  devant tout, y compris les clients OIDC / machine.
- **Le service est maintenu actif.** `cpu_always_allocated = true` et
  `min_instance_count = 1` (pas de mise à l'échelle à zéro), si bien que les points de
  terminaison de jetons ne subissent aucune latence de démarrage à froid ;
  `max_instance_count = 5`.
- **NFS est activé par défaut mais inutilisé par l'application.** Zitadel conserve tout
  son état dans PostgreSQL ; vous pouvez définir `enable_nfs = false`, sauf si une autre
  raison l'exige.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Zitadel {#a-cloud-run--the-zitadel-service}

Zitadel s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
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

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données de l'application (organisations, utilisateurs,
projets, applications, sessions, clés) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte en privé via le **Cloud SQL Auth Proxy** sur un
socket Unix ; aucune adresse IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données de l'application et un rôle doté de
`CREATEDB`/`CREATEROLE` ; Zitadel crée ensuite son propre schéma via
`start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (avec la prévention de
l'accès public appliquée). Zitadel conserve son état principal dans PostgreSQL ; le
bucket est donc disponible pour l'usage de l'opérateur (exports, ressources). Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`ZITADEL_MASTERKEY` (chiffre toutes les données au repos) et le mot de passe
administrateur initial (initialise l'utilisateur humain de la première instance au
démarrage). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation,
et [Zitadel_Common](Zitadel_Common.md) pour le caractère critique de la masterkey.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut via son URL `run.app`, ce qui permet l'accès
public dont la console et les points de terminaison OIDC ont besoin. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité. Comme Zitadel sert gRPC + REST sur HTTP/2, définissez
`container_protocol = "h2c"` pour obtenir HTTP/2 de bout en bout lorsque c'est
nécessaire.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte en option. Les lignes de journal
`[cloud-entrypoint]` indiquent le mode SSL de la base de données et le domaine externe
résolus.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données de
  l'application et un rôle doté de `LOGIN CREATEDB CREATEROLE`, puis accorde les
  privilèges sur la base de données et sur le schéma `public`. Le job peut être relancé
  sans risque. Il ne crée **pas** le schéma de Zitadel — Zitadel s'en charge lui-même.
- **Configuration initiale + migrations au démarrage.** Le conteneur exécute
  `zitadel start-from-init`, qui crée le schéma et applique les migrations de manière
  idempotente à chaque démarrage. La mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Il est généré une
  seule fois (exactement 32 octets) et écrit dans Secret Manager. Le modifier rend
  illisibles toutes les données précédemment chiffrées. N'y touchez que dans le cadre
  d'une migration planifiée et maîtrisée.
- **Administrateur du premier lancement.** Connectez-vous avec le nom d'utilisateur
  `zitadel-admin` (par défaut) et le mot de passe issu de Secret Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le compte
  initialisé, puis configurez vos organisations, projets et applications OIDC/SAML dans
  la console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur OIDC et
  les URI de redirection de la console sont construits à partir de
  `ZITADEL_EXTERNALDOMAIN`. Le point d'entrée le dérive de l'URL `run.app` ; derrière un
  domaine personnalisé, définissez `ZITADEL_EXTERNALDOMAIN` (via
  `environment_variables`) sur cet hôte, sinon les connexions et l'échange de jetons
  échoueront.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/debug/healthz` — un point de terminaison `200` non authentifié. Prévoyez environ 7
  à 8 minutes au premier démarrage (délai initial de 60 secondes plus une fenêtre de
  nouvelles tentatives d'environ 450 secondes) pour la configuration initiale et les
  migrations.
- **Inspecter la configuration en cours d'exécution / les jobs :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Zitadel ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Zitadel` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Zitadel ; associé à un tag épinglé (`v2.71.0`) lorsqu'il vaut `latest`. Épinglez-le explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Zitadel est un build personnalisé léger FROM l'image ghcr — laissez `custom`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur le port 8080. |
| `container_protocol` | `http1` | Définissez `h2c` pour obtenir HTTP/2 de bout en bout vers les clients de l'API gRPC. |
| `min_instance_count` | `1` | Maintenu actif (pas de mise à l'échelle à zéro) afin que les points de terminaison de jetons ne subissent pas de démarrage à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances ; peut être augmenté sans risque — tout l'état réside dans PostgreSQL. |
| `cpu_always_allocated` | `true` | Facturation basée sur les instances ; garde Zitadel réactif pour le trafic d'authentification. |
| `enable_cloudsql_volume` | `true` | Connexion par socket via le Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Réplique l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour la console et les points de terminaison OIDC/OAuth. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les clients OIDC / machine** — à n'activer que pour des consoles privées. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires (par exemple `ZITADEL_EXTERNALDOMAIN`, remplacements de l'organisation / de l'administrateur). Les valeurs principales de base de données / TLS / masterkey sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. **N'activez pas la rotation de la masterkey.** |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique de Cloud SQL (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Domaines personnalisés — pensez à définir `ZITADEL_EXTERNALDOMAIN` en conséquence. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le ou les buckets GCS déclarés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Le bucket provisionné automatiquement ; complétez la liste pour des buckets supplémentaires. |
| `enable_nfs` | `true` | Activé par défaut mais **inutilisé** — Zitadel conserve tout son état dans PostgreSQL ; vous pouvez le définir sur `false` sans risque. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté lors du plan. |
| `db_name` | `zitadel` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `zitadel` | Utilisateur de la base de données de l'application (doté de `CREATEDB`/`CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60 s | Sonde de démarrage. Prévoyez environ 7 à 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60 s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring (points de terminaison publics uniquement). |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Redis {#group-21--redis}

Zitadel n'utilise pas Redis (tout l'état réside dans PostgreSQL). `enable_redis` vaut
`false` par défaut et doit rester désactivé ; les entrées `redis_*` sont sans effet
pour ce module.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (la console Zitadel). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High**
> (élevé : service dégradé) — **Medium** (moyen : coût ou dégradation partielle) —
> **Low** (faible : mineur).

> **Validation héritée lors du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* lors du plan — un `database_type` autre que Postgres, `enable_cloudsql_volume` avec `database_type = NONE`, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critical | Le renouveler rend définitivement illisibles toutes les données précédemment chiffrées (secrets clients, matériel de clés). |
| `database_type` | `POSTGRES_15` | Critical | Zitadel ne prend en charge que PostgreSQL ; MySQL ou tout autre moteur est rejeté lors du plan, et un mauvais moteur empêche le démarrage. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données / le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans source de sauvegarde valide fait échouer le job d'import. |
| `ZITADEL_EXTERNALDOMAIN` | Correspondre au navigateur / à l'hôte | Critical | S'il ne correspond pas à l'hôte qu'atteignent les utilisateurs, l'émetteur OIDC et les redirections de la console sont erronés et chaque connexion ou échange de jetons échoue. Définissez-le explicitement derrière un domaine personnalisé. |
| `enable_cloudsql_volume` | `true` | High | Le socket de l'Auth Proxy est requis pour la connectivité PostgreSQL ; le désactiver alors qu'une base de données est configurée est bloqué par une vérification lors du plan. |
| `ingress_settings` | `all` | High | `internal` bloque la console et tous les clients OIDC/OAuth externes. |
| `enable_iap` | uniquement pour des consoles privées | High | IAP exige une connexion Google pour toutes les requêtes, ce qui bloque les clients OIDC / machine et les points de terminaison de jetons. |
| `application_version` | Épingler une version | High | `latest` correspond aujourd'hui à un tag épinglé, mais un épinglage explicite évite des migrations inattendues lors d'un redéploiement. |
| `memory_limit` | `4Gi` | Medium | Une valeur trop basse expose à des OOM sous charge ; gen2 impose également un plancher de 512 MiB. |
| `min_instance_count` | `1` | Medium | `0` (mise à l'échelle à zéro) ajoute une latence de démarrage à froid aux requêtes de jetons / de connexion après une période d'inactivité. |
| `enable_nfs` | `false` (inutilisé) | Low | Activé par défaut, mais Zitadel ne stocke aucun état sur disque ; le laisser activé gaspille un montage NFS. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation des données d'identité liées à la conformité. |
| `enable_cloud_armor` | à activer en production | Medium | La console et les points de terminaison OIDC sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et réplication d'images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Zitadel, partagée avec la variante GKE, est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zitadel sur Cloud Run](../labs/Zitadel_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur GKE Autopilot](Zitadel_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — configuration applicative partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
