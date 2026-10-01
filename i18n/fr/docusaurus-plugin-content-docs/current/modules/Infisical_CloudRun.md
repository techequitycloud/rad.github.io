---
title: "Infisical sur Google Cloud Run"
description: "Référence de configuration pour déployer Infisical sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Infisical_CloudRun.md @ 3055034 sha256:2b13c81deb22 -->

# Infisical sur Google Cloud Run {#infisical-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_CloudRun.png" alt="Infisical sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical est une plateforme open source de gestion des secrets, chiffrée de bout en
bout : les équipes et les pipelines CI/CD stockent, injectent et font pivoter les
secrets applicatifs depuis une plateforme unique, à l'aide de SDK clients, d'une CLI
ou de l'interface web. Ce module déploie Infisical sur **Cloud Run v2** en s'appuyant
sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Infisical et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Infisical s'exécute sous forme de conteneur Node.js (une image construite sur mesure
qui encapsule l'image officielle `infisical/infisical`) sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js construit sur mesure, 1 vCPU / 2Gi par défaut, mise à l'échelle automatique serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Infisical ne prend pas en charge MySQL ni d'autres moteurs |
| Cache et limitation de débit | Redis (facultatif, activé par défaut) | Redis hébergé sur NFS par défaut, ou un Redis externe authentifié via `redis_auth` |
| Secrets | Secret Manager | `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut `POSTGRES_15` par défaut et
  c'est la seule valeur prise en charge par Infisical.
- **L'image de conteneur est construite sur mesure, ce n'est pas l'image amont.**
  `Infisical_Common` construit `FROM infisical/infisical:${INFISICAL_VERSION}` avec un
  `entrypoint.sh` d'encapsulation qui assemble la chaîne de connexion à la base de
  données au démarrage du conteneur (la valeur Secret Manager `DB_PASSWORD` disponible
  à l'exécution ne peut pas être encodée pour une URL au moment du plan Terraform).
  `application_version = "latest"` correspond à une version figée et éprouvée
  (`v0.162.10`) transmise comme argument de build, conformément à la convention de ce
  catalogue qui proscrit de construire à partir d'images de base taguées `latest`.
- **Redis est activé par défaut, et ses modes de raccordement s'excluent
  mutuellement par construction.** Lorsque `redis_auth` est vide (par défaut),
  l'injection en variables d'environnement en clair du Redis hébergé sur NFS du socle
  fournit `REDIS_HOST`/`REDIS_PORT`. Lorsque `redis_auth` est défini,
  `Infisical_Common` crée et injecte à la place son propre secret `REDIS_URL`. Un seul
  chemin est actif à la fois.
- **La sonde de démarrage est TCP, et non HTTP.** Infisical expose bien un point de
  terminaison non authentifié `/api/status` qui renvoie 200 avec du JSON lorsqu'il est
  sain — mais seulement une fois que l'application signale une disponibilité
  *complète* (base de données + Redis + dépendances). Une sonde de démarrage HTTP sur
  ce chemin ne réussirait jamais ; le module utilise donc par défaut une sonde TCP
  (qui réussit dès que le port est lié) et **désactive entièrement la sonde de
  vivacité** pour éviter une boucle de redémarrages d'un conteneur encore en cours de
  démarrage.
- **Aucun stockage d'objets n'est monté.** Un bucket GCS générique `data` est
  provisionné via la variable `storage_buckets` du socle, mais `gcs_volumes` est vide
  par défaut — Infisical conserve tout son état persistant dans PostgreSQL et n'a
  besoin d'aucun montage de bucket.
- **Le compte administrateur est amorcé sans interface, et non via l'interface web.**
  Un job d'initialisation `admin-bootstrap` exécute la commande `bootstrap` de la CLI
  `infisical` contre le serveur en cours d'exécution, ce qui évite la fenêtre
  d'inscription « ouverte jusqu'à ce que le premier visiteur la revendique ». Sur
  Cloud Run, ce job ne s'exécute **pas** automatiquement lors de l'application —
  voir [§3](#3-infisical-application-behaviour).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Infisical {#a-cloud-run--the-infisical-service}

Infisical s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et maximal
d'instances. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Infisical stocke toutes les données applicatives (secrets, projets, organisations,
utilisateurs, journaux d'audit) dans une instance gérée Cloud SQL for PostgreSQL 15.
Le service se connecte via le **Cloud SQL Auth Proxy** sur un socket Unix
(`enable_cloudsql_volume =
true` par défaut) ; aucune IP publique n'est exposée. Lors du premier déploiement,
le job d'initialisation `db-init` crée la base de données applicative et le rôle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Redis (cache et limitation de débit) {#c-redis-cache--rate-limiting}

Redis est **activé par défaut** (`enable_redis = true`). Lorsque `redis_host` est
laissé vide, l'IP de la VM du serveur NFS est utilisée comme hôte Redis par défaut.
Lorsque `redis_auth` est défini, `Infisical_Common` provisionne son propre secret
Secret Manager `REDIS_URL` au lieu de s'appuyer sur l'injection en variables
d'environnement en clair du socle.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `ENCRYPTION_KEY` (chiffre chaque secret stocké par Infisical),
`AUTH_SECRET` (signe les jetons de session JWT) et `ADMIN_PASSWORD` (utilisé
uniquement par le job `admin-bootstrap`, jamais injecté dans le serveur en cours
d'exécution). Un secret `REDIS_URL` est créé de manière conditionnelle. Le mot de
passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté.

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte en option.

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Infisical {#3-infisical-application-behaviour}

- **Initialisation de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` exécute `postgres:15-alpine`, se connecte via le socket
  du Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de données
  applicatifs (correspondant aux `DB_USER`/`DB_NAME` injectés par le socle).
  `execute_on_apply = true` : il s'exécute donc à chaque application et peut être
  relancé sans risque.
