---
title: "GoToSocial sur GKE Autopilot"
description: "Référence de configuration pour déployer GoToSocial sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GoToSocial_GKE.md @ 3055034 sha256:4004f659d20c -->

# GoToSocial sur GKE Autopilot {#gotosocial-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoToSocial_GKE.png" alt="GoToSocial sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrite sous la forme d'un unique binaire Go
statique. Ce module déploie GoToSocial sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise GoToSocial et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoToSocial s'exécute comme une charge de travail composée d'un unique binaire
Go sur GKE Autopilot, déployée directement à partir de l'image officielle
`docker.io/superseriousbusiness/gotosocial` — sans build personnalisé. Le
déploiement associe un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods du binaire Go sur le port 8080, 2 vCPU / 4 GiB par défaut ; **`max_instance_count` fixé en dur à 1** |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge. Base de données créée avec la collation obligatoire `LC_COLLATE='C' LC_CTYPE='C'` |
| Stockage d'objets | Cloud Storage | Un bucket `storage` + un compte de service HMAC dédié, utilisés inconditionnellement via le client natif compatible S3 de GoToSocial — aucun montage GCS FUSE |
| Secrets | Secret Manager | `SUPERUSER_PASSWORD` généré automatiquement, paire de clés HMAC S3 d'accès/secrète ; mot de passe de la base de données. Projetés via le pilote Secret Store CSI |
| Ingress | Cloud Load Balancing / Gateway API | Service `LoadBalancer` par défaut ; IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 avec la collation `C` est obligatoire.** `database_type =
  "POSTGRES_15"` est la valeur par défaut, et le `validation.tf` de
  `GoToSocial_GKE` rejette tout `database_type` autre que Postgres au moment
  du plan. Le job `db-init` crée en outre la base de données avec
  `LC_COLLATE='C' LC_CTYPE='C'` — GoToSocial refuse de démarrer avec toute
  autre collation.
- **Image préconstruite, et non personnalisée.** `container_image_source = "prebuilt"`
  déploie directement `docker.io/superseriousbusiness/gotosocial`. Aucun
  wrapper de point d'entrée n'est nécessaire — la configuration passe
  entièrement par des variables d'environnement `GTS_*` distinctes que le
  binaire lit nativement.
- **Pas de job de migration.** GoToSocial crée et met à niveau son propre
  schéma automatiquement à chaque démarrage ; `db-init` se contente de
  préparer la base de données en collation C et le rôle.
- **`max_instance_count` est fixé en dur à 1.** Le cache en mémoire de
  GoToSocial n'a aucune synchronisation entre instances ; le projet amont ne
  prend pas en charge plusieurs instances sur la même base de données/le même
  stockage. `min_instance_count = 0` (scale-to-zero) est sans risque.
