---
title: "Tolgee sur Google Cloud Run"
description: "Référence de configuration pour déployer Tolgee sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Tolgee_CloudRun.md @ 3055034 sha256:29cd8a4cd4c5 -->

# Tolgee sur Google Cloud Run {#tolgee-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_CloudRun.png" alt="Tolgee sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee est une plateforme open source de **localisation (i18n) et de gestion des traductions**,
pensée pour les développeurs et construite sur Spring Boot. Ce module déploie Tolgee sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Tolgee et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes
les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Tolgee s'exécute comme un conteneur Java / Spring Boot sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Spring Boot, 2 vCPU / 4 GiB par défaut, autoscaling serverless |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — Tolgee ne prend en charge ni MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket pour le stockage de fichiers facultatif (captures d'écran/imports) |
| Secrets | Secret Manager | Mot de passe administrateur initial et secret de signature JWT générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche applicative
  partagée ; choisir un autre moteur empêche le démarrage.
- **Tolgee se connecte à Cloud SQL en TCP, et non via un socket Unix.** Son pilote JDBC PostgreSQL
  intégré ne peut pas utiliser de socket ; sur Cloud Run, le point d'entrée se connecte donc via l'**IP privée** de Cloud
  SQL avec `sslmode=require`. C'est pourquoi `enable_cloudsql_volume` vaut
  **`false`** par défaut ici (pas de sidecar socket Auth Proxy).
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager. Il ne doit
  jamais faire l'objet d'une rotation après le premier démarrage sans fenêtre de maintenance — sa rotation
  invalide immédiatement toutes les sessions utilisateur actives.
- **`SERVER_PORT`, et non `PORT`.** Tolgee lit `SERVER_PORT = 8080` ; Cloud Run réserve
  `PORT`, c'est pourquoi le module définit explicitement `SERVER_PORT`.
- **`min_instance_count` vaut `1` et `cpu_always_allocated` vaut `true` par défaut.** Tolgee
  exécute des opérations par lots asynchrones (traduction automatique en masse, imports, suppressions) dans
  des threads d'arrière-plan internes au processus, après le retour de la requête déclenchante ; une facturation
  à la requête les limiterait à ~0 CPU. Inversez ces deux valeurs (`false` + `min = 0`) uniquement pour un
  déploiement purement interactif, axé sur le coût, qui n'exécute aucun gros traitement par lots.
- **Pas de Redis.** Tolgee stocke tout l'état des traductions dans PostgreSQL ; `enable_redis`
  vaut `false` par défaut.
