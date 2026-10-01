---
title: "Fider sur Google Cloud Run"
description: "Référence de configuration pour déployer Fider sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Fider_CloudRun.md @ 3055034 sha256:41c67515e539 -->

# Fider sur Google Cloud Run {#fider-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_CloudRun.png" alt="Fider sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau open source et auto-hébergé de retours et de vote sur les
fonctionnalités — les clients publient des idées, votent et commentent, et vous
priorisez selon la demande. Ce module déploie Fider sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Fider et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute sous forme d'un unique conteneur Go sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique serverless |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Fider ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | Cloud Filestore (NFS) | Activé par défaut pour le stockage des pièces jointes |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée (`database_type = POSTGRES_15`) ; choisir un autre
  moteur empêche le démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il
  signe tous les jetons d'authentification et de session (y compris les liens de
  connexion magiques envoyés par e-mail) et **ne doit jamais faire l'objet d'une
  rotation après le premier démarrage** — cela invaliderait toutes les sessions
  actives et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état réside
  dans PostgreSQL ; il n'y a donc aucun processus de file d'attente à maintenir
  actif. Le module fournit `min_instance_count = 1` avec
  `cpu_always_allocated = true` pour un service constamment actif ; comme aucun
  traitement ne s'exécute en arrière-plan, définir `min_instance_count = 0` (mise à
  l'échelle à zéro) est sans risque pour les données si vous préférez échanger un
  démarrage à froid contre un coût moindre.
- **Pas de Redis.** Fider utilise une file d'attente et un cache adossés à
  PostgreSQL (`VALKEY_URL` vide) ; `enable_redis` vaut donc `false` par défaut.
  Laissez-le désactivé, sauf si vous externalisez délibérément vers Redis.
- **NFS est activé par défaut** (`enable_nfs = true`) afin de fournir un montage
  Cloud Filestore pour le stockage des pièces jointes de Fider.
- **Le conteneur écoute sur le port 3000.** Le point d'entrée exporte
  `PORT = 3000` ; Cloud Run injecte aussi automatiquement `PORT = <container_port>`.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée
  personnalisé exécute `./fider migrate` avant de lancer le serveur ; la mise à
  niveau de la version applique donc les modifications de schéma sans étape
  séparée.