- **La chaîne de connexion à la base de données est assemblée au démarrage du
  conteneur, et non figée au moment du plan.** Infisical accepte un unique
  `DB_CONNECTION_URI`, mais le `DB_PASSWORD` d'exécution (une valeur Secret Manager)
  n'est pas connu lorsque Terraform génère l'image — `entrypoint.sh` l'encode pour une
  URL et construit l'URI à partir des valeurs distinctes
  `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, en choisissant le `sslmode`
  selon la forme de `DB_HOST` (chemin de socket Unix → `disable` ; boucle locale →
  `disable` ; IP privée brute → `require`).
- **Le compte administrateur est amorcé sans interface — mais pas automatiquement
  sur Cloud Run.** Le job d'initialisation `admin-bootstrap` (image
  `infisical/cli:latest`, dépend de `db-init`) exécute
  `infisical bootstrap --ignore-if-bootstrapped` contre l'API HTTP du serveur en cours
  d'exécution pour créer le premier super-administrateur, l'organisation et
  l'identité machine d'administrateur de l'instance. Comme les jobs d'initialisation
  Cloud Run s'exécutent strictement *avant* que le Service n'existe, ce job ne peut
  pas joindre un serveur actif au moment de l'application — `execute_on_apply = false`.
  **Déclenchez-le manuellement** après avoir vérifié que le service est sain :
  ```bash
  curl -s "$SERVICE_URL/api/status"   # expect HTTP 200 with a JSON body
  gcloud run jobs execute <service>-admin-bootstrap --region "$REGION" --project "$PROJECT" --wait
  ```
  Le job effectue jusqu'à 20 tentatives (à 15s d'intervalle) et est idempotent
  (`--ignore-if-bootstrapped`) ; le relancer après un redéploiement est donc sans
  conséquence.
- **Le mot de passe administrateur réside uniquement dans Secret Manager.**
  Récupérez l'identifiant amorcé avec :
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
  Il n'est jamais injecté dans le conteneur du serveur en cours d'exécution —
  uniquement dans le job `admin-bootstrap`.
- **Point de terminaison de santé.** `/api/status` renvoie HTTP 200 avec un corps JSON
  une fois qu'Infisical, sa connexion à la base de données et (si activé) Redis sont
  tous sains — mais les sondes de démarrage et de vivacité de la plateforme ne
  l'interrogent volontairement **pas** directement (voir [§1](#1-overview)) ;
  utilisez-le plutôt pour vos propres vérifications de santé manuelles et pour la
  surveillance externe de disponibilité.
- **Redis est facultatif mais activé par défaut.** Ne définissez `enable_redis = false`
  que si vous êtes certain de ne vouloir aucun backend de cache ou de limitation de
  débit ; Infisical se rabat sur un fonctionnement en mémoire sans Redis, mais perd la
  cohérence entre instances dès que `max_instance_count > 1`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Infisical ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `infisical` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Infisical` | Nom lisible affiché dans la console. |