- **Le schéma est créé par Liquibase au premier démarrage.** Il n'y a pas de job de migration distinct —
  la fondation crée le rôle et la base de données, et Tolgee effectue ses migrations automatiquement au démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Tolgee {#a-cloud-run--the-tolgee-service}

Tolgee s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal
et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tolgee stocke toutes les données applicatives (projets, langues, clés, traductions, utilisateurs) dans une
instance gérée Cloud SQL pour PostgreSQL 15. Le service se connecte via l'**IP privée** de Cloud SQL
(TCP, `sslmode=require`) plutôt que via un socket Unix, car le pilote JDBC de Tolgee
ne peut pas utiliser de socket. Lors du premier déploiement, l'étape `create-db-and-user.sh` de la fondation
crée la base de données et le rôle ; Tolgee exécute ensuite ses propres migrations Liquibase au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs).
Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation
des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (`name_suffix = "storage"`) est provisionné pour le stockage de fichiers
facultatif — Tolgee conserve les traductions dans PostgreSQL ; ce bucket ne contient donc que les
captures d'écran téléversées ou les artefacts d'import si vous le montez via `gcs_volumes` ou si vous configurez le
stockage de fichiers compatible S3 de Tolgee.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : le **mot de passe administrateur
initial** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`), utilisé pour la première connexion,
et le **secret de signature JWT** (`TOLGEE_AUTHENTICATION_JWT_SECRET`), utilisé pour signer tous les jetons
de session utilisateur. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`). Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté ; les paramètres d'ingress et la sortie VPC contrôlent la connectivité. Comme Tolgee se connecte
à Cloud SQL via l'IP privée, le service nécessite une sortie VPC (fournie par la
fondation).

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs. Le point de terminaison `/actuator/health`
est utilisé pour le test de disponibilité provisionné lorsque le service est joignable publiquement.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Tolgee {#3-tolgee-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Aucun job d'initialisation dédié ne s'exécute — l'étape
  `create-db-and-user.sh` de la fondation App_CloudRun crée le rôle et la base de données PostgreSQL et
  accorde la propriété du schéma. Tolgee crée ensuite et migre automatiquement l'intégralité de son schéma avec
  **Liquibase** au premier démarrage.
- **Migrations au démarrage.** Tolgee applique ses changesets Liquibase à chaque démarrage ; ainsi,
  la mise à niveau de `application_version` applique les changements de schéma sans étape distincte.
- **Le secret JWT est immuable après le premier démarrage.** Il est généré une seule fois, écrit dans
  Secret Manager et maintenu stable entre les redémarrages et les instances. La rotation de
  `TOLGEE_AUTHENTICATION_JWT_SECRET` invalide immédiatement toutes les sessions utilisateur actives —
  n'effectuez cette rotation que pendant une fenêtre de maintenance planifiée.
- **Connexion au premier lancement.** Après le déploiement, connectez-vous en tant que propriétaire initial :
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (par défaut `admin@techequity.cloud`) avec le
  mot de passe généré stocké dans Secret Manager. Modifiez le mot de passe et configurez des fournisseurs
  d'authentification supplémentaires (Google/OAuth2/SSO) depuis l'interface de Tolgee avant la mise en service.
- **Chemin de santé.** Les sondes de disponibilité, de démarrage et de vivacité ciblent **`/actuator/health`**,
  qui ne renvoie un `200` non authentifié qu'une fois les migrations Liquibase terminées. Prévoyez
  plusieurs minutes au premier démarrage (délai initial de 60 secondes plus une large fenêtre d'échecs) —
  Spring Boot et les migrations du premier lancement démarrent plus lentement qu'une application Node typique.
- **Les opérations par lots s'exécutent en arrière-plan.** La traduction automatique en masse, les imports et
  les suppressions s'exécutent de manière asynchrone dans des threads internes au processus après le retour de la requête, ce qui
  explique pourquoi `cpu_always_allocated = true` et `min_instance_count = 1` sont les valeurs par défaut.
- **Inspectez le câblage de la base de données de la révision en cours :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Tolgee ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `tolgee` | Nom de base du service Cloud Run et des secrets. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Tolgee utilisé comme `FROM tolgee/tolgee:<tag>` pour le build du wrapper personnalisé léger. Épinglez une version (par ex. `v3.130.4`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. Tolgee nécessite **au moins 2 GiB** pour fonctionner de manière fiable. |
| `min_instance_count` | `1` | Permet aux opérations par lots asynchrones de continuer entre les requêtes. `0` (mise à zéro) est sûr pour un usage purement interactif. |
| `max_instance_count` | `5` | Plafond de coût. Doit être ≥ `min_instance_count`. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que les traitements par lots internes au processus aboutissent. Passez à `false` (+ `min = 0`) pour des déploiements uniquement interactifs, axés sur le coût. |
| `container_port` | `8080` | `SERVER_PORT` Spring Boot de Tolgee. |
| `container_image_source` | `custom` | Construit le wrapper léger via Cloud Build. |
| `enable_cloudsql_volume` | `false` | **Défini à false par défaut** — le pilote JDBC de Tolgee ne peut pas utiliser de socket Cloud SQL ; il se connecte donc via l'IP privée (TCP, `sslmode=require`). |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Autorise l'accès public à l'interface et à l'API de Tolgee. Restreignez-le ou placez IAP en frontal pour les déploiements privés. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un NFS Cloud Filestore pour le stockage facultatif des pièces jointes de Tolgee. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour le bucket de stockage de fichiers facultatif. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `db_name` | `tolgee` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `tolgee` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Laissez désactivé — Tolgee stocke tout son état dans PostgreSQL et n'a pas besoin de Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les ressources
en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `redis_port`/`backup_retention_days` hors plage, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions utilisateur actives et oblige tout le monde à se reconnecter immédiatement. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `false` | Critique | Le pilote JDBC de Tolgee ne peut pas utiliser de socket Cloud SQL ; l'activer fait pointer `DB_HOST` vers un répertoire de socket et casse la connexion à la base de données. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous d'environ 2 GiB, la JVM Spring Boot tombe en OOM pendant les migrations Liquibase du premier démarrage. |
| `application_version` | Épinglée en production | Élevé | `latest` peut récupérer une nouvelle version majeure avec des migrations incompatibles lors d'un redéploiement. |
| `enable_redis` | `false` | Moyen | Redis n'est pas utilisé ; l'activer ajoute un coût sans bénéfice. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Moyen | Passer à une facturation à la requête avec mise à zéro limite les traitements par lots asynchrones (traduction automatique en masse/imports) à ~0 CPU et les bloque. |
| `startup_probe` (`/actuator/health`) | Conserver la large fenêtre du premier démarrage | Moyen | Une fenêtre trop étroite fait échouer la révision alors que les migrations Liquibase sont encore en cours sur une base neuve. |
| `ingress_settings` | `all` (ou IAP) | Moyen | Laisser l'accès public sans authentification expose l'interface et l'API de Tolgee ; le mot de passe administrateur initial doit être modifié immédiatement. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**.
La configuration applicative propre à Tolgee, partagée avec la variante GKE, est décrite dans
**[Tolgee_Common](Tolgee_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tolgee sur Cloud Run](../labs/Tolgee_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Tolgee sur GKE Autopilot](Tolgee_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tolgee Common — Configuration applicative partagée](Tolgee_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Unleash sur Google Cloud Run](Unleash_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) et [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) dans la solution **Release Management & Quality**.
