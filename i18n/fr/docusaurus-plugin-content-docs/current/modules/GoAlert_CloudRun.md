---
title: "GoAlert sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de GoAlert sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoAlert_CloudRun.md @ 15fd4c7 sha256:c9240c3b63b9 -->

# GoAlert sur Google Cloud Run {#goalert-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_CloudRun.png" alt="GoAlert sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open source, sous licence Apache 2.0, de planification
d'astreintes et d'escalade d'alertes d'incidents, initialement conçue par Target
et exécutée en production à grande échelle. Elle permet aux équipes de définir
des politiques d'escalade, des rotations et des plannings d'astreinte, et
d'envoyer des notifications par e-mail, webhook ou (en option) SMS/voix Twilio.
Ce module déploie GoAlert sur **Cloud Run v2** en s'appuyant sur la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par GoAlert et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute comme un seul binaire Go sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go, 1 vCPU / 512 Mio par défaut, `cpu_always_allocated = true`, `min_instance_count = 1` — pas de mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL (`POSTGRES_17`) | Requis — GoAlert ne prend pas en charge MySQL ou d'autres moteurs ; l'extension `pgcrypto` est installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré et clé de chiffrement des données ; mot de passe de la base de données géré par la fondation |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

Il n'y a **pas de ligne de stockage d'objets** dans ce tableau — la sortie
`GoAlert_Common` de `storage_buckets` est toujours `[]`. GoAlert n'a pas de
fonctionnalité de téléchargement/pièce jointe de fichiers ; chaque élément de
l'état de l'application (politiques d'escalade, plannings, alertes, historique
des notifications, utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par `GoAlert_Common` ;
  la sélection de tout autre moteur interrompt le démarrage.
- **CPU toujours actif, pas de mise à l'échelle à zéro.** `cpu_always_allocated = true` et
  `min_instance_count = 1` sont les valeurs par défaut car GoAlert exécute une boucle
  continue de "moteur" en cours de processus qui évalue le timing des politiques
  d'escalade, l'état de rotation et l'envoi des notifications sortantes. Sous une
  facturation basée sur les requêtes ou à zéro instance, cette boucle ne
  s'exécute tout simplement pas — une alerte créée via API/webhook pourrait ne
  jamais être escaladée silencieusement.
- **`max_instance_count` reste à 1.** GoAlert prend officiellement en charge plusieurs
  instances de moteur concurrentes (pas un bug de double déclenchement selon la
  documentation amont), mais recommande d'exécuter une instance en mode par
  défaut plus des réplicas `--api-only` supplémentaires pour éviter les
  contentions — une topologie à deux niveaux que ce module ne connecte pas.
- **Pas de Redis, pas de stockage d'objets.** L'état de GoAlert réside
  entièrement dans PostgreSQL ; il n'a pas besoin de cache externe, de file
  d'attente ou de stockage de fichiers.
- **`GOALERT_DB_URL` est assemblé au démarrage du conteneur, pas au moment de la
  planification.** GoAlert n'accepte qu'une seule variable d'environnement de
  chaîne de connexion Postgres, et le `DB_PASSWORD` provenant de Secret Manager
  au moment de l'exécution ne peut pas être encodé en URL tant que le conteneur
  n'a pas réellement démarré — `entrypoint.sh` (et chaque script de job
  d'initialisation) le construit à partir des valeurs `DB_*` discrètes
  injectées par la Fondation.
- **`public_url` calcule automatiquement une URL `run.app` lorsqu'il est laissé
  vide.** `GoAlert_CloudRun` passe `public_url = var.public_url != "" ? var.public_url :
  "https://${service_name}-${project_number}.${region}.run.app"` dans `GoAlert_Common`, de sorte que
  `GOALERT_PUBLIC_URL` (utilisé pour la validation OIDC/CSRF-referer et les liens dans
  les notifications sortantes) est correct dès la sortie de la boîte. Utilisez la
  sortie `service_url` : atteindre le service par l'autre nom d'hôte de Cloud Run
  (la forme hachée affichée dans la console Cloud Run) échoue à la vérification
  CSRF-referer de la première connexion — un navigateur est redirigé vers l'URL
  canonique, mais un client API codé en dur vers l'URL de la console se brise.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service GoAlert {#a-cloud-run--the-goalert-service}

GoAlert s'exécute comme un service Cloud Run v2, toujours actif (minimum 1
instance, CPU toujours alloué) plutôt que mis à l'échelle à zéro, de sorte que
sa boucle de moteur d'escalade continue de fonctionner en permanence.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade,
plannings, rotations, alertes, historique des notifications et utilisateurs —
dans une instance Cloud SQL PostgreSQL gérée. Le service se connecte
privatement via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP
publique n'est exposée. `entrypoint.sh` détecte le socket et le lie
symboliquement à `/tmp/.s.PGSQL.5432` avant d'assembler `GOALERT_DB_URL`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans Secret
Manager : le **mot de passe administrateur** (consommé par le job
d'initialisation `admin-bootstrap`) et une **clé de chiffrement des données**
(recommandée par la documentation GoAlert amont pour chiffrer les clés API
stockées/la configuration sensible au repos, bien que non appliquée par le code
au démarrage). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent
la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est essentielle.** `GoAlert_Common`
  définit trois jobs Cloud Run ordonnés, chacun dépendant du précédent, tous avec
  `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de données
     PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`) — exécute
     `goalert migrate --db-url=...`, appliquant le propre schéma de GoAlert. Cela **doit**
     s'exécuter avant `admin-bootstrap` : `goalert add-user` n'a pas de logique de
     migration propre, et sur une base de données fraîche, il échoue avec
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute
     `goalert add-user --admin` directement contre Postgres pour créer la première
     connexion administrateur. Il peut être exécuté en toute sécurité au moment
     de l'apply (contrairement à un bootstrap basé sur HTTP) car il communique
     directement avec la base de données, et non avec le serveur en cours
     d'exécution.

  Les trois scripts réessayent en interne (jusqu'à 10 tentatives, espacées de 5
  secondes) pour absorber la latence de planification des jobs Cloud SQL/Cloud
  Run, et les jobs Cloud Run eux-mêmes réessayent jusqu'à 3 fois en cas
  d'échec.

