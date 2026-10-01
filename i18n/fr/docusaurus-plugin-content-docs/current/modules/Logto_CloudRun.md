---
title: "Logto sur Google Cloud Run"
description: "Référence de configuration pour déployer Logto sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Logto_CloudRun.md @ 3055034 sha256:6fbd2c400f8f -->

# Logto sur Google Cloud Run {#logto-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_CloudRun.png" alt="Logto sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto est un fournisseur d'identité open source sous licence MPL-2.0 — une alternative à Auth0
qui parle OIDC et OAuth 2.0 et fournit des parcours de connexion, des connecteurs sociaux et
d'entreprise, la multi-location et une console d'administration. Ce module déploie Logto sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Logto et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Logto s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; autoscaling serverless |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Logto ne prend en charge ni MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement ; facultatif pour Logto (tout l'état principal est dans Postgres) |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données — Logto n'a **aucun** secret applicatif externe (les clés OIDC sont amorcées dans la base) |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; une garde au moment du plan rejette tout `database_type` non PostgreSQL.
- **Le cœur de Logto est publié sur le port 3001 ; la console d'administration (3002) ne l'est pas.** Cloud Run
  publie un seul port, si bien que seul le point de terminaison API principal / OIDC (3001) est accessible.
  La console d'administration — où sont enregistrés le premier compte administrateur et les applications —
  s'exécute sur 3002 et n'est **pas** exposée via l'URL `run.app`. Prévoyez un chemin distinct
  vers 3002 pour la configuration initiale (voir §3).
- **Il n'y a aucun secret applicatif à protéger.** Logto génère ses clés de signature OIDC
  au premier démarrage et les stocke **dans la base de données**. Rien dans Secret Manager n'a besoin
  d'être protégé ni renouvelé, à l'exception du mot de passe de la base géré par le socle. Protéger les
  clés de Logto revient à protéger Cloud SQL.
- **`min_instance_count = 1` par défaut.** Logto est un fournisseur d'identité placé sur le chemin
  de chaque connexion ; une instance est donc maintenue chaude pour éviter la latence de démarrage à froid sur
  les requêtes OIDC. Tout l'état est dans Postgres, donc `0` (mise à l'échelle à zéro) est sans risque pour les données si vous
  préférez échanger des démarrages à froid contre des économies.
- **`cpu_always_allocated = false` (facturation à la requête).** Le cœur de Logto est un
  fournisseur OIDC requête/réponse sans worker d'arrière-plan interne qui devrait s'exécuter
  sans requête entrante ; le CPU n'est donc facturé que pendant le traitement des requêtes.
- **La connexion contourne le socket Cloud SQL.** `enable_cloudsql_volume = true`
  injecte toujours le sidecar Auth Proxy, mais le pilote `slonik` de Logto ne sait pas analyser la
  forme DSN par socket Unix — le point d'entrée se connecte plutôt via l'**IP privée** injectée
  (`DB_IP`) avec `sslmode=no-verify` (chiffré ; la vérification de l'AC est ignorée pour
  le seul saut vers la base).