- **Cloud SQL est joint via le loopback du sidecar cloud-sql-proxy —
  `GTS_DB_TLS_MODE = "disable"` est correct sur GKE**, contrairement à Cloud
  Run (voir l'explication des modes TLS dans le guide CloudRun). L'implémentation
  de `db_host_env_var_name` d'`App_GKE` privilégie `127.0.0.1` lorsque le
  sidecar est présent ; la valeur par défaut de la couche Common de
  `GoToSocial_Common` est donc utilisée sans modification — le local
  `module_env_vars` de `GoToSocial_GKE` est vide.
- **Aucun montage GCS FUSE.** Le stockage des médias/avatars/pièces jointes
  utilise le client natif compatible S3 de GoToSocial, pointé vers le point
  de terminaison XML d'interopérabilité S3 de GCS via un compte de service
  HMAC dédié — et non un montage de système de fichiers.
- **Les sondes de santé sont en TCP, pas en HTTP.** Les points de terminaison
  `/readyz`/`/livez` de GoToSocial rejettent toute requête dépourvue d'en-tête
  `User-Agent` par une réponse anti-scraping `418` — la sonde HTTP intégrée de
  Kubernetes n'en envoie jamais. `startup_probe` et `liveness_probe` sont tous
  deux en TCP sur le port 8080.
- **Le compte administrateur est créé automatiquement au mieux, sans
  garantie.** Contrairement à Cloud Run, l'ordonnancement plus souple des
  jobs d'initialisation sur GKE donne à la boucle de nouvelles tentatives
  du job `admin-create` une réelle chance de gagner la course contre le
  démarrage du pod principal — mais elle peut tout de même la perdre. Voir §3.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail GoToSocial {#a-gke-autopilot--the-gotosocial-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail GoToSocial pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=gotosocial" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, le
scaling et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GoToSocial stocke toutes les données de l'application (comptes, statuts,
abonnements, métadonnées des médias) dans une instance gérée Cloud SQL for
PostgreSQL 15, créée avec la collation `C` obligatoire par le job
`db-init`. Les pods y accèdent via le **sidecar cloud-sql-proxy** sur
`127.0.0.1` ; aucune IP publique n'est exposée.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe figurent dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes et la
rotation des mots de passe.

### C. Cloud Storage — médias, avatars, pièces jointes {#c-cloud-storage--media-avatars-attachments}

Un bucket **Cloud Storage** dédié (suffixe `storage`) et un compte de service
détenant une **clé HMAC** sont provisionnés automatiquement, le compte de
service de stockage recevant `roles/storage.objectAdmin` sur le bucket.
GoToSocial écrit dans ce bucket inconditionnellement dès le premier
démarrage — `GTS_STORAGE_BACKEND=s3` n'est pas facultatif.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  ```

Consultez [App_GKE](App_GKE.md) pour GCS Fuse (non utilisé ici) et les
options CMEK.

### D. Secret Manager {#d-secret-manager}

Le conteneur principal de GoToSocial lit `GTS_STORAGE_S3_ACCESS_KEY` et
`GTS_STORAGE_S3_SECRET_KEY` sous forme de variables d'environnement adossées
à des secrets (projetées via le pilote Secret Store CSI) ;
`SUPERUSER_PASSWORD` n'est utilisé que par le job `admin-create`. Le mot de
passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la
rotation, et [GoToSocial_Common](GoToSocial_Common.md) §2 pour comprendre
pourquoi ces secrets transitent par `secret_ids`/`module_secret_env_vars`, et
non par le champ (mort) `secret_environment_variables` de l'objet de
configuration propre à l'application.

### E. Réseau et entrée {#e-networking--ingress}

`service_type = "LoadBalancer"` et `reserve_static_ip = true` sont tous deux
des valeurs par défaut — **conservez `reserve_static_ip = true`** : sans IP
statique réservée, `GKE_SERVICE_URL` peut se rabattre sur un nom d'hôte
interne injoignable `*.svc.cluster.local` si l'IP éphémère du LoadBalancer
n'est pas encore connue au moment où Terraform génère les variables
d'environnement du Deployment (une situation de concurrence documentée et
reproductible sur l'ensemble du parc, non propre à GoToSocial).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques
GKE et Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité
et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GoToSocial {#3-gotosocial-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `scripts/db-init.sh` avec `postgres:15-alpine`. Il
  attend que Cloud SQL accepte les connexions, puis crée de manière
  idempotente le rôle applicatif et la base de données avec
  `LC_COLLATE='C' LC_CTYPE='C'`, accorde les privilèges et signale au sidecar
  cloud-sql-proxy de s'arrêter (`POST
  http://127.0.0.1:9091/quitquitquit`) afin que le job se termine. Peut être
  réexécuté sans risque (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration distinct.** GoToSocial migre son propre schéma
  automatiquement à chaque démarrage du serveur.
- **Le compte administrateur est créé automatiquement au mieux — vérifiez-le,
  ne le supposez pas.** GoToSocial n'a ni parcours d'inscription web ni point
  de terminaison REST pour le tout premier compte. Vérifié en conditions
  réelles : la CLI panique avec
  `NewSignup: instance application not yet created, run the server at least
  once before creating users` tant que le serveur principal n'a pas démarré
  correctement au moins une fois. Sur GKE, `execute_on_apply` contrôle
  uniquement si **Terraform attend** un job (`App_GKE/jobs.tf` :
  `wait_for_completion = try(execute_on_apply, true)`) — le pod du job
  sous-jacent est malgré tout planifié immédiatement, en concurrence avec le
  premier pod du Deployment principal. `admin-create.sh` effectue jusqu'à 20
  nouvelles tentatives à 15 secondes d'intervalle pour absorber cette course
  et l'emporte souvent pendant le même `apply` — mais ce n'est pas garanti.
  Vérifiez que le compte existe (tâche 2 du lab) et relancez-le manuellement
  si ce n'est pas le cas :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-create-job-name>
  kubectl create job --from=job/<admin-create-job-name> <admin-create-job-name>-retry -n "$NAMESPACE"
  ```
  Récupérez le mot de passe généré :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **Ligne de compte orpheline — un mode de défaillance réel et récurrent,
  pas un cas isolé.** Si une tentative `admin-create` échoue en cours de
  route (cas fréquent : elle a perdu la course contre le démarrage du serveur
  en plein déroulement, ou a été interrompue), le flux `NewSignup` de
  GoToSocial peut laisser la ligne de la table `accounts` insérée sans la
  ligne `users` correspondante (il insère d'abord le compte, puis panique à
  l'étape de la ligne utilisateur si l'application de l'instance n'existe pas
  encore). Une nouvelle tentative échoue alors de façon déroutante :
  `IsUsernameAvailable` signale « already in use » (la ligne de compte
  orpheline existe), mais `GetAccountByUsernameDomain`/
  `GetUserByAccountID` (utilisés à la fois par une nouvelle tentative
  `create` et par `admin account promote`) ne trouvent rien et paniquent avec
  `sql: no rows in result set` — un symptôme qui ressemble à un bug
  totalement différent. **Correctif :** connectez-vous directement à la base
  de données (par exemple via un pod de débogage ponctuel
  `postgres:15-alpine` sur GKE, avec les identifiants de la base issus de
  Secret Manager) et exécutez :
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='<username>';
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  puis relancez `admin-create` proprement. Cela peut se reproduire lors de
  tout déploiement dont la première tentative perd la course contre le
  démarrage — consultez la tâche 5 du lab pour la procédure complète.
- **Chemin de santé — TCP uniquement, et pourquoi `curl` a besoin d'un
  `User-Agent`.** GoToSocial sert de véritables points de terminaison non
  authentifiés `/readyz` (`SELECT` sur la base, 500 en cas d'échec) et
  `/livez` (200 peu coûteux), mais tous deux rejettent toute requête sans
  en-tête `User-Agent` par une réponse `418 I'm a teapot` — vérifié en
  conditions réelles. La sonde HTTP de Kubernetes n'en envoie jamais ;
  `startup_probe` et `liveness_probe` restent donc en TCP sur le port 8080.
  Chaque commande de vérification manuelle doit comporter un flag
  `-A`/`--user-agent` explicite :
  ```bash
  curl -A "gotosocial-check/1.0" -s "http://${EXTERNAL_IP}/readyz"
  ```
- **Propagation IAM du stockage.** GoToSocial panique au démarrage s'il ne
  peut pas joindre son backend de stockage S3. L'attribution
  `roles/storage.objectAdmin` du compte de service de stockage est câblée sur
  la sortie `storage_buckets` propre au socle (et non sur un
  `depends_on` portant sur le module entier, qui provoquerait un
  interblocage) — mais lors d'un tout premier déploiement, le démarrage du
  tout premier pod peut encore entrer en concurrence avec le délai de
  propagation de ~1–2 minutes de l'attribution IAM, ce qui produit une brève
  boucle de plantages `Access Denied` qui se résout d'elle-même.
- **Inspectez les jobs d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'GTS_HOST|GTS_STORAGE|GTS_DB'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à GoToSocial ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotosocial` | Nom de base des ressources. Doit être en minuscules. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `GoToSocial` | Nom lisible affiché dans la console. |
| `application_description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server, on GKE Autopilot` | Champ de description de la charge de travail. |
| `application_version` | `latest` | Tag de l'image Docker Hub. |
| `host` | `gotosocial.local` | `GTS_HOST` — le domaine public. Inscrit dans chaque URI ActivityPub au moment de sa création, **immuable après le premier démarrage**. Définissez votre domaine réel avant la production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — domaine de vitrine facultatif pour les identifiants, distinct de `host`. Prend par défaut la valeur de `host` lorsqu'il est vide. Même risque d'immuabilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle Docker Hub — aucun build personnalisé nécessaire. |
| `min_instance_count` | `0` | Le scale-to-zero est sans risque — la contrainte d'instance unique de GoToSocial concerne la concurrence, pas le maintien à chaud. |
| `max_instance_count` | `1` | **Plafond architectural strict** — le cache en mémoire de GoToSocial n'a aucune synchronisation entre instances. Ne pas augmenter. |
| `container_port` | `8080` | Valeur par défaut native de `GTS_PORT` de GoToSocial. Doit correspondre aux ports des sondes, faute de quoi le pod ne devient jamais Ready. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/mémoire par pod. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar cloud-sql-proxy — GoToSocial se connecte via son loopback `127.0.0.1`. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

Comportement standard d'`App_GKE` — voir [App_GKE](App_GKE.md).

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Application exposée au public — conservez `LoadBalancer`. |
| `workload_type` | `null` (resolves to `Deployment`) | GoToSocial n'a pas besoin d'un PVC de StatefulSet — les médias résident dans GCS via le client S3. |
| `session_affinity` | `ClientIP` | Routage persistant, afin qu'un client atteigne toujours le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (chemin purement informatif), `initial_delay_seconds=15`, `failure_threshold=10` | Le seul type de sonde qui fonctionne avec les points de terminaison de santé de GoToSocial, conditionnés par le User-Agent. |
| `liveness_probe` | TCP, `/livez`, `initial_delay_seconds=30`, `failure_threshold=3` | Même raisonnement que pour `startup_probe`. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, divers | Sondes structurées de niveau du socle ; remplacées par `startup_probe`/`liveness_probe` ci-dessus pour ce module. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore. **Non utilisé par GoToSocial** — le stockage des médias passe par le client S3 natif, et non par un montage. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket générique `data` (remplacé) | `main.tf` fournit le véritable bucket `storage` via la sortie de `GoToSocial_Common`, utilisé inconditionnellement dès le premier démarrage — et non sur option comme les buckets S3 de certaines autres applications. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse monté par défaut. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial ne dépend en rien de Redis — son cache est en mémoire du processus. Laissez `false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Validé au moment du plan** — `validation.tf` rejette tout ce qui n'est pas PostgreSQL 13/14/15 ou `NONE`. |
| `application_database_name` | `gotosocial` | La base de données réellement créée (avec la collation `C`) et injectée en tant que `GTS_DB_DATABASE`. |
| `application_database_user` | `gotosocial` | Le rôle réellement créé et injecté en tant que `GTS_DB_USER` ; mot de passe généré automatiquement dans Secret Manager. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Définies par `main.tf`, et non laissées à leurs valeurs par défaut génériques vides** — le mécanisme qui permet au binaire GoToSocial de lire les informations de connexion à la base du socle. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway par défaut. |
| `application_domains` | `[]` | S'il est vide, un nom d'hôte de type `nip.io` basé sur l'IP statique réservée est utilisé. |
| `reserve_static_ip` | `true` | **Conservez `true`** — voir §2E pour la situation de concurrence avec le DNS interne que cela évite. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (réservée par défaut). |
| `service_url` | URL permettant d'accéder à GoToSocial. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de médias `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `admin-create`) et (facultatif) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Le `validation.tf` propre à `GoToSocial_GKE` bloque en outre `min_instance_count > max_instance_count`, `enable_redis = true` sans `redis_host` ni `enable_nfs`, un `database_type` autre que PostgreSQL, `enable_iap = true` sans les deux identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`GTS_HOST`) | Définissez votre domaine réel avant le premier déploiement | Critique | Inscrit dans chaque URI d'acteur/objet ActivityPub au moment de sa création ; le modifier une fois que des comptes/publications réels existent casse la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `max_instance_count` | `1` (ne pas augmenter) | Critique | Le cache en mémoire de GoToSocial n'a aucune synchronisation entre instances ; le projet amont ne prend pas en charge plusieurs instances sur la même base de données/le même stockage. |
| `database_type` | `POSTGRES_15` | Critique | Validé au moment du plan par le `validation.tf` propre à `GoToSocial_GKE` — MySQL/SQL Server sont rejetés avant l'apply. |
| `container_port` / ports des sondes | `8080` partout | Critique | Une incohérence fait sonder un port inactif, et le pod ne devient jamais Ready alors que l'application est saine. |
| Câblage IAM du stockage (`google_storage_bucket_iam_member`) | Laissez tel que livré (référence `module.app_gke.storage_buckets["storage"]`) | Critique | GoToSocial panique au démarrage sans accès S3. Une alternative `depends_on = [module.app_gke]` provoquerait un interblocage du Deployment avec son propre prérequis IAM. |
| Récupération d'`admin-create` | Appliquez le correctif SQL de la ligne de compte orpheline si une nouvelle tentative panique avec « no rows » | Élevé | Une première tentative partiellement échouée peut laisser une ligne `accounts` orpheline sans ligne `users` correspondante ; les nouvelles tentatives naïves échouent de façon déroutante sans le SQL de nettoyage. |
| Sondes de santé (`startup_probe`/`liveness_probe`) | Laissez `type = "TCP"` | Élevé | Les `/readyz`/`/livez` de GoToSocial rejettent toute requête sans en-tête `User-Agent` (`418`) ; passer à `type = "HTTP"` fait échouer la sonde indéfiniment, puisque la sonde de Kubernetes n'en envoie jamais. |
| Résultat du job `admin-create` | Vérifiez, ne supposez pas | Élevé | L'ordonnancement plus souple des jobs sur GKE permet souvent à `admin-create` de gagner automatiquement sa course contre le démarrage du pod, mais pas toujours — vérifiez que le compte existe avant de considérer le déploiement comme pleinement opérationnel. |
| `reserve_static_ip` | `true` (par défaut) | Moyen | Sans cela, `GKE_SERVICE_URL` peut se rabattre sur un nom d'hôte interne injoignable `*.svc.cluster.local` avant que l'IP éphémère du LoadBalancer ne soit connue — une situation de concurrence documentée sur l'ensemble du parc. |
| `curl`/contrôles de santé manuels | Passez toujours `-A "<agent>"` | Moyen | Un `curl` nu (et la plupart des clients/moniteurs HTTP par défaut) reçoit `418 I'm a teapot` de la barrière anti-scraping de GoToSocial fondée sur le User-Agent, même sur des points de terminaison « non authentifiés ». |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_nfs` | `true` (par défaut) ou `false` si inutile | Faible | Filestore est facturé que l'application y écrive ou non ; GoToSocial n'utilise pas du tout le montage NFS dans sa configuration par défaut. |
| `enable_redis` | `false` (par défaut) | Faible | GoToSocial ne dépend pas de Redis ; laisser cette valeur à `true` n'a aucun effet fonctionnel. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
GoToSocial partagée avec la variante Cloud Run (secrets, jobs
`db-init`/`admin-create` et compte de service de stockage) est décrite dans
**[GoToSocial_Common](GoToSocial_Common.md)** (source du module :
`modules/GoToSocial_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoToSocial sur GKE Autopilot](../labs/GoToSocial_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoToSocial Common — Configuration applicative partagée](GoToSocial_Common.md) — la configuration partagée par les deux cibles de déploiement.
