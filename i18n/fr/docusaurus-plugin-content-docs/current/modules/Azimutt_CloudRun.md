---
title: "Azimutt sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Azimutt sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Azimutt_CloudRun.md @ 15fd4c7 sha256:0774b1be3308 -->

# Azimutt sur Google Cloud Run {#azimutt-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_CloudRun.png" alt="Azimutt sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de base de données et un outil ERD (diagramme
entité-relation) open source de nouvelle génération pour les bases de données réelles,
construit avec Elixir/Phoenix. Il permet aux équipes d'explorer, de documenter et de
concevoir de grands schémas (des milliers de tables), de rechercher à travers les
colonnes et les relations, et de partager des diagrammes. Ce module déploie Azimutt
sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Azimutt utilise et sur la façon de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie
du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme un conteneur Elixir/Phoenix unique sur Cloud Run v2,
écoutant sur le port **4000**. Le déploiement connecte un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Phoenix, 2 vCPU / 4 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Azimutt ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné ; les téléchargements par défaut se font sur le disque éphémère local (`FILE_STORAGE_ADAPTER = local`) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Phoenix auto-générée ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Wrapper léger FROM `ghcr.io/azimuttapp/azimutt`, mis en miroir dans Artifact Registry |
| Ingestion | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage. Toutes les données du projet Azimutt (schémas, diagrammes, mises en
  page, utilisateurs) résident dans Postgres.
- **Azimutt se connecte à Postgres via TCP IP privée avec SSL, pas le socket.**
  Ecto/postgrex ne peut pas analyser le DSN du socket Unix de Cloud SQL, donc le
  point d'entrée cloud construit `DATABASE_URL` contre `DB_IP` et définit `DATABASE_ENABLE_SSL=true`. Le
  socket Cloud SQL est toujours monté (`enable_cloudsql_volume = true`) uniquement pour que le
  job `db-init` puisse créer le rôle/la base de données sans SSL.
- **`SECRET_KEY_BASE` est générée automatiquement** et stockée dans Secret Manager.
  La faire pivoter après le premier démarrage déconnecte chaque session active ; ne
  la faire pivoter que pendant une fenêtre de maintenance.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Azimutt est une application requête/réponse et un démarrage à froid
  se reconnecte proprement à Postgres. Les démarrages à froid ajoutent quelques
  secondes de latence après l'inactivité ; définissez `min_instance_count = 1` pour les éviter.
- **Les migrations s'exécutent automatiquement à chaque démarrage.** La commande du
  conteneur est `/app/bin/migrate && /app/bin/server`, donc une mise à niveau de version applique ses
  modifications de schéma au démarrage — prévoyez un temps supplémentaire au premier
  démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Azimutt
  ne publie pas de tag `:latest` ; épinglez à une version spécifique en production.
