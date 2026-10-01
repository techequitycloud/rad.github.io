---
title: "Focalboard sur Google Cloud Run"
description: "Référence de configuration pour déployer Focalboard sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Focalboard_CloudRun.md @ 3055034 sha256:f991611fe015 -->

# Focalboard sur Google Cloud Run {#focalboard-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Focalboard_CloudRun.png" alt="Focalboard sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Focalboard est un serveur open source et auto-hébergé de tableaux Kanban et de
projets issu du projet Mattermost — un backend Go qui sert un frontend React compilé
pour gérer les tâches, les tableaux et les workflows. Ce module déploie Focalboard sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Focalboard et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Focalboard s'exécute dans un unique conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go sur le port 8000, 2 vCPU / 4 GiB par défaut ; autoscaling serverless avec mise à l'échelle jusqu'à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixe (`database_type = POSTGRES_15`) |
| Stockage des pièces jointes | Cloud Storage (GCS FUSE) | Un bucket dédié monté sur `/data` via gcsfuse afin que les pièces jointes téléversées survivent aux redémarrages |
| Secrets | Secret Manager | `FOCALBOARD_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données géré par le socle |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; Focalboard n'a aucune voie MySQL ou SQLite dans ce module.
- **Focalboard lit `config.json`, et non des variables d'environnement, pour la
  connexion à la base de données.** Un point d'entrée personnalisé régénère
  `/opt/focalboard/config.json` à partir des valeurs `DB_*` injectées par le socle à
  chaque démarrage, de sorte qu'aucun DSN n'est figé dans l'image.
- **Les pièces jointes résident sur un bucket GCS monté via gcsfuse sur `/data`.**
  Cloud Run n'offre pas d'option de PVC en mode bloc ; `enable_gcs_storage_volume = true`
  monte donc le bucket de stockage sur le `filespath` de Focalboard. Les *données* des
  tableaux (cartes, tableaux, utilisateurs) résident dans PostgreSQL ; seuls les
  fichiers téléversés aboutissent dans le bucket.
- **Aucun Redis n'est utilisé.** `enable_redis = false` — Focalboard conserve tout
  l'état des tableaux dans PostgreSQL et n'a besoin d'aucun cache ni d'aucune file
  d'attente externe.
- **La mise à l'échelle jusqu'à zéro est activée** (`min_instance_count = 0`,
  `max_instance_count = 5`). Les démarrages à froid ajoutent quelques secondes de
  latence à la première requête après une période d'inactivité ; définissez
  `min_instance_count = 1` pour garder une instance active.
- **L'image est une build personnalisée mise en miroir.** L'image officielle
  `mattermost/focalboard` est légèrement encapsulée et mise en miroir dans Artifact
  Registry ; `application_version` vaut `7.11.4` par défaut, et `latest` correspond à ce
  tag figé au moment du build (`latest` n'est pas un tag Focalboard publié).
- **Authentification native, le premier utilisateur est propriétaire.**
  `authMode = native` et les tableaux partagés publics sont activés ; le premier compte
  enregistré via l'interface devient le propriétaire de l'espace de travail. Aucun
  administrateur n'est créé à l'avance.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Focalboard {#a-cloud-run--the-focalboard-service}

Focalboard s'exécute comme un service Cloud Run v2 qui écoute sur le port **8000** et
s'adapte automatiquement à la charge des requêtes entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~focalboard"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Focalboard stocke toutes les données des tableaux (tableaux, cartes, blocs,
utilisateurs, sessions) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service
s'y connecte de façon privée — sur Cloud Run via l'IP privée du VPC avec
`sslmode=require`, ou via le socket Unix du **Cloud SQL Auth Proxy** lorsque
`enable_cloudsql_volume = true` ; aucune IP publique n'est exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — bucket des pièces jointes {#c-cloud-storage--attachment-bucket}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement et
monté sur `/data` via gcsfuse afin que les pièces jointes téléversées dans les tableaux
persistent malgré les redémarrages d'instances et la mise à l'échelle jusqu'à zéro. Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachment-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret applicatif est généré automatiquement et stocké dans Secret Manager :
`FOCALBOARD_ADMIN_PASSWORD` (une chaîne aléatoire de 24 caractères, injectée en tant que
variable d'environnement secrète du SERVICE). Un second secret dédié —
`secret-<resource_prefix>-focalboard-safe-db-password` (alphanumérique uniquement, sans
caractères spéciaux) — remplace le `DB_PASSWORD` du SERVICE et c'est la valeur que
`db-init` attribue réellement comme mot de passe au rôle Postgres (sous
`FOCALBOARD_SAFE_DB_PASSWORD`) ; la sortie `database_password_secret`, commune à toute
la flotte, ne permet **pas** de s'authentifier auprès de ce rôle. Consultez la
[section 3](#3-focalboard-application-behaviour).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, le service est accessible à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et
de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs. Le point d'entrée affiche au démarrage l'hôte, le nom,
l'utilisateur et le `sslmode` de base de données résolus — utile pour vérifier le
raccordement de la connexion.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Focalboard {#3-focalboard-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il crée de manière
  idempotente le rôle applicatif (`LOGIN CREATEDB`) et la base de données, accorde les
  privilèges et transfère la propriété du schéma `public` au rôle applicatif afin que
  Focalboard puisse exécuter ses migrations. Aucune extension Postgres n'est installée.
  La tâche peut être relancée sans risque.
- **Le véritable mot de passe du rôle est un secret dédié, uniquement alphanumérique, et
  non `database_password_secret`.** Le mot de passe de base de données standard du socle,
  commun à toute la flotte (jeu de caractères `_%@`), peut contenir un `%` qui fait
  planter le pilote postgres Go de Focalboard — sa validation de DSN basée sur
  `url.Parse` et son connecteur `lib/pq` effectif ne décodent pas les pourcentages de la
  même façon, si bien qu'aucun encodage unique de ce mot de passe ne satisfait les deux.
  `Focalboard_Common` génère un mot de passe distinct
  (`secret-<resource_prefix>-focalboard-safe-db-password`), remplace par celui-ci le
  `DB_PASSWORD` du SERVICE et le transmet à `db-init` sous `FOCALBOARD_SAFE_DB_PASSWORD`,
  qui est la valeur réellement attribuée comme mot de passe du rôle. La sortie
  `database_password_secret` (§5) indique le nom du secret commun à la flotte, qui ne
  permet pas de s'authentifier auprès de ce rôle.
- **Les migrations s'exécutent au démarrage.** Focalboard applique ses propres
  migrations de schéma à chaque démarrage en tant qu'utilisateur applicatif ; la mise à
  jour de `application_version` applique donc les modifications de schéma sans étape de
  migration distincte.
- **`config.json` est généré à l'exécution.** Focalboard n'offre aucune substitution par
  variable d'environnement pour la connexion à la base de données ; le point d'entrée
  écrit `/opt/focalboard/config.json` à partir des variables `DB_*` injectées à chaque
  démarrage. Sur Cloud Run, il se connecte via l'IP privée avec `sslmode=require` (en
  privilégiant `DB_IP`, car le socket Cloud SQL n'apparaît pas toujours).
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/` — l'interface web, qui renvoie 200 dès que le serveur s'est lié à son port et a
  terminé les migrations. Prévoyez jusqu'à ~7–8 minutes au premier démarrage (délai
  initial de démarrage de 60 secondes + une fenêtre de 15 s×30 tentatives).