- **Pas de Redis.** Logto s'appuie sur Postgres ; `enable_redis` vaut `false` par défaut.
- **`ENDPOINT` est dérivé de l'URL du service.** Le point d'entrée définit l'émetteur OIDC
  de Logto et ses URL absolues à partir de `CLOUDRUN_SERVICE_URL` injectée ; surchargez `ENDPOINT`
  via `environment_variables` pour un domaine personnalisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Logto {#a-cloud-run--the-logto-service}

Logto s'exécute comme un service Cloud Run v2 qui se met à l'échelle selon la charge de requêtes entre le
nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre révisions pour des déploiements progressifs sûrs. Le port de conteneur publié
est **3001** (cœur de Logto / OIDC).

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / ENDPOINT on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Logto stocke tout — utilisateurs, applications, connecteurs, clés de signature OIDC et
rôles par locataire — dans une instance gérée Cloud SQL for PostgreSQL 15. Sur Cloud Run, le
sidecar Auth Proxy est injecté, mais l'application se connecte via l'**IP privée** de l'instance
(`DB_IP`) avec `sslmode=no-verify`, car le pilote de Logto ne sait pas utiliser la forme DSN
par socket. Au premier déploiement, un Job d'initialisation crée la base de données applicative et le rôle
(avec `CREATEROLE`, requis pour les rôles RLS par locataire de Logto).

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`logto`), l'utilisateur (`logto`) et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement. Logto conserve tout son état principal
dans PostgreSQL ; ce bucket est donc disponible pour des ressources facultatives plutôt que comme stockage
d'exécution requis.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Logto n'a **aucun secret applicatif externe** — ses clés de signature OIDC sont générées et
stockées dans la base de données au premier démarrage. Le seul secret en jeu est le **mot de passe de la
base de données**, que le socle génère et gère.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. L'émetteur OIDC de Logto et toutes
les URL de redirection absolues sont construits à partir d'`ENDPOINT`, que le point d'entrée dérive de
l'URL du service — l'hôte vu par le navigateur, l'émetteur et les URI de redirection enregistrées doivent donc
tous concorder. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté par-dessus ; définissez alors `ENDPOINT` sur le domaine personnalisé.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs. Le point d'entrée affiche une
ligne `[cloud-entrypoint]` indiquant le mode de connexion à la base résolu et `ENDPOINT` —
utile pour diagnostiquer des problèmes de connexion ou d'URL d'émetteur.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Logto {#3-logto-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il crée de façon idempotente le rôle applicatif **avec
  `CREATEDB CREATEROLE`** (requis pour les rôles RLS par locataire de Logto) et la
  base de données applicative, puis accorde les privilèges et transfère la propriété du schéma `public`
  au rôle applicatif. Le job peut être relancé sans risque.
- **Schéma et clés OIDC amorcés au démarrage.** Au démarrage, Logto exécute
  `npm run cli db seed -- --swe` (`--swe` = seed-when-empty, idempotent), qui crée
  son schéma et génère les clés privées de signature OIDC **dans la base de données** — uniquement
  lorsque la base est vide. Ces clés ne sont pas stockées dans Secret Manager ; la base de données
  en est l'unique dépositaire. Effacer la base régénère de nouvelles clés et invalide tous
  les jetons émis précédemment et les clients enregistrés.
- **Aucun secret applicatif à renouveler.** Il n'y a ni clé de chiffrement ni secret JWT dans
  Secret Manager — uniquement le mot de passe de la base géré par le socle.
- **La console d'administration (3002) n'est pas publiée.** Cloud Run n'expose que le cœur (3001).
  La console d'administration — où vous créez le premier administrateur et enregistrez
  les applications — s'exécute sur 3002 et n'est pas accessible via l'URL `run.app`. Effectuez
  la configuration initiale en plaçant devant Logto un proxy qui route vers 3002, ou en
  exposant temporairement 3002 via un déploiement dédié. `ADMIN_ENDPOINT` prend par défaut le même
  hôte qu'`ENDPOINT` par souci de cohérence des URL.
- **`ENDPOINT` doit correspondre à l'hôte vu par le navigateur.** Logto construit son émetteur OIDC et
  ses URL de redirection à partir d'`ENDPOINT` ; le point d'entrée le définit à partir de `CLOUDRUN_SERVICE_URL`.
  Pour un domaine personnalisé, définissez `ENDPOINT` dans `environment_variables` avant de déployer.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/api/status` — un
  point de terminaison non authentifié qui renvoie `200` dès que le cœur est opérationnel. La sonde de démarrage
  laisse une large fenêtre au premier démarrage (délai initial de 60s + 30 tentatives) pour l'étape d'amorçage.
  Vérifiez-la manuellement :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/status"
  ```
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Logto ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `logto` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Logto` | Nom lisible affiché dans la console. |
| `description` | `Logto - open-source Auth0-alternative identity provider (OIDC)` | Description du service. |
| `application_version` | `latest` | Tag de l'image Logto (`svhd/logto:<tag>`) ; épinglez une version précise (p. ex. `1.33`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Logto est construit comme une fine surcouche `FROM svhd/logto` — conservez `custom`. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Logto a besoin d'au moins 2 GiB pour fonctionner de manière fiable. |
| `cpu_always_allocated` | `false` | Facturation à la requête (CPU facturé uniquement pendant le traitement). Logto n'a aucun worker d'arrière-plan à maintenir actif. |
| `min_instance_count` | `1` | Gardez 1 instance chaude pour que les requêtes OIDC/de connexion ne subissent jamais de démarrage à froid ; `0` est sans risque pour les données (tout l'état est dans Postgres). |
| `max_instance_count` | `5` | Plafond de coût ; doit être ≥ `min_instance_count`. |
| `container_port` | `3001` | Le cœur de Logto écoute sur 3001 ; la console d'administration (3002) n'est pas publiée. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | `true` | Injecte le sidecar Auth Proxy ; Logto se connecte malgré tout via `DB_IP` (DSN par socket non pris en charge par slonik). |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public afin que les clients OIDC externes et les navigateurs puissent atteindre Logto. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque le trafic OIDC/de connexion non authentifié** — laissez désactivé pour un IdP public. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Définissez ici `ENDPOINT` pour un domaine personnalisé. Ne définissez ni `PORT` (réservé par Cloud Run) ni `DB_URL` (composé par le point d'entrée). |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. Logto n'en a besoin d'aucun par défaut. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique de la base de données (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production / la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupes 9 à 11 — Équilibreur de charge / Stockage / SQL personnalisé {#group-911--load-balancer--storage--custom-sql}

`enable_cloud_armor`, `application_domains`, `enable_cdn` et les paramètres de rétention
d'Artifact Registry (Groupe 9) ; `create_cloud_storage`, `storage_buckets`, `enable_nfs`,
`gcs_volumes` (Groupe 10) ; ainsi que `enable_custom_sql_scripts` et les paramètres associés (Groupe 11) suivent tous
le comportement standard d'[App_CloudRun](App_CloudRun.md). NFS est désactivé par défaut —
Logto n'a besoin d'aucun système de fichiers partagé.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `logto` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `logto` | Utilisateur de la base de données applicative (doté de `CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, délai de 60s, 30 tentatives | Large fenêtre au premier démarrage pour l'étape d'amorçage. |
| `liveness_probe` | HTTP `/api/status`, délai de 60s, période de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut ; activez-le et définissez `path = "/api/status"` pour la surveillance en production. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Logto utilise Postgres pour toute la persistance — laissez `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (cœur de Logto / point de terminaison OIDC). |
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
| `initialization_jobs` | Noms des tâches d'initialisation. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `database_type` non PostgreSQL, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, `enable_cloudsql_volume` sans base de données. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Base de données Cloud SQL | La sauvegarder ; ne jamais l'effacer | Critique | Les clés de signature OIDC de Logto résident dans la base. L'effacer régénère de nouvelles clés et invalide chaque jeton émis et chaque client enregistré. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/le rôle et détruit toutes les données d'identité. |
| `database_type` | `POSTGRES_15` | Critique | MySQL et les autres moteurs sont rejetés au moment du plan ; Logto ne fonctionne que sur PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `ENDPOINT` | Hôte réellement vu par le navigateur | Élevé | Un émetteur incohérent casse la découverte OIDC, les URI de redirection et chaque callback OAuth. |
| `container_port` | `3001` | Élevé | Le cœur écoute sur 3001 ; un mauvais port fait échouer chaque sonde et chaque requête. La console d'administration (3002) n'est volontairement pas publiée. |
| `enable_iap` | `false` pour un IdP public | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les parcours OIDC/de connexion que Logto existe pour servir. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous d'environ 2 GiB, Logto est sujet aux OOM sous charge. |
| Accès à la console d'administration (3002) | Prévoir une route avant la mise en service | Élevé | L'interface de premier administrateur/de configuration est sur 3002, inaccessible via l'URL `run.app` — la configuration initiale est bloquée sans chemin distinct. |
| `enable_cloudsql_volume` | `true` | Moyen | Le sidecar proxy est injecté par parité, mais Logto se connecte via `DB_IP` ; le désactiver supprime le sidecar sans nuire au chemin par IP privée de l'application. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première connexion après inactivité (sans risque pour les données par ailleurs). |
| `enable_redis` | `false` | Faible | Logto n'utilise pas Redis ; l'activer câble une dépendance inutilisée. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Logto partagée
avec la variante GKE est décrite dans **[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Logto sur Cloud Run](../labs/Logto_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Logto sur GKE Autopilot](Logto_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Logto Common — Configuration applicative partagée](Logto_Common.md) — la configuration partagée par les deux cibles de déploiement.