- **L'e-mail est désactivé pour la démonstration.** Des valeurs SMTP fictives
  permettent à l'application de démarrer ; les liens d'inscription et d'invitation
  sont écrits dans le journal du conteneur jusqu'à ce qu'un vrai serveur SMTP soit
  configuré via `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Fider {#a-cloud-run--the-fider-service}

Fider s'exécute en tant que service Cloud Run v2 dont la mise à l'échelle
automatique suit la charge des requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~fider"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données de l'application (publications, votes,
commentaires, utilisateurs, paramètres) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de manière privée via le
**Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors
du premier déploiement, la tâche `db-init` crée le rôle et la base de données de
l'application et accorde les privilèges ; Fider exécute ensuite ses propres
migrations au démarrage.

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

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **activé par défaut** (`enable_nfs = true`) afin de fournir à Fider un
montage Cloud Filestore pour le stockage des pièces jointes. La VM du serveur NFS
partagé (gérée par `Services_GCP`) doit être à l'état `RUNNING` avant le
déploiement de l'application.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount path injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Fider n'utilise **pas** Redis — ne vous attendez pas à un point de terminaison
Memorystore ou Redis.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `JWT_SECRET` (signe les jetons d'authentification et de session). Le mot
de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et
la sortie VPC contrôlent la connectivité. Définissez un `BASE_URL` personnalisé via
`environment_variables` lorsque vous servez l'application depuis un domaine
personnalisé.

> **Utilisez l'URL à numéro de projet, pas `status.url`.** Chaque service Cloud Run
> est accessible par deux noms d'hôte tout aussi valides : une forme à numéro de
> projet (`https://<service>-<project-number>.<region>.run.app`) et une forme à
> suffixe aléatoire (`https://<service>-<random8>-<regioncode>.a.run.app`, celle que
> renvoie `gcloud run services
> describe --format='value(status.url)'`). L'en-tête Content-Security-Policy de
> Fider est limité au nom d'hôte avec lequel il a démarré — normalement la forme à
> numéro de projet — si bien qu'un navigateur arrivant sur la `status.url` à suffixe
> aléatoire voit toutes les requêtes de ressources (CSS, JS) bloquées par la CSP et
> affiche une page entièrement blanche. Partagez et consultez toujours la forme à
> numéro de projet.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec en option des tests de
disponibilité et des règles d'alerte. Notez que lorsque l'e-mail est désactivé, les
liens d'inscription et d'invitation apparaissent dans les journaux.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de données
  `fider`, accorde les privilèges et transfère la propriété du schéma `public` au
  rôle de l'application. La tâche peut être réexécutée sans risque.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé exécute
  `./fider migrate` avant de lancer le serveur (le `CMD` de l'image est remplacé par
  `./fider` uniquement). Les migrations sont idempotentes ; la mise à niveau de la
  version de l'application applique donc les modifications de schéma au démarrage
  suivant, sans étape de migration séparée.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une seule
  fois et écrit dans Secret Manager. Le modifier invalide toutes les sessions
  utilisateur actives et tous les liens de connexion envoyés par e-mail encore en
  attente. N'effectuez sa rotation que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'existe aucun identifiant par défaut. La première
  visite de l'URL du service guide un opérateur dans la création du site et de son
  propriétaire administrateur. Effectuez cette étape immédiatement après le
  déploiement — utilisez l'URL **à numéro de projet**, et non la forme
  `status.url` à suffixe aléatoire (voir l'avertissement CSP / page blanche dans
  [Réseau et entrée](#f-networking--ingress)) :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP fictives permettent à
  Fider de démarrer avec `EMAIL_NOEMAIL = true` ; les liens d'inscription et
  d'invitation sont écrits dans le journal du conteneur. Pour envoyer de vrais
  e-mails, définissez les variables SMTP de Fider (`EMAIL_SMTP_HOST`,
  `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_NOREPLY`)
  via `environment_variables` et supprimez `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/_health` —
  un point de terminaison non authentifié qui renvoie `200`. Prévoyez environ
  7 minutes au premier démarrage (la sonde de démarrage par défaut offre un délai
  initial de 30 secondes plus une fenêtre de 30 échecs avec une période de
  15 secondes).
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Fider ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Fider` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), associé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé sur `stable` (il n'existe pas de tag `:latest`) ; épinglez un tag SHA précis en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro. Fider n'a pas de worker en arrière-plan, rester à zéro est donc sans risque pour les données ; définissez `1` si vous souhaitez une base toujours active et acceptez le coût permanent. |
| `max_instance_count` | `5` | Plafond de coût ; doit être ≥ `min_instance_count`. |
| `cpu_always_allocated` | `false` | Facturation à l'instance pour un service constamment actif ; vous pouvez définir `false` sans risque pour une facturation à la requête, puisque Fider n'effectue aucun traitement en arrière-plan. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; Cloud Run injecte automatiquement `PORT`. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Duplique l'image Fider dans Artifact Registry. |

### Groupe 5 — Contrôle des accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public ; requis pour accéder au site depuis les navigateurs. |
| `enable_iap` | `false` | Exige une connexion Google devant Fider. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Configurez ici un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou un `BASE_URL` personnalisé. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ni `PORT`. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création des secrets avant de continuer. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `enable_nfs` | `true` | Montage Cloud Filestore pour le stockage des pièces jointes de Fider. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL. |
| `db_name` | `fider` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `fider` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, délai de 30s | Prévoyez environ 7 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/_health`, période de 30s | Sonde d'activité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider s'appuie sur Postgres ; laissez-le désactivé sauf si vous externalisez vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinents uniquement si Redis est activé. |

Toutes les autres entrées suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `JWT_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation invalide toutes les sessions actives et les liens de connexion envoyés par e-mail encore en attente. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critical | Tout moteur autre que PostgreSQL empêche le démarrage — Fider ne fonctionne qu'avec Postgres. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans source de sauvegarde valide fait échouer la tâche d'import. |
| `container_port` | `3000` | High | Un port incorrect fait que les sondes visent un port inactif et la révision ne devient jamais Ready. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | High | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` sur `stable`, mais épinglez explicitement une version pour des mises à niveau reproductibles. |
| `memory_limit` | `4Gi` (par défaut) | Medium | Une taille insuffisante risque des arrêts OOM sous charge ; Fider lui-même est léger. |
| `enable_nfs` | `true` (par défaut) | Medium | Ne le désactivez que si vous n'avez pas besoin du stockage des pièces jointes ; la VM NFS partagée doit être à l'état `RUNNING` avant le déploiement. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` (par défaut) | Low | Fider n'a pas de worker en arrière-plan — `0` / `false` est sans risque pour les données et moins coûteux, au prix de démarrages à froid. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un envoi réel | Medium | Avec les valeurs fictives, les liens d'inscription et d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | High | IAP bloque toutes les requêtes non authentifiées, y compris la consultation anonyme du tableau. |
| URL Cloud Run à consulter | forme à numéro de projet, pas `status.url` | High | La CSP de Fider est limitée au nom d'hôte à numéro de projet ; consulter la forme `status.url` à suffixe aléatoire fait bloquer toutes les ressources par le navigateur, ce qui affiche une page blanche. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Fider partagée avec la variante GKE est décrite dans
**[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Fider sur Cloud Run](../labs/Fider_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Fider sur GKE Autopilot](Fider_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration applicative partagée](Fider_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