- **L'inscription est ouverte par défaut.** Azimutt permet à toute personne ayant
  l'URL de créer un compte. Restreignez l'accès après avoir créé votre premier
  compte (domaine personnalisé + IAP, ou les propres paramètres d'authentification
  d'Azimutt via `environment_variables`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Azimutt {#a-cloud-run--the-azimutt-service}

Azimutt s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge de requêtes entre le nombre minimal et maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre
les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the composed DB wiring the entrypoint logged at boot:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
    --limit 50 | grep cloud-entrypoint
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données d'application (schémas, diagrammes, mises en page,
utilisateurs, sources) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Sur
Cloud Run, le service se connecte via l'**IP privée** de l'instance avec SSL
(`DATABASE_ENABLE_SSL=true`) — Ecto ne peut pas analyser le DSN du socket. Lors du premier
déploiement, un job d'initialisation crée la base de données et le rôle de
l'application ; Azimutt exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné pour Azimutt. Avec le
`FILE_STORAGE_ADAPTER = "local"` par défaut, Azimutt écrit les téléchargements de fichiers sur le
disque éphémère local du conteneur plutôt que dans ce bucket ; le bucket existe pour
les opérateurs qui basculent Azimutt vers un adaptateur de fichiers compatible S3.
Les données du projet elles-mêmes résident dans Postgres.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** Phoenix est généré automatiquement et stocké dans Secret
Manager (utilisé pour signer et chiffrer les cookies de session). Le mot de passe de
la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est un wrapper léger construit FROM `ghcr.io/azimuttapp/azimutt` ; Cloud Build
produit l'image wrappée et elle est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`). Le tag de base provient de l'argument de build `AZIMUTT_VERSION` (avec
`latest` mappé à `main`).

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et ingestion {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés ; les paramètres d'ingestion et le contrôle d'égression VPC
contrôlent la connectivité. L'égression VPC est requise pour qu'Azimutt puisse
atteindre l'IP privée de Cloud SQL.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles. Les lignes `cloud-entrypoint` affichent le chemin
`DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle d'application (`LOGIN CREATEDB`) et la base de données,
  accorde `ALL` sur la base de données et le schéma `public`, et
  `ALTER` le propriétaire du schéma — Azimutt a besoin de tous les droits DDL
  car il exécute ses propres migrations. Le job peut être réexécuté en toute
  sécurité.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est
  `/app/bin/migrate && /app/bin/server`, donc Ecto applique les migrations en attente à chaque démarrage
  avant que le point de terminaison Phoenix ne se lie. La mise à niveau de
  `application_version` applique automatiquement les modifications de schéma — pas d'étape de
  migration séparée.
- **Le câblage de la base de données d'exécution est composé par le point
  d'entrée.** `DATABASE_URL` est construit à partir des variables `DB_*`
  injectées, le mot de passe est encodé en URL, et sur Cloud Run la connexion
  utilise l'IP privée (`DB_IP`) avec `DATABASE_ENABLE_SSL=true`. `PHX_HOST` est
  dérivé de l'URL de service injectée (schéma supprimé).
- **`SECRET_KEY_BASE` est stable et effectivement immuable.** Il est généré une fois et
  écrit dans Secret Manager. Le faire pivoter invalide chaque cookie de session
  actif — tous les utilisateurs sont déconnectés. Ne le faites pivoter que pendant
  une fenêtre de maintenance.
- **Chemin de santé.** Les sondes de démarrage et de disponibilité ciblent la racine
  Phoenix `/` — le premier point de terminaison qui renvoie 200 une fois
  que le serveur a démarré et s'est connecté à Postgres. Prévoyez environ 1 à 2
  minutes au premier démarrage pour les migrations (la sonde de démarrage fournit un
  délai initial de 60 secondes plus une fenêtre de nouvelle tentative).
- **Configuration initiale.** Ouvrez l'URL du service et créez le premier compte
  Azimutt via la page d'inscription. L'inscription est ouverte par défaut —
  restreignez l'accès par la suite.
- **Inspectez l'exécution du job d'initialisation :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Azimutt sont
listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

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
| `application_name` | `azimutt` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag de l'image Azimutt ; `latest` correspond au tag `main`. Épinglez à une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour les jobs Oban en arrière-plan ou pour éviter les démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `4000` | Phoenix écoute sur 4000 ; les sondes doivent correspondre. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (CPU facturé uniquement pendant le service). Définissez `true` (avec `min ≥ 1`) uniquement pour les jobs Oban en arrière-plan. |
| `enable_cloudsql_volume` | `true` | Monte le socket Cloud SQL pour le job `db-init` ; l'application se connecte toujours via TCP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingestion {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingestion publique ; définissez `internal` pour restreindre au VPC/LB. |
| `enable_iap` | `false` | Exiger la connexion Google devant Azimutt. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, `PORT`, `PHX_HOST` et `DATABASE_URL` sont définis automatiquement — ne les écrasez pas. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne et monte un partage NFS Filestore à `nfs_mount_path` (`/opt/azimutt/storage`). Avec le `FILE_STORAGE_ADAPTER = local` par défaut, Azimutt écrit toujours les téléchargements dans son propre répertoire de travail éphémère plutôt que sur ce montage. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse optionnels (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `azimutt` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai | Sonde de démarrage ; prévoir du temps pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les jobs en arrière-plan, pas Redis. |
| `redis_host` | `""` | Point de terminaison Redis (uniquement si une fonctionnalité en aval le requiert). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun — `enable_vpc_sc`, `vpc_sc_dry_run`,
`enable_audit_logging`. Voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à la phase (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de
> portée. Une configuration invalide fait échouer le **plan** avec une erreur claire
> et nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque cookie de session actif — tous les utilisateurs sont déconnectés. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et orpheline toutes les données Azimutt. |
| `container_port` | `4000` | Critique | Phoenix se lie au port 4000 ; un port non concordant fait que chaque sonde atteint un port mort et la révision ne devient jamais prête. |
| `enable_cloudsql_volume` | `true` | Élevé | Le montage du socket est ce qui permet à `db-init` de créer le rôle/la base de données sans SSL ; le désactiver interrompt le bootstrap du premier déploiement. |
| `application_version` | Épingler une version | Élevé | `latest` correspond au tag `main` roulant ; un changement inattendu en amont peut interrompre un redéploiement. |
| `memory_limit` | `4Gi` | Élevé | Sous-dimensionner la VM Elixir BEAM risque des OOM kills lors du rendu de grands schémas. |
| `ingress_settings` / `enable_iap` | Restreindre après le premier compte | Élevé | L'inscription est ouverte par défaut ; laisser le service publiquement accessible permet à quiconque de créer un compte. |
| `FILE_STORAGE_ADAPTER` (auto `local`) | Laisser `local` sauf si vous utilisez S3 | Moyen | `local` écrit les téléchargements sur le disque éphémère — ils sont perdus lors du redéploiement/de la mise à l'échelle à zéro. Les données du projet dans Postgres sont en sécurité. |
| `min_instance_count` | `0` (ou `1` pour les jobs en arrière-plan) | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid ; les jobs Oban en arrière-plan nécessitent `min ≥ 1` + `cpu_always_allocated = true`. |
| `enable_redis` | `false` | Faible | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingestion et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images —
voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Azimutt partagée avec la variante GKE est décrite dans
**[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Azimutt sur Cloud Run](../labs/Azimutt_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Azimutt sur GKE Autopilot](Azimutt_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration d'application partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) dans la solution **BI en libre-service**.
