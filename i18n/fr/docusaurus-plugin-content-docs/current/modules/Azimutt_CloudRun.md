---
title: "Azimutt sur Google Cloud Run"
description: "Référence de configuration pour déployer Azimutt sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Azimutt_CloudRun.md @ 3055034 sha256:dc88f17a5bf2 -->

# Azimutt sur Google Cloud Run {#azimutt-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_CloudRun.png" alt="Azimutt sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de bases de données de nouvelle génération et un outil d'ERD (diagramme
entité-relation) open source pour les bases de données réelles, construit avec Elixir/Phoenix. Il
permet aux équipes d'explorer, de documenter et de concevoir de grands schémas (des milliers de tables), de rechercher
parmi les colonnes et les relations, et de partager des diagrammes. Ce module déploie Azimutt sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Azimutt et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme un unique conteneur Elixir/Phoenix sur Cloud Run v2, à l'écoute sur le port
**4000**. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Phoenix, 2 vCPU / 4 GiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro activée |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Azimutt ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné ; les téléversements vont par défaut sur le disque local éphémère (`FILE_STORAGE_ADAPTER = local`) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` de Phoenix généré automatiquement ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Enveloppe légère FROM `ghcr.io/azimuttapp/azimutt`, mise en miroir dans Artifact Registry |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir tout autre moteur empêche le démarrage. Toutes les données de projet
  d'Azimutt (schémas, diagrammes, dispositions, utilisateurs) résident dans Postgres.
- **Azimutt se connecte à Postgres en TCP sur IP privée avec SSL, et non via le socket.**
  Ecto/postgrex ne sait pas analyser le DSN de socket Unix de Cloud SQL ; le point d'entrée cloud
  construit donc `DATABASE_URL` sur `DB_IP` et définit `DATABASE_ENABLE_SSL=true`. Le
  socket Cloud SQL reste monté (`enable_cloudsql_volume = true`) uniquement pour que la
  tâche `db-init` puisse créer le rôle et la base de données sans SSL.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager.
  Le renouveler après le premier démarrage déconnecte toutes les sessions actives ; ne le renouvelez que pendant une
  fenêtre de maintenance.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Azimutt est une application de type requête/réponse et un démarrage à froid
  se reconnecte proprement à Postgres. Les démarrages à froid ajoutent quelques secondes de latence après
  une période d'inactivité ; définissez `min_instance_count = 1` pour les éviter.
- **Les migrations s'exécutent automatiquement à chaque démarrage.** La commande du conteneur est
  `/app/bin/migrate && /app/bin/server` ; une montée de version applique donc ses modifications de
  schéma au démarrage — prévoyez du temps supplémentaire au premier démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Azimutt
  ne publie aucun tag `:latest` ; épinglez une version précise en production.
- **L'inscription est ouverte par défaut.** Azimutt permet à toute personne disposant de l'URL de créer un compte.
  Restreignez l'accès après avoir créé votre premier compte (domaine personnalisé + IAP, ou paramètres
  d'authentification propres à Azimutt via `environment_variables`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Azimutt {#a-cloud-run--the-azimutt-service}

Azimutt s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les
  métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the composed DB wiring the entrypoint logged at boot:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
    --limit 50 | grep cloud-entrypoint
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données applicatives (schémas, diagrammes, dispositions, utilisateurs, sources) dans une
instance gérée Cloud SQL for PostgreSQL 15. Sur Cloud Run, le service se connecte via
l'**IP privée** de l'instance avec SSL (`DATABASE_ENABLE_SSL=true`) — Ecto ne sait pas analyser
le DSN de socket. Lors du premier déploiement, une tâche (Job) d'initialisation crée la base de données applicative
et le rôle ; Azimutt exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné pour Azimutt. Avec la valeur par défaut
`FILE_STORAGE_ADAPTER = "local"`, Azimutt écrit les fichiers téléversés sur le disque local
éphémère du conteneur plutôt que dans ce bucket ; le bucket existe pour les opérateurs qui basculent
Azimutt vers un adaptateur de fichiers compatible S3. Les données de projet elles-mêmes résident dans Postgres.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** de Phoenix est généré automatiquement et stocké dans Secret
Manager (il sert à signer et chiffrer les cookies de session). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est une enveloppe légère construite FROM `ghcr.io/azimuttapp/azimutt` ; Cloud Build
produit l'image enveloppée, qui est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`). Le tag de base provient de l'argument de build `AZIMUTT_VERSION`
(`latest` étant mappé sur `main`).

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress
et l'egress VPC contrôlent la connectivité. L'egress VPC est nécessaire pour qu'Azimutt puisse
atteindre l'IP privée de Cloud SQL.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur arrivent dans Cloud Logging ; les métriques de Cloud Run et de Cloud SQL arrivent dans Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs. Les lignes `cloud-entrypoint`
indiquent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il crée de manière idempotente le rôle applicatif
  (`LOGIN CREATEDB`) et la base de données, accorde `ALL` sur la base de données et le schéma `public`,
  et modifie (`ALTER`) le propriétaire du schéma — Azimutt a besoin de droits DDL complets car il
  exécute ses propres migrations. La tâche peut être réexécutée sans risque.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est
  `/app/bin/migrate && /app/bin/server` ; Ecto applique donc les migrations en attente à chaque
  démarrage avant que le point de terminaison Phoenix ne se lie au port. Mettre à niveau `application_version` applique
  automatiquement les modifications de schéma — aucune étape de migration distincte.