- **Configuration au premier lancement.** Focalboard s'exécute en
  `authMode = native` ; ouvrez l'URL du service et enregistrez le premier compte, qui
  devient le propriétaire de l'espace de travail. `enablePublicSharedBoards` est activé,
  de sorte que les tableaux peuvent être partagés par des liens publics.
- **Pièces jointes et données.** Le contenu des tableaux réside dans PostgreSQL ; seuls
  les fichiers téléversés sont écrits dans le bucket monté via gcsfuse sur `/data`. Si le
  montage du bucket est absent, les téléversements échouent mais l'édition des tableaux
  continue de fonctionner.
- **Inspecter la configuration et les tâches en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Focalboard ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `focalboard` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `7.11.4` | Tag de l'image Focalboard ; `latest` correspond au tag figé `7.11.4` au moment du build. |
| `display_name` | `Focalboard` | Nom lisible affiché dans la console. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances. Peut être augmenté sans risque — l'état des tableaux réside dans PostgreSQL, pas dans chaque instance. |
| `container_port` | `8000` | Focalboard écoute sur le port 8000. |
| `enable_cloudsql_volume` | `true` | Socket Cloud SQL Auth Proxy ; le point d'entrée se rabat également sur une connexion TCP via l'IP privée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image `mattermost/focalboard` dans Artifact Registry. |
| `cpu_always_allocated` | `false` | Facturation à la requête (avec démarrage à froid). Focalboard n'a ni processus d'arrière-plan ni serveur WebSocket ; la mise à l'échelle jusqu'à zéro est donc sans risque. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Focalboard nécessite PostgreSQL 15. |
| `application_database_name` | `crappdb` | Nom de la base de données Cloud SQL, injecté sous `DB_NAME`. Immuable après le premier déploiement. |
| `application_database_user` | `crappuser` | Utilisateur de base de données de l'application, injecté sous `DB_USER`. Mot de passe généré automatiquement dans Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation facultative du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, timeout de 10 s, période de 15 s, 30 tentatives | Sonde de démarrage. Prévoyez ~7–8 minutes au premier démarrage pour les migrations. |
| `liveness_probe` | HTTP `/`, délai de 60 s, timeout de 5 s, période de 30 s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Focalboard ne nécessite pas Redis ; laissez-le désactivé. |