- **Pas d'assistant de configuration à la première visite.** GoAlert n'a pas de
  flux d'administration initial basé sur le web — le job `admin-bootstrap` est le
  seul moyen de créer un compte administrateur. Récupérez le mot de passe
  généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison
  public, non authentifié et documenté de GoAlert (200 une fois que le cycle de
  vie de l'application quitte l'état "Starting"). Les sondes de démarrage et de
  vivacité de ce module utilisent par défaut une vérification de port **TCP**
  plutôt qu'une vérification de chemin HTTP — une valeur par défaut prudente
  correspondant au modèle établi de ce catalogue — et les deux se sont avérées
  correctes lors de la vérification en direct (HTTP 200 sur `/health` avec de
  vraies lignes de journal "listening and serving HTTP").

- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
GoAlert sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `cr`) de tout `GoAlert_GKE` (`gke`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `GoAlert` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`), correspondant à la propre recommandation amont contre les `latest`/`nightly` nus en production. |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. Genuinement transmis via `goalert.tf` dans `GoAlert_Common`. |
| `admin_email` | `admin@techequity.cloud` | E-mail pour le compte administrateur initial. |
| `public_url` | `""` | Laissé vide, calcule automatiquement `https://<service>-<project-number>.<region>.run.app`. Utilisé pour la validation OIDC/CSRF-referer et les liens de notification sortants. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU est suffisant pour le binaire Go de GoAlert. |
| `memory_limit` | `512Mi` | Plancher dur Gen2, indépendant de `cpu_always_allocated`. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué pendant toute la durée de vie d'une instance EN COURS D'EXÉCUTION — requis pour la boucle continue du moteur d'escalade. |
| `min_instance_count` | `1` | Pas de mise à l'échelle à zéro — à zéro instance, le moteur d'escalade ne fonctionne pas du tout. |
| `max_instance_count` | `1` | Instance de moteur unique en mode par défaut ; une topologie `--api-only` multi-instances n'est pas câblée par ce module. |
| `container_port` | `8081` | Port HTTP natif de GoAlert (`GOALERT_LISTEN`). |
| `execution_environment` | `gen2` | Environnement d'exécution requis. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Sidecar du proxy d'authentification Cloud SQL Unix-socket. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du conteneur pour le socket du proxy d'authentification. |
| `container_protocol` | `http1` | `"http1"` ou `"h2c"`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base GoAlert dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle d'ingress du trafic. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Contrôle d'egress VPC. |
| `enable_iap` | `false` | Proxy sensible à l'identité. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GOALERT_LISTEN` et `GOALERT_PUBLIC_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `db_name` | `goalert` | Nom de la base de données PostgreSQL. |
| `db_user` | `goalert` | Utilisateur de l'application PostgreSQL. |
| `db_password_env_var_name` | `""` | **Valeur par défaut copiée-collée d'un modèle précédent.** Additif selon la sémantique de la Fondation — injecte une variable d'environnement secrète supplémentaire inutilisée à côté du `DB_PASSWORD` standard que le point d'entrée de GoAlert lit réellement. Inoffensif ; effacez-le à `""` si cela vous dérange. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour la chaîne de 3 jobs par défaut de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). Une liste non vide la remplace entièrement — vous prenez en charge l'ordre et le contenu. |
| `cron_jobs` | `[]` | GoAlert n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, 30s de délai, 30 tentatives | S'adapte à la latence de migration au premier démarrage (`db-migrate`). |
| `liveness_probe` | désactivé | Cloud Run redémarre le conteneur à la sortie du processus ; la sonde de démarrage conditionne la disponibilité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité de la plateforme. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

Intégration standard `App_CloudRun` VPC-SC — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne aucun bucket de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critique | Tout autre moteur rompt entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont spécifiques à Postgres. |
| Ordre `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laissez `[]` à moins que vous ne compreniez parfaitement la chaîne de dépendances | Critique | L'exécution de `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données fraîche — `goalert add-user` n'a pas de logique de migration propre. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | Élevé | Le moteur de synchronisation d'escalade de GoAlert est une boucle continue en cours de processus — à zéro instance, ou sous une facturation basée sur les requêtes avec limitation du CPU, les escalades pour les alertes réelles peuvent être silencieusement retardées ou manquées entièrement. |
| `public_url` | Laissez `""` (calculé automatiquement) ou définissez l'URL externe réelle | Élevé | Un `GOALERT_PUBLIC_URL` incorrect rompt les rappels d'authentification OIDC et chaque lien dans les e-mails de notification sortants (revient au propre `http://localhost:8081` de GoAlert s'il n'est pas défini en aval). |
| `admin_username` / `admin_email` | Définir une fois, récupérer le mot de passe de Secret Manager | Moyen | GoAlert n'a pas de flux de réinitialisation de mot de passe en libre-service visible depuis Terraform ; perdre la trace de l'identifiant administrateur amorcé signifie utiliser la CLI `goalert` directement contre la base de données pour en créer un nouveau. |
| `max_instance_count` | `1` à moins que vous ne câbliez une topologie `--api-only` | Moyen | GoAlert prend en charge plusieurs instances de moteur en toute sécurité (pas un bug de double déclenchement selon la documentation amont), mais ce module n'a pas de mécanisme intégré pour désigner les réplicas `--api-only`, donc la mise à l'échelle au-delà de 1 sans ce câblage supplémentaire exécute simplement plusieurs instances de moteur complètes. |
| `db_password_env_var_name` | Laissez tel quel ou effacez à `""` | Faible | Le `LISTMONK_db__password` par défaut est un résidu inerte d'un modèle d'un autre module — inoffensif, mais déroutant si vous le cherchez dans la configuration réelle de GoAlert. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à GoAlert partagée avec la variante GKE est décrite
dans **[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoAlert sur Cloud Run](../labs/GoAlert_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur GKE Autopilot](GoAlert_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration d'application partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) dans la solution **Observabilité et astreinte**.
