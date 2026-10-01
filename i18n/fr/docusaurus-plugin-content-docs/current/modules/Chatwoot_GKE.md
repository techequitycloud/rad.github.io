---
title: "Chatwoot sur GKE Autopilot"
description: "Référence de configuration pour déployer Chatwoot sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Chatwoot_GKE.md @ 3055034 sha256:d3ba988b0b15 -->

# Chatwoot sur GKE Autopilot {#chatwoot-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_GKE.png" alt="Chatwoot sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot est une plateforme open source de helpdesk multicanal et d'engagement client
(boîtes de réception e-mail, chat en direct, réseaux sociaux et messageries, suivi des
SLA et rapports) qui constitue une alternative conforme au RGPD à Zendesk ou Intercom.
Ce module déploie Chatwoot sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Chatwoot et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chatwoot s'exécute sous la forme d'une unique charge de travail Ruby on Rails qui
réunit le serveur web et un worker Sidekiq d'arrière-plan dans un même pod. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Rails + worker Sidekiq co-localisé sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` ; l'extension `vector` (pgvector) est activée pour les fonctionnalités d'IA et de recherche de Chatwoot |
| Cache et file d'attente | Redis (VM NFS hébergée sur Cloud Filestore, ou externe) | Sert de support à la file de jobs de Sidekiq et au pub/sub d'ActionCable |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes sont conservées sous `/opt/chatwoot/storage`, partagées entre les pods |
| Stockage objet | Cloud Storage | Un bucket suffixé `storage` provisionné automatiquement |
| Secrets | Secret Manager | `SECRET_KEY_BASE` de Rails généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut `POSTGRES_15` par défaut ; le
  schéma de Chatwoot et ses fonctionnalités reposant sur pgvector l'exigent.
- **Image construite sur mesure.** `container_image_source = "custom"` — le module
  Common effectue un build `FROM chatwoot/chatwoot:${APP_VERSION}` et y ajoute un point
  d'entrée cloud qui fait correspondre les variables d'environnement `DB_*`/`REDIS_*` du
  socle à la convention `POSTGRES_*`/`REDIS_URL` de Chatwoot, puis lance Sidekiq
  en arrière-plan avant d'exécuter (exec) le serveur Rails. L'image s'exécute **en tant
  que root** — à l'image de l'image amont, dont `/app`/`/app/tmp` appartiennent à root
  et ne sont pas accessibles en écriture au groupe ; l'étape `create_tmp_directories` de
  Rails a donc besoin de root pour réussir.
- **Cloud SQL est joint via le sidecar Auth Proxy sur le loopback.** `enable_cloudsql_volume
  = true` exécute un sidecar cloud-sql-proxy qui écoute sur `127.0.0.1:5432` ; le point
  d'entrée fait correspondre les `DB_HOST`/`DB_IP` injectés à `POSTGRES_HOST`.
- **Deux jobs d'initialisation s'exécutent en séquence.** `db-init` (crée la base de
  données, le rôle et les droits — y compris un droit `cloudsqlsuperuser` afin que
  Chatwoot puisse créer lui-même les extensions Postgres) s'exécute en premier, puis
  `chatwoot-prepare` (`rails db:chatwoot_prepare`) crée ou met à niveau le schéma et
  initialise les valeurs par défaut. Il n'y a aucune étape de migration dans le
  conteneur ; la mise en place du schéma se fait entièrement dans ces deux Jobs, avant
  que le conteneur de l'application n'ait à servir du trafic.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide pour
  utiliser l'IP du Redis partagé hébergé sur le serveur NFS, que le socle injecte
  automatiquement.
- **`SECRET_KEY_BASE` est généré une seule fois et partagé** entre le processus web
  Rails et le worker Sidekiq (ils s'exécutent ici dans le même conteneur, mais la valeur
  doit aussi rester stable d'un redémarrage ou redéploiement à l'autre — Rails l'utilise
  pour signer les sessions et chiffrer les colonnes chiffrées par ActiveRecord).
- **L'affinité de session est `ClientIP`**, afin que les requêtes d'un client
  atteignent le même pod.
- **Le PodDisruptionBudget est activé par défaut** (`enable_pod_disruption_budget = true`,
  `pdb_min_available = "1"`).