| `description` | `Infisical - Open Source Secrets Management` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image. `"latest"` correspond à un argument de build figé (`v0.162.10`) — la documentation d'Infisical recommande de ne jamais exécuter un `latest` nu en production. |
| `site_url` | `""` | URL publique pour `SITE_URL` (liens d'invitation et d'e-mail, CORS) et cible de la CLI du job `admin-bootstrap`. Vaut par défaut l'URL `run.app` calculée de ce service lorsqu'elle est vide. |
| `admin_email` | `admin@techequity.cloud` | Adresse e-mail du premier compte super-administrateur amorcé. |
| `admin_organization` | `Default Organization` | Nom de l'organisation créée pour le compte amorcé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit le Dockerfile d'`Infisical_Common` ; `prebuilt` déploie directement `container_image`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `container_port` | `8080` | Port sur lequel écoute Infisical. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Sidecar de socket Unix du Cloud SQL Auth Proxy — le choix du `sslmode` par l'entrypoint repose sur la forme du chemin de socket. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Peut dépasser 1 sans risque — les migrations utilisent un verrou consultatif Postgres distribué et l'authentification repose sur JWT (aucun état de session en mémoire nécessitant de l'affinité). |
| `enable_image_mirroring` | `true` | Répliquer l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public ; Infisical est généralement sollicité à la fois par des navigateurs et par des clients CLI/SDK. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'acheminer que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger une connexion Google devant Infisical. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | diverses | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet sur le déploiement.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables principales d'Infisical (`HOST`, `SITE_URL`, `DB_CONNECTION_URI`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Entrées standard de sauvegarde et de restauration d'`App_CloudRun` — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `backup_schedule`,
`backup_retention_days`, `enable_backup_import`.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'`App_CloudRun` — consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

Entrées standard d'`App_CloudRun` pour Cloud Armor, le CDN et la conservation dans
Artifact Registry — consultez [App_CloudRun](App_CloudRun.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket par défaut au niveau du socle — **provisionné mais jamais monté** ; Infisical n'a besoin d'aucun stockage d'objets. |
| `enable_nfs` | (valeur par défaut du socle) | Pertinent ici uniquement comme source par défaut de l'IP de l'hôte Redis lorsque `redis_host` est vide. |
| `gcs_volumes` | `[]` | Buckets GCS montés via GCS Fuse. Vide par défaut et inutilisé par Infisical. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Infisical exige PostgreSQL. |
| `db_name` | `infisical` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | `infisical` | Utilisateur applicatif de la base de données. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs par défaut `db-init` + `admin-bootstrap` d'`Infisical_Common`. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `container_port` | Transmis à `Infisical_Common`. TCP, et non HTTP `/api/status` — voir [§1](#1-overview). |
| `liveness_probe` | **désactivée** | Transmis à `Infisical_Common`. Désactivée pour la même raison que la sonde de démarrage. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring — envisagez de faire pointer `path` vers `/api/status` pour obtenir un signal de santé externe pertinent. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Activer Redis pour le cache et la limitation de débit. |
| `redis_host` | `""` | Laissez vide pour utiliser par défaut l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Lorsqu'il est défini, fait basculer Infisical sur le secret `REDIS_URL` propre à `Infisical_Common` au lieu de l'injection en variables d'environnement en clair du socle. |
| `cubejs_api_url` / `hub_api_url` | URL localhost | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet.** |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

Entrées standard — consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` inutilisé). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État de la surveillance et tests de disponibilité. |
| `initialization_jobs` | Noms des jobs `db-init` et `admin-bootstrap`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État de la CI/CD et registre. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Posture de sécurité. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et leurs combinaisons au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ENCRYPTION_KEY` (généré automatiquement) | Ne jamais le faire pivoter après le premier démarrage | Critique | Le faire pivoter rend définitivement indéchiffrable chaque secret stocké auparavant. |
| `AUTH_SECRET` (généré automatiquement) | Ne le faire pivoter que pendant une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données ou l'utilisateur et détruit toutes les données. |
| `enable_redis` | Transmettre `var.enable_redis` sans condition à `App_CloudRun` | Critique | Le figer à `false` dans l'appel au socle laisse `REDIS_URL` totalement indéfini dans le cas courant sans authentification — Infisical plante au démarrage avec « Either REDIS_URL, REDIS_SENTINEL_HOSTS or REDIS_CLUSTER_HOSTS must be defined ». |
| `database_type` | `POSTGRES_15` | Critique | Toute valeur autre que Postgres est rejetée par la validation, ou (si elle était définie d'une manière ou d'une autre) Infisical ne parviendrait pas du tout à se connecter — MySQL n'est pas pris en charge. |
| `startup_probe` / `liveness_probe` | Conserver les valeurs par défaut du module (démarrage TCP, vivacité désactivée) | Élevé | Faire pointer l'une ou l'autre vers HTTP `/api/status` empêche la révision Cloud Run de devenir Ready — ce point de terminaison ne renvoie 2xx qu'après une disponibilité complète (base de données + Redis + dépendances), et Cloud Run n'achemine pas de trafic vers un service qui attend encore sa propre sonde de démarrage. |
| Job `admin-bootstrap` | Le déclencher manuellement après le premier déploiement sain | Élevé | Sans ce déclenchement, aucun compte administrateur n'existe et l'instance est inutilisable depuis l'interface ou l'API tant que le job n'a pas été exécuté. |
| `site_url` | Laisser vide pour l'URL `run.app` calculée automatiquement, ou définir explicitement pour un domaine personnalisé | Moyen | Une valeur incorrecte casse les liens d'invitation et d'e-mail, le CORS et la cible du job `admin-bootstrap`. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Faible | Ces variables sont déclarées par souci de parité avec les conventions, mais ne sont jamais transmises à `Infisical_Common` — les définir est sans effet. |
| `memory_limit` | `2Gi` (par défaut) ou plus | Moyen | Des valeurs inférieures exposent à des arrêts OOM sous une charge concurrente de récupération de secrets. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et réplication d'image — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Infisical,
partagée avec la variante GKE, est décrite dans
**[Infisical_Common](Infisical_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Infisical sur Cloud Run](../labs/Infisical_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Infisical sur GKE Autopilot](Infisical_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Infisical Common — Configuration applicative partagée](Infisical_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Keycloak sur Google Cloud Run](Keycloak_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **SSO Foundation**.