Toutes les autres entrées suivent le comportement et les valeurs par défaut standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de base de données standard commun à toute la flotte — **pas** l'identifiant avec lequel s'authentifie le rôle Postgres de Focalboard (voir la [section 3](#3-focalboard-application-behaviour)) ; utilisez plutôt `secret-<resource_prefix>-focalboard-safe-db-password`. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket des pièces jointes). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — une configuration IAP sans identités autorisées, un
> environnement d'exécution `gen1` avec des montages GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `backup_retention_days` hors plage. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant
> la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Injectés sous `DB_NAME`/`DB_USER` et immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données des tableaux. |
| Bucket des pièces jointes / `enable_gcs_storage_volume` | Conserver le montage gcsfuse sur `/data` | Critical | Sans montage persistant sur `filespath`, les pièces jointes téléversées sont écrites sur le disque éphémère de l'instance et perdues au redémarrage / lors de la mise à l'échelle jusqu'à zéro. |
| `database_type` | `POSTGRES_15` | Critical | Tout autre moteur empêche le démarrage de Focalboard — il n'existe ici aucune voie MySQL/SQLite. |
| `application_version` | Figer un tag réel (`7.11.4`) | High | `mattermost/focalboard:latest` n'est pas un tag publié ; le build fait correspondre `latest` au `FOCALBOARD_VERSION` figé, mais le figer explicitement évite les surprises. |
| `container_port` | `8000` | High | Focalboard se lie au port 8000 ; un port différent empêche la sonde de démarrage de réussir. |
| `enable_redis` | `false` | Medium | Focalboard n'a pas besoin de Redis ; l'activer raccorde une dépendance inutilisée. |
| `min_instance_count` | `1` pour un usage sensible à la latence | Medium | La mise à l'échelle jusqu'à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_cloudsql_volume` | `true` | Medium | Le point d'entrée se rabat sur une connexion TCP via l'IP privée avec `sslmode=require`, mais le socket de l'Auth Proxy est la voie principale. |
| Sortie `database_password_secret` | Ne pas l'utiliser pour se connecter | High | Indique le secret `DB_PASSWORD` commun à la flotte, qui ne permet pas de s'authentifier auprès du rôle Postgres de Focalboard. Récupérez `secret-<resource_prefix>-focalboard-safe-db-password` pour obtenir un identifiant fonctionnel. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Focalboard
partagée avec la variante GKE est décrite dans
**[Focalboard_Common](Focalboard_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Focalboard sur Cloud Run](../labs/Focalboard_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Focalboard sur GKE Autopilot](Focalboard_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Focalboard Common — Configuration applicative partagée](Focalboard_Common.md) — la configuration partagée par les deux cibles de déploiement.