- **Le câblage de la base de données à l'exécution est composé par le point d'entrée.** `DATABASE_URL` est construite à partir
  des variables `DB_*` injectées, le mot de passe est encodé pour URL et, sur Cloud Run, la
  connexion utilise l'IP privée (`DB_IP`) avec `DATABASE_ENABLE_SSL=true`. `PHX_HOST`
  est dérivé de l'URL du service injectée (sans le schéma).
- **`SECRET_KEY_BASE` est stable et, en pratique, immuable.** Il est généré une seule fois et
  écrit dans Secret Manager. Le renouveler invalide tous les cookies de session actifs —
  tous les utilisateurs sont déconnectés. Ne le renouvelez que pendant une fenêtre de maintenance.
- **Chemin de santé.** Les sondes de démarrage et de disponibilité ciblent la racine Phoenix `/` — le
  premier point de terminaison qui renvoie 200 une fois que le serveur a démarré et s'est connecté à
  Postgres. Prévoyez environ 1–2 minutes au premier démarrage pour les migrations (la sonde de démarrage
  fournit un délai initial de 60 secondes plus une fenêtre de nouvelles tentatives).
- **Configuration initiale.** Ouvrez l'URL du service et créez le premier compte Azimutt
  via la page d'inscription. L'inscription est ouverte par défaut — restreignez l'accès ensuite.
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Azimutt ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `azimutt` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Tag de l'image Azimutt ; `latest` correspond au tag `main`. Épinglez une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro ; définissez `1` pour les tâches Oban d'arrière-plan ou pour éviter les démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `4000` | Phoenix écoute sur 4000 ; les sondes doivent correspondre. |
| `cpu_always_allocated` | `false` | Facturation à la requête (CPU facturé uniquement pendant le traitement). Définissez `true` (avec `min ≥ 1`) uniquement pour les tâches Oban d'arrière-plan. |
| `enable_cloudsql_volume` | `true` | Monte le socket Cloud SQL pour la tâche `db-init` ; l'application se connecte toujours en TCP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public ; définissez `internal` pour le restreindre au VPC/à l'équilibreur de charge. |
| `enable_iap` | `false` | Exige une connexion Google devant Azimutt. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, `PORT`, `PHX_HOST` et `DATABASE_URL` sont définis automatiquement — ne les remplacez pas. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom de secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne et monte un partage NFS Filestore sur `nfs_mount_path` (`/opt/azimutt/storage`). Avec la valeur par défaut `FILE_STORAGE_ADAPTER = local`, Azimutt écrit toujours les téléversements dans son propre répertoire de travail éphémère plutôt que sur ce montage. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `azimutt` | Utilisateur applicatif de la base de données. Mot de passe généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai 60s | Sonde de démarrage ; prévoyez du temps pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les tâches d'arrière-plan, et non Redis. |
| `redis_host` | `""` | Point de terminaison Redis (uniquement si une fonctionnalité en aval l'exige). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun — `enable_vpc_sc`, `vpc_sc_dry_run`,
`enable_audit_logging`. Consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le renouveler hors d'une fenêtre de maintenance | Critical | Le renouveler invalide tous les cookies de session actifs — tous les utilisateurs sont déconnectés. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et rend orphelines toutes les données d'Azimutt. |
| `container_port` | `4000` | Critical | Phoenix se lie au port 4000 ; un port non concordant fait que chaque sonde frappe un port mort et la révision ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | High | Le montage du socket est ce qui permet à `db-init` de créer le rôle et la base de données sans SSL ; le désactiver casse l'amorçage du premier déploiement. |
| `application_version` | Épingler une version | High | `latest` correspond au tag mobile `main` ; un changement inattendu en amont peut casser un redéploiement. |
| `memory_limit` | `4Gi` | High | Sous-dimensionner la VM BEAM d'Elixir expose à des arrêts pour OOM lors du rendu de grands schémas. |
| `ingress_settings` / `enable_iap` | Restreindre après le premier compte | High | L'inscription est ouverte par défaut ; laisser le service accessible publiquement permet à n'importe qui de créer un compte. |
| `FILE_STORAGE_ADAPTER` (auto `local`) | Conserver `local` sauf en cas d'utilisation de S3 | Medium | `local` écrit les téléversements sur un disque éphémère — ils sont perdus lors d'un redéploiement ou d'une mise à l'échelle jusqu'à zéro. Les données de projet dans Postgres sont en sécurité. |
| `min_instance_count` | `0` (ou `1` pour les tâches d'arrière-plan) | Medium | La mise à l'échelle jusqu'à zéro ajoute une latence de démarrage à froid ; les tâches Oban d'arrière-plan nécessitent `min ≥ 1` + `cpu_always_allocated = true`. |
| `enable_redis` | `false` | Low | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Azimutt partagée
avec la variante GKE est décrite dans **[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Azimutt sur Cloud Run](../labs/Azimutt_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Azimutt sur GKE Autopilot](Azimutt_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration applicative partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) et [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) dans la solution **Self-service BI**.