- **`ENABLE_ACCOUNT_SIGNUP` vaut `"false"` par défaut** — l'inscription libre des
  administrateurs/agents est désactivée sur un helpdesk fraîchement déployé ;
  modifiez-la via `environment_variables` si vous souhaitez une inscription publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Chatwoot {#a-gke-autopilot--the-chatwoot-workload}

Les pods Chatwoot sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Chaque pod exécute à la fois le serveur web Rails et
un processus worker Sidekiq d'arrière-plan ; la charge de travail ne doit donc pas être
mise à zéro — c'est Sidekiq qui livre et reçoit les messages des canaux et traite les
jobs d'arrière-plan.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Chatwoot pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Chatwoot stocke toutes les données applicatives (conversations, contacts, boîtes de
réception, agents, rapports) dans une instance gérée Cloud SQL for PostgreSQL 15, y
compris l'extension `vector` utilisée par ses fonctionnalités d'IA et de recherche. Les
pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune
IP publique n'est exposée. Au premier déploiement, le Job `db-init` crée la base de
données applicative, le rôle et les droits (y compris un droit
`cloudsqlsuperuser` afin que les appels de création d'extensions de Chatwoot
réussissent), puis le Job `chatwoot-prepare` exécute `rails db:chatwoot_prepare` pour
construire le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la
rotation des mots de passe.

### C. Redis (cache, file d'attente et pub/sub) {#c-redis-cache-queue-and-pubsub}

