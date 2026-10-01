---
title: "GoAlert sur Google Cloud Run"
description: "Référence de configuration pour déployer GoAlert sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GoAlert_CloudRun.md @ 3055034 sha256:9a47c2abe6b3 -->

# GoAlert sur Google Cloud Run {#goalert-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_CloudRun.png" alt="GoAlert sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open source sous licence Apache 2.0 de planification
d'astreintes et d'escalade des alertes d'incident, créée à l'origine par Target et
exploitée en production à grande échelle. Elle permet aux équipes de définir des
politiques d'escalade, des rotations et des plannings d'astreinte, et d'envoyer des
notifications sortantes par e-mail, webhook ou (en option) SMS/appel vocal Twilio. Ce
module déploie GoAlert sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise GoAlert et sur la façon de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, scaling et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute sous la forme d'un unique binaire Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go, 1 vCPU / 512 MiB par défaut, `cpu_always_allocated = true`, `min_instance_count = 1` — pas de mise à l'échelle à zéro |
| Base de données | Cloud SQL for PostgreSQL (`POSTGRES_17`) | Obligatoire — GoAlert ne prend en charge ni MySQL ni d'autres moteurs ; l'extension `pgcrypto` est installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur et clé de chiffrement des données générés automatiquement ; mot de passe de la base de données géré par le socle |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

Ce tableau ne comporte **aucune ligne de stockage d'objets** — la sortie
`storage_buckets` de `GoAlert_Common` vaut toujours `[]`. GoAlert ne dispose d'aucune
fonctionnalité de téléversement de fichiers ou de pièces jointes ; tout l'état de
l'application (politiques d'escalade, plannings, alertes, historique des notifications,
utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par
  `GoAlert_Common` ; choisir un autre moteur empêche le démarrage.
- **CPU toujours alloué, pas de mise à l'échelle à zéro.** `cpu_always_allocated = true`
  et `min_instance_count = 1` sont les valeurs par défaut, car GoAlert exécute en continu
  une boucle « moteur » intégrée au processus qui évalue le minutage des politiques
  d'escalade, l'état des rotations et l'envoi des notifications sortantes. Avec une
  facturation à la requête ou à zéro instance, cette boucle ne s'exécute tout simplement
  pas — une alerte créée via l'API ou un webhook pourrait ne jamais être escaladée, sans
  aucun signal.
- **`max_instance_count` reste à 1.** GoAlert prend officiellement en charge plusieurs
  instances de moteur simultanées (il ne s'agit pas d'un bug de double déclenchement selon
  la documentation amont), mais recommande d'exécuter une instance en mode par défaut plus
  des réplicas `--api-only` supplémentaires pour éviter la contention — une topologie à
  deux niveaux que ce module ne met pas en place.
- **Ni Redis, ni stockage d'objets.** L'état de GoAlert réside entièrement dans
  PostgreSQL ; il n'a besoin d'aucun cache, d'aucune file ni d'aucun stockage de fichiers
  externes.
- **`GOALERT_DB_URL` est assemblée au démarrage du conteneur, pas au moment du plan.**
  GoAlert n'accepte qu'une seule variable d'environnement de chaîne de connexion Postgres,
  et le `DB_PASSWORD` issu de Secret Manager à l'exécution ne peut être encodé pour une URL
  qu'au démarrage effectif du conteneur — `entrypoint.sh` (ainsi que chaque script de job
  d'initialisation) la construit à partir des valeurs `DB_*` distinctes injectées par le
  socle.
- **`public_url` calcule automatiquement une URL `run.app` lorsqu'elle est laissée vide.**
  `GoAlert_CloudRun` transmet `public_url = var.public_url != "" ? var.public_url :
  "https://${service_name}-${project_number}.${region}.run.app"` à
  `GoAlert_Common`, de sorte que `GOALERT_PUBLIC_URL` (utilisée pour la validation OIDC/du référent CSRF et pour
  les liens des notifications sortantes) est correcte d'emblée — une commodité dont la
  variante GKE ne dispose pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service