Sidekiq (la file de jobs d'arrière-plan de Chatwoot) et ActionCable (mises à jour de
l'interface en temps réel) nécessitent tous deux Redis. `enable_redis = true` par
défaut ; lorsque `redis_host` est laissé vide, le socle injecte l'IP du Redis
partagé hébergé sur le serveur NFS en tant que `REDIS_HOST`, et le point d'entrée du
conteneur en déduit `REDIS_URL` au démarrage. Faites pointer
`redis_host`/`redis_port`/`redis_auth` vers une instance Cloud Memorystore dédiée pour
une charge de travail de production plus lourde.

- **Console :** Memorystore → Redis instances (si vous utilisez une instance dédiée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_GKE](App_GKE.md) pour le raccordement du repli Redis hébergé sur NFS et
de l'intégration Memorystore.

### D. Cloud Storage et persistance des fichiers (NFS) {#d-cloud-storage--file-persistence-nfs}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement
et le compte de service de la charge de travail y reçoit l'accès. Par ailleurs, les
pièces jointes de Chatwoot résident sur **NFS (Cloud Filestore)** sous
`/opt/chatwoot/storage`, partagées entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret propre à Chatwoot est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (la clé de signature des sessions et de chiffrement
ActiveRecord de Rails, partagée à l'identique entre les processus web et Sidekiq). Le
mot de passe de la base de données est géré séparément par le socle. Sur GKE, les
secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut
être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (celles des processus Rails et Sidekiq, puisqu'ils
partagent un conteneur) sont envoyées vers Cloud Logging ; les métriques de GKE et de
Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Consultez [App_GKE](App_GKE.md) pour l'activation conditionnelle des tests de
disponibilité et le raccordement des règles d'alerte.

---

## 3. Comportement de l'application Chatwoot {#3-chatwoot-application-behaviour}

- **La configuration de la base de données au premier déploiement s'exécute sous la
  forme de deux Jobs chaînés.** `db-init` (image
  `postgres:15-alpine`) se connecte à Cloud SQL, crée de façon idempotente le rôle et la
  base de données, accorde les privilèges, accorde `cloudsqlsuperuser` au rôle de
  l'application (nécessaire, car l'utilisateur applicatif de Cloud SQL n'est pas un
  véritable superutilisateur Postgres et le `schema.rb` de
  `db:chatwoot_prepare` appelle `enable_extension` pour plusieurs
  extensions), et pré-crée par précaution `vector`, `pg_stat_statements`, `pg_trgm` et
  `pgcrypto`. `chatwoot-prepare` dépend ensuite de `db-init` et exécute
  `bundle exec rails db:chatwoot_prepare` avec **l'image de l'application Chatwoot
  construite** (et non une image cliente générique), afin que toute la chaîne d'outils
  et la configuration Rails soient présentes. Les deux jobs s'exécutent avec
  `execute_on_apply = true`.
- **Aucune migration dans le conteneur.** La création et la mise à niveau du schéma sont
  entièrement prises en charge par le Job d'initialisation `chatwoot-prepare` avant que
  le conteneur de l'application ne soit censé servir du trafic — le point d'entrée
  d'exécution ne lance pas `rails db:migrate`.
- **Alias des variables d'environnement de la base de données.** La plateforme injecte
  `DB_HOST` (le sidecar proxy, `127.0.0.1` sur GKE), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD` ; le point d'entrée cloud (`cloud-entrypoint.sh`, intégré à l'image) les
  fait correspondre à la convention
  `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` de Chatwoot.
  {/* TODO: could not confirm whether App_GKE also forwards db_host_env_var_name / db_user_env_var_name aliasing vars for Chatwoot; the entrypoint does its own mapping regardless, so these Foundation-mirror variables in Group 16 are effectively unused for this app. */}
- **L'URL Redis s'auto-répare.** Si `REDIS_URL` n'est pas déjà défini, le point
  d'entrée la construit à partir des `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` injectés —
  ce qui couvre à la fois le cas d'un `redis_host` explicite et le cas par défaut du
  repli sur NFS ; laisser `redis_host` vide produit donc tout de même un `REDIS_URL`
  fonctionnel au démarrage du conteneur.
- **Sidekiq s'exécute de manière co-localisée, en arrière-plan.** `cloud-entrypoint.sh`
  lance `bundle exec sidekiq -C config/sidekiq.yml &` avant d'exécuter (exec) le serveur
  Rails ; un `trap` sur `TERM`/`INT` arrête Sidekiq en même temps que le conteneur.
  Comme Sidekiq ne traite les jobs d'arrière-plan (livraison sur les canaux,
  notifications, rapports) que tant qu'un pod est actif, conservez
  `min_instance_count >= 1` en production.
- **Compte administrateur / de premier lancement.** L'interface d'accueil de Chatwoot
  crée le premier compte administrateur de manière interactive sur
  `/installation/onboarding` lors de la première visite — il n'existe aucun secret
  d'identifiant administrateur généré automatiquement pour ce module.
  {/* TODO: could not confirm the exact first-run onboarding route/behaviour from the wiring files alone; verified against general Chatwoot self-hosted conventions, not this repo's source. */}
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont des requêtes
  **HTTP** `GET /` (la page de connexion/d'accueil renvoie 200 sans authentification) ;
  la sonde de disponibilité définie par le module Common
  (`initial_delay_seconds = 30`) cible également `/`. Prévoyez du temps au premier
  démarrage — `chatwoot-prepare` doit se terminer avant même que le conteneur de
  l'application ne démarre.
- **Signal d'arrêt du proxy Cloud SQL.** Les deux Jobs d'initialisation envoient, à
  leur sortie, une requête POST (`wget`/`curl`) au point de terminaison
  `--quitquitquit` du sidecar proxy (`127.0.0.1:9091/quitquitquit`), afin que le pod du
  Job se termine au lieu de rester bloqué sur un sidecar actif.
- **Les mises à jour recréent le pod au lieu de le remplacer progressivement.** Comme
  `enable_nfs = true` par défaut, `App_GKE` déploie la charge de travail avec la
  stratégie `Recreate` plutôt que `RollingUpdate` — deux pods se disputant le même
  volume NFS de pièces jointes et la base de données partagée se bloqueraient
  mutuellement sur le pod supplémentaire pendant un déploiement progressif (vérifié en
  conditions réelles lors d'un déploiement progressif de Chatwoot avec NFS). Une montée
  de version ou une modification de configuration touchant le modèle de pod provoque
  donc une brève interruption, le temps que l'ancien pod s'arrête avant le démarrage du
  nouveau, plutôt qu'une bascule sans interruption.
- **Inspecter les jobs d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<chatwoot-prepare-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'POSTGRES_|REDIS_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Chatwoot ou importants pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chatwoot` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `v4.15.1` | Tag d'image `chatwoot/chatwoot` utilisé comme base du build personnalisé. Incrémentez-le pour déclencher un nouveau build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources.cpu_limit` | `2000m` | 2 vCPU — Rails + worker Sidekiq co-localisé. |
| `container_resources.memory_limit` | `4Gi` | 4 GiB minimum recommandés ; les deux processus partagent le conteneur. |
| `min_instance_count` | `1` | Conservez 1 afin que le worker Sidekiq (et ActionCable) restent actifs. |
| `max_instance_count` | `5` | Plafond standard de mise à l'échelle horizontale. |
| `container_port` | `3000` | Port du serveur Rails de Chatwoot. |
| `container_image_source` | `custom` | Build personnalisé à partir de `chatwoot/chatwoot` ; ne le définissez pas sur `prebuilt`. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — obligatoire sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface de Chatwoot. |
| `workload_type` | `null` → `Deployment` | Deployment standard (aucun PVC nécessaire par défaut). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Limite les évictions volontaires simultanées de pods. |
| `pdb_min_available` | `"1"` | Maintient au moins un pod (et son worker Sidekiq) disponible pendant les interruptions. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les pièces jointes soient conservées et partagées. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Emplacement où Chatwoot stocke les pièces jointes téléversées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la file d'attente de Sidekiq et le pub/sub d'ActionCable ; transmis au socle sans condition. |
| `redis_host` | `""` | Vide : utilise l'IP du Redis partagé hébergé sur le serveur NFS, que le socle injecte. |
| `redis_port` | `6379` | Port TCP de Redis. |
| `redis_auth` | `""` | Mot de passe Redis AUTH, si l'instance cible en exige un. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par la sortie config du module Common (également codé en dur dans le `config.database_type` de Common) ; Chatwoot nécessite PostgreSQL 15+ avec pgvector. |
| `application_database_name` | `chatwoot` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `chatwoot` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |
| `enable_postgres_extensions` | `true` (valeur par défaut de Common) | Active `vector` après le provisionnement ; `db-init.sh` le pré-crée également par précaution. |

### Groupe 1 — Recherche et intégrations facultatives {#group-1--search--optional-integrations}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch facultatif (par ex. issu de `Elasticsearch_GKE`) pour la recherche plein texte de Chatwoot. Laissez vide pour la désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch ; laissez vide lorsque `xpack.security.enabled` vaut false. |
| `elasticsearch_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe Elasticsearch ; lorsqu'il est défini, il est injecté en tant que `ELASTICSEARCH_PASSWORD` et `secretAccessor` est accordé. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Chatwoot. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `chatwoot-prepare`) et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — paramètres de type de charge de travail et de PVC incohérents, IAP activé sans identités autorisées, `quota_memory_*` fourni sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixé par Common) | Critique | Le schéma de Chatwoot et sa recherche reposant sur pgvector exigent Postgres 15+ ; tout autre moteur casse `chatwoot-prepare`. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais modifier | Critique | Le renouveler invalide chaque session/cookie signé et rend définitivement illisibles les colonnes chiffrées par ActiveRecord ; Sidekiq ne parviendra pas non plus à déchiffrer les jobs en cours. |
| `enable_redis` | `true` (transmis sans condition) | Critique | Sidekiq (jobs d'arrière-plan, livraison sur les canaux) et ActionCable (interface en temps réel) nécessitent tous deux Redis ; le désactiver casse silencieusement la livraison des messages alors même que l'interface web se charge. |
| `min_instance_count` | `1` | Élevé | En dessous de 1, le worker Sidekiq co-localisé ne s'exécute pas entre les requêtes, si bien que les jobs d'arrière-plan (interrogation des canaux, notifications, rapports) sont bloqués entre deux démarrages à froid. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les pièces jointes téléversées éphémères — perdues à la recréation du pod. Le laisser activé fait aussi passer la stratégie de déploiement à `Recreate` (brève interruption à chaque mise à jour) au lieu de `RollingUpdate` — c'est attendu, pas un bug. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est indispensable à la connectivité de la base sur GKE. |
| Ordre du job `chatwoot-prepare` | S'exécute après `db-init` (`depends_on_jobs = ["db-init"]`) | Élevé | Exécuter la préparation du schéma avant que la base, le rôle et les droits sur les extensions n'existent fait échouer le Job (`must be superuser` sur `CREATE EXTENSION`, ou base/rôle totalement absents). |
| `container_image_source` | `custom` | Élevé | Chatwoot est une image préconstruite de Docker Hub enveloppée dans un point d'entrée personnalisé (correspondance des variables d'environnement + lancement de Sidekiq) ; passer à `prebuilt` contourne ce wrapper et le conteneur ne fera pas correspondre correctement `DB_*`/`REDIS_*`. |
| `pdb_min_available` | `"1"` | Moyen | Sinon, une maintenance ou une mise à niveau volontaire des nœuds pourrait évincer le seul pod exécutant Sidekiq et suspendre le traitement en arrière-plan. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toutes les URL de rappel de webhook/canal configurées. |
| `ENABLE_ACCOUNT_SIGNUP` | `"false"` (par défaut) | Moyen | Laisser l'inscription libre publique activée sur un helpdesk exposé à Internet permet à n'importe qui de créer un compte agent/administrateur. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour la conservation réglementaire des données de conversation et des données clients. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Chatwoot, partagée
avec la variante Cloud Run, est décrite dans le module Chatwoot_Common
(`modules/Chatwoot_Common`) ; consultez
**[Chatwoot_Common](Chatwoot_Common.md)** pour les secrets, l'amorçage de la base de
données, l'image de conteneur et son point d'entrée, les sondes de santé et le stockage
objet.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chatwoot sur GKE Autopilot](../labs/Chatwoot_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chatwoot Common — Configuration applicative partagée](Chatwoot_Common.md) — la configuration partagée par les deux cibles de déploiement.