et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service GoAlert {#a-cloud-run--the-goalert-service}

GoAlert s'exécute comme un service Cloud Run v2 toujours actif (minimum 1 instance, CPU
toujours alloué) plutôt que mis à l'échelle automatiquement jusqu'à zéro, afin que la
boucle de son moteur d'escalade continue de tourner en permanence.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade, plannings,
rotations, alertes, historique des notifications et utilisateurs — dans une instance gérée
Cloud SQL PostgreSQL. Le service s'y connecte en privé via le **Cloud SQL Auth Proxy** sur
un socket Unix ; aucune IP publique n'est exposée. `entrypoint.sh` détecte le socket et
crée un lien symbolique vers `/tmp/.s.PGSQL.5432` avant d'assembler `GOALERT_DB_URL`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans Secret
Manager : le **mot de passe administrateur** (consommé par le job d'initialisation
`admin-bootstrap`) et une **clé de chiffrement des données** (recommandée par la
documentation amont de GoAlert pour chiffrer au repos les clés d'API et la configuration
sensible stockées, sans toutefois être imposée par le code au démarrage). Le mot de passe
de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les
paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est essentielle.** `GoAlert_Common`
  définit trois Cloud Run Jobs ordonnés, chacun dépendant du précédent, tous avec
  `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de données
     PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
     — exécute `goalert migrate --db-url=...` et applique le schéma propre à GoAlert. Il
     **doit** s'exécuter avant `admin-bootstrap` : `goalert add-user` ne comporte aucune
     logique de migration et, sur une base de données vierge, échoue avec
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute `goalert add-user --admin` directement sur Postgres pour
     créer le premier compte administrateur. Son exécution au moment de l'application est
     sans risque (contrairement à un amorçage via HTTP), car il s'adresse directement à la
     base de données et non au serveur en cours d'exécution.

  Les trois scripts réessaient en interne (jusqu'à 10 tentatives, espacées de 5s) pour
  absorber la latence de planification de Cloud SQL et des Cloud Run Jobs, et les Cloud
  Run Jobs eux-mêmes réessaient jusqu'à 3 fois en cas d'échec.

- **Aucun assistant de configuration à la première visite.** GoAlert ne propose aucun
  parcours web de création de l'administrateur initial — le job `admin-bootstrap` est le
  seul moyen de créer un compte administrateur. Récupérez le mot de passe généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison public et non
  authentifié documenté de GoAlert (200 dès que le cycle de vie de l'application a quitté
  l'état « Starting »). Les sondes de démarrage et de vivacité de ce module effectuent par
  défaut une vérification de port **TCP** plutôt qu'une vérification de chemin HTTP — une
  valeur par défaut prudente conforme au modèle établi de ce catalogue — et les deux se
  sont révélées correctes lors d'une vérification en conditions réelles (HTTP 200 sur
  `/health` avec de véritables lignes de journal « listening and serving HTTP »).

- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à GoAlert ou notables pour lui sont listés ;
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
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par ex. `cr`) de celle de tout `GoAlert_GKE` déployé en parallèle (`gke`) pour éviter une collision de noms. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `GoAlert` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`), conformément à la recommandation amont qui déconseille `latest`/`nightly` nus en production. |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. Effectivement transmis via `goalert.tf` à `GoAlert_Common`. |
| `admin_email` | `admin@techequity.cloud` | Adresse e-mail du compte administrateur initial. |
| `public_url` | `""` | Laissée vide, elle est calculée automatiquement : `https://<service>-<project-number>.<region>.run.app`. Utilisée pour la validation OIDC/du référent CSRF et pour les liens des notifications sortantes. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU suffit pour le binaire Go de GoAlert. |
| `memory_limit` | `512Mi` | Plancher strict de Gen2, indépendant de `cpu_always_allocated`. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué pendant toute la vie d'une instance EN COURS D'EXÉCUTION — requis pour la boucle continue du moteur d'escalade. |
| `min_instance_count` | `1` | Pas de mise à l'échelle à zéro — à zéro instance, le moteur d'escalade ne s'exécute pas du tout. |
| `max_instance_count` | `1` | Une seule instance de moteur en mode par défaut ; plusieurs instances nécessitent une topologie `--api-only` que ce module ne met pas en place. |
| `container_port` | `8081` | Port HTTP natif de GoAlert (`GOALERT_LISTEN`). |
| `execution_environment` | `gen2` | Environnement d'exécution requis. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy sur socket Unix. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du socket de l'Auth Proxy dans le conteneur. |
| `container_protocol` | `http1` | `"http1"` ou `"h2c"`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base de GoAlert dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle du trafic entrant. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Contrôle de l'egress VPC. |
| `enable_iap` | `false` | Identity-Aware Proxy. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GOALERT_LISTEN` et `GOALERT_PUBLIC_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `db_name` | `goalert` | Nom de la base de données PostgreSQL. |
| `db_user` | `goalert` | Utilisateur applicatif PostgreSQL. |
| `db_password_env_var_name` | `""` | **Valeur par défaut résiduelle copiée-collée d'un modèle antérieur.** Additive selon la sémantique du socle — injecte une variable d'environnement secrète supplémentaire inutilisée, à côté du `DB_PASSWORD` standard que lit réellement le point d'entrée de GoAlert. Sans danger ; videz-la (`""`) si elle vous gêne. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour la chaîne par défaut de 3 jobs de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). Une liste non vide la remplace entièrement — vous prenez alors en charge l'ordre et le contenu. |
| `cron_jobs` | `[]` | GoAlert ne comporte par défaut aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, 30 tentatives | Absorbe la latence des migrations au premier démarrage (`db-migrate`). |
| `liveness_probe` | désactivée | Cloud Run redémarre le conteneur à la sortie du processus ; la sonde de démarrage conditionne la disponibilité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité avec la plateforme. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Intégration VPC-SC standard d'`App_CloudRun` — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne aucun bucket de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` | État de la CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par
> le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et
> leurs combinaisons au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critique | Tout autre moteur casse entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont propres à Postgres. |
| Ordre de `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laissez `[]` sauf si vous maîtrisez parfaitement la chaîne de dépendances | Critique | Exécuter `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données vierge — `goalert add-user` ne comporte aucune logique de migration. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | Élevé | Le moteur de minutage des escalades de GoAlert est une boucle continue intégrée au processus — à zéro instance, ou avec une facturation à la requête qui bride le CPU, les escalades d'alertes réelles peuvent être retardées, voire totalement manquées, sans aucun signal. |
| `public_url` | Laissez `""` (calculée automatiquement) ou définissez l'URL externe réelle | Élevé | Une `GOALERT_PUBLIC_URL` incorrecte casse les rappels d'authentification OIDC et tous les liens des e-mails de notification sortants (retour à la valeur propre à GoAlert, `http://localhost:8081`, si elle n'est réellement pas définie en aval). |
| `admin_username` / `admin_email` | À définir une seule fois ; récupérez le mot de passe dans Secret Manager | Moyen | GoAlert n'offre aucun parcours de réinitialisation du mot de passe en libre-service visible depuis Terraform ; perdre la trace de l'identifiant administrateur amorcé oblige à utiliser directement la CLI `goalert` sur la base de données pour en créer un nouveau. |
| `max_instance_count` | `1`, sauf si vous mettez en place une topologie `--api-only` | Moyen | GoAlert prend en charge plusieurs instances de moteur sans risque (il ne s'agit pas d'un bug de double déclenchement selon la documentation amont), mais ce module ne dispose d'aucun mécanisme intégré pour désigner des réplicas `--api-only` ; dépasser 1 sans ce câblage supplémentaire revient donc simplement à exécuter plusieurs instances complètes du moteur. |
| `db_password_env_var_name` | Laissez tel quel ou videz-la (`""`) | Faible | La valeur par défaut `LISTMONK_db__password` est un résidu inerte du modèle d'un autre module — sans danger, mais déroutant si vous la cherchez dans la configuration réelle de GoAlert. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, scaling et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à GoAlert,
partagée avec la variante GKE, est décrite dans
**[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoAlert sur Cloud Run](../labs/GoAlert_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur GKE Autopilot](GoAlert_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration applicative partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md) et [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) dans la solution **Observability & On-call**.
