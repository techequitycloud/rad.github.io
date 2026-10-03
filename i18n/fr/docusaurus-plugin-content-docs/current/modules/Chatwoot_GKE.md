---
title: "Chatwoot sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Chatwoot sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chatwoot_GKE.md @ 15fd4c7 sha256:96fe4a9aa1d1 -->

# Chatwoot sur GKE Autopilot {#chatwoot-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_GKE.png" alt="Chatwoot sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot est une plateforme open source multicanal de service client et d'engagement
(e-mail, chat en direct, boîtes de réception sociales et de messagerie, suivi des SLA et
reporting) qui constitue une alternative conforme au RGPD à Zendesk ou Intercom. Ce
module déploie Chatwoot sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Chatwoot et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chatwoot s'exécute comme une seule charge de travail Ruby on Rails qui combine le
serveur web et un worker Sidekiq en arrière-plan dans un seul pod. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Rails + worker Sidekiq colocalisé sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` ; l'extension `vector` (pgvector) est activée pour les fonctionnalités d'IA/recherche de Chatwoot |
| Cache et file d'attente | Redis (VM NFS hébergée sur Cloud Filestore, ou externe) | Prend en charge la file d'attente des jobs Sidekiq et le pub/sub ActionCable |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/opt/chatwoot/storage`, partagées entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `storage` avec suffixe provisionné automatiquement |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Rails auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` est par défaut `POSTGRES_15` ; le
  schéma de Chatwoot et les fonctionnalités basées sur pgvector l'exigent.
- **Image personnalisée.** `container_image_source = "custom"` — le module Common construit `FROM chatwoot/chatwoot:${APP_VERSION}`
  et y ajoute un point d'entrée cloud qui mappe les variables d'environnement
  `DB_*`/`REDIS_*` de la Fondation sur la convention
  `POSTGRES_*`/`REDIS_URL` de Chatwoot et lance Sidekiq en arrière-plan avant
  d'exécuter le serveur Rails. L'image s'exécute **en tant que root** —
  correspondant à l'image amont, dont `/app`/`/app/tmp` sont détenus par root
  et non inscriptibles par le groupe, de sorte que l'étape `create_tmp_directories` de Rails
  nécessite les privilèges root pour réussir.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur la boucle locale.** `enable_cloudsql_volume
  = true`
  exécute un sidecar cloud-sql-proxy écoutant sur `127.0.0.1:5432` ; le point d'entrée
  mappe les `DB_HOST`/`DB_IP` injectés sur `POSTGRES_HOST`.
- **Deux jobs d'initialisation s'exécutent séquentiellement.** `db-init` (crée la
  base de données, le rôle et les autorisations — y compris une autorisation
  `cloudsqlsuperuser` afin que Chatwoot puisse créer lui-même des extensions Postgres)
  s'exécute en premier, puis `chatwoot-prepare` (`rails db:chatwoot_prepare`) crée/met à jour le
  schéma et initialise les valeurs par défaut. Il n'y a pas d'étape de migration
  dans le conteneur ; la configuration du schéma se fait entièrement dans ces deux
  Jobs avant que le conteneur de l'application n'ait besoin de servir le trafic.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide pour
  utiliser l'IP Redis partagée hébergée sur le serveur NFS que la Fondation injecte
  automatiquement.
- **`SECRET_KEY_BASE` est généré une fois et partagé** entre le processus web Rails
  et le worker Sidekiq (ils s'exécutent dans le même conteneur ici, mais la valeur
  doit également rester stable lors des redémarrages/redéploiements — Rails l'utilise
  pour signer les sessions et chiffrer les colonnes chiffrées d'ActiveRecord).
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **PodDisruptionBudget est activé par défaut** (`enable_pod_disruption_budget = true`, `pdb_min_available = "1"`).
- **`ENABLE_ACCOUNT_SIGNUP` est par défaut `"false"`** — l'inscription
  libre-service administrateur/agent est désactivée sur un service d'assistance
  fraîchement déployé ; activez-la via `environment_variables` si vous souhaitez une
  inscription publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Chatwoot {#a-gke-autopilot--the-chatwoot-workload}

Les pods Chatwoot sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Chaque pod exécute à la fois le serveur web Rails
et un processus worker Sidekiq en arrière-plan, de sorte que la charge de travail
ne doit pas être mise à l'échelle à zéro — Sidekiq est ce qui livre/reçoit les
messages de canal et traite les jobs en arrière-plan.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Chatwoot pour les pods, les révisions et les événements. Kubernetes Engine
  → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Chatwoot stocke toutes les données de l'application (conversations, contacts, boîtes
de réception, agents, rapports) dans une instance Cloud SQL pour PostgreSQL 15 gérée,
y compris l'extension `vector` utilisée par ses fonctionnalités d'IA/recherche.
Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ;
aucune IP publique n'est exposée. Lors du premier déploiement, le Job `db-init`
crée la base de données de l'application, le rôle et les autorisations (y compris
une autorisation `cloudsqlsuperuser` afin que les propres appels de création d'extensions
de Chatwoot réussissent), puis le Job `chatwoot-prepare` exécute `rails db:chatwoot_prepare` pour
construire le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et
la rotation des mots de passe.

### C. Redis (cache, file d'attente et pub/sub) {#c-redis-cache-queue-and-pubsub}

Sidekiq (la file d'attente des jobs en arrière-plan de Chatwoot) et ActionCable
(mises à jour de l'interface utilisateur en temps réel) nécessitent tous deux Redis.
`enable_redis = true` par défaut ; lorsque `redis_host` est laissé vide, la Fondation
injecte l'IP Redis partagée hébergée sur le serveur NFS en tant que `REDIS_HOST`,
et le point d'entrée du conteneur construit `REDIS_URL` à partir de celle-ci au
démarrage. Pointez `redis_host`/`redis_port`/`redis_auth` vers une instance
Cloud Memorystore dédiée pour une charge de travail de production plus lourde.

> **Sidekiq nécessite Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est 6.0.** Le Redis partagé sur la VM NFS exécute la version 6.0.16, et Sidekiq 7 refuse de démarrer avec. L'interface web continue de fonctionner (le point d'entrée exécute Sidekiq en arrière-plan), de sorte que le déploiement semble sain alors qu'aucun job en arrière-plan ne s'exécute. Pointez `redis_host` vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true` dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Memorystore → Instances Redis (si vous utilisez une instance dédiée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont le fallback Redis hébergé sur NFS et
l'intégration Memorystore sont câblés.

### D. Cloud Storage et persistance des fichiers (NFS) {#d-cloud-storage--file-persistence-nfs}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder
l'accès. Séparément, les pièces jointes de Chatwoot résident sur **NFS (Cloud
Filestore)** à `/opt/chatwoot/storage`, partagées entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Chatwoot est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (clé de signature de session / de chiffrement
ActiveRecord de Rails, partagée de manière identique entre les processus web et
Sidekiq). Le mot de passe de la base de données est géré séparément par la fondation.
Sur GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux
redéploiements). Un domaine personnalisé avec un certificat géré par Google peut
être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Le stdout/stderr des pods (les processus Rails et Sidekiq, puisqu'ils partagent un
conteneur) s'écoulent vers Cloud Logging ; les métriques GKE et Cloud SQL s'écoulent
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Voir [App_GKE](App_GKE.md) pour la gestion des tests de disponibilité et le câblage
des règles d'alerte.

---

## 3. Comportement de l'application Chatwoot {#3-chatwoot-application-behaviour}

- **La configuration de la base de données lors du premier déploiement s'exécute
  sous forme de deux Jobs chaînés.** `db-init` (image `postgres:15-alpine`) se
  connecte à Cloud SQL, crée de manière idempotente le rôle et la base de données,
  accorde les privilèges, accorde `cloudsqlsuperuser` au rôle de l'application (nécessaire
  car l'utilisateur de l'application Cloud SQL n'est pas un véritable superutilisateur
  Postgres et `db:chatwoot_prepare`'s `schema.rb` appelle `enable_extension` pour
  plusieurs extensions), et pré-crée `vector`, `pg_stat_statements`, `pg_trgm`,
  et `pgcrypto` de manière défensive. `chatwoot-prepare` dépend ensuite de
  `db-init` et exécute `bundle exec rails db:chatwoot_prepare` en utilisant l'**image de l'application
  Chatwoot construite** (pas une image client générique) afin que la chaîne
  d'outils et la configuration Rails complètes soient présentes. Les deux jobs
  s'exécutent sur `execute_on_apply = true`.
- **Pas de migrations dans le conteneur.** La création/mise à jour du schéma est
  entièrement gérée par le Job d'initialisation `chatwoot-prepare` avant que le conteneur
  de l'application ne soit censé servir le trafic — le point d'entrée d'exécution
  n'exécute pas `rails db:migrate`.
- **Alias des variables d'environnement de la base de données.** La plateforme
  injecte `DB_HOST` (le sidecar proxy, `127.0.0.1` sur GKE), `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point d'entrée cloud
  (`cloud-entrypoint.sh`, intégré à l'image) mappe ceux-ci sur la convention
  `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/`POSTGRES_USERNAME`/`POSTGRES_PASSWORD` de Chatwoot.
  {/* TODO: could not confirm whether App_GKE also forwards db_host_env_var_name / db_user_env_var_name aliasing vars for Chatwoot; the entrypoint does its own mapping regardless, so these Foundation-mirror variables in Group 16 are effectively unused for this app. */}
- **L'URL Redis est auto-réparatrice.** Si `REDIS_URL` n'est pas déjà défini, le
  point d'entrée le construit à partir des `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`
  injectés — cela couvre à la fois le cas explicite `redis_host` et le cas de
  fallback NFS par défaut, de sorte que laisser `redis_host` vide produit toujours
  un `REDIS_URL` fonctionnel au démarrage du conteneur.
- **Sidekiq s'exécute en colocation, en arrière-plan.** `cloud-entrypoint.sh` démarre
  `bundle exec sidekiq -C config/sidekiq.yml &` avant d'exécuter le serveur Rails ; un `trap` sur
  `TERM`/`INT` arrête Sidekiq en même temps que le conteneur.
  Étant donné que Sidekiq traite les jobs en arrière-plan (livraison de canaux,
  notifications, rapports) uniquement tant qu'un pod est actif, conservez
  `min_instance_count >= 1` en production.
- **Compte administrateur/premier démarrage.** L'interface utilisateur d'intégration
  de Chatwoot crée le premier compte administrateur de manière interactive à
  `/installation/onboarding` lors de la première visite — il n'y a pas de secret de
  compte administrateur auto-généré pour ce module.
  {/* TODO: could not confirm the exact first-run onboarding route/behaviour from the wiring files alone; verified against general Chatwoot self-hosted conventions, not this repo's source. */}
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /` ; la sonde
  de vivacité est `GET /health`, car elle est mise en miroir dans la vérification
  de santé de la passerelle, qui nécessite un 200 littéral et `/`
  redirections. La sonde de disponibilité définie par le module Common
  (`initial_delay_seconds = 30`) cible `/`. Laissez du temps au premier démarrage —
  `chatwoot-prepare` doit se terminer avant même que le conteneur de l'application ne
  démarre.
- **Signal d'arrêt du proxy Cloud SQL.** Les deux jobs d'initialisation
  `wget`/`curl`-POST vers le point de terminaison `--quitquitquit`
  du sidecar proxy (`127.0.0.1:9091/quitquitquit`) à la sortie afin que le pod du Job se
  termine au lieu de rester bloqué sur un sidecar actif.
- **Les mises à jour recréent le pod au lieu de le déployer en continu.** Parce que
  `enable_nfs = true` par défaut, `App_GKE` déploie la charge de travail avec la
  stratégie `Recreate` plutôt que `RollingUpdate` — deux pods en
  concurrence pour le même volume de pièce jointe NFS et la base de données partagée
  se bloqueraient sur le pod de surtension pendant un déploiement (vérifié en direct
  via un déploiement NFS Chatwoot). Une augmentation de version ou un changement de
  configuration qui touche le modèle de pod entraîne donc un bref temps d'arrêt
  pendant que l'ancien pod se termine avant que le nouveau ne démarre, plutôt qu'un
  déploiement sans interruption.
- **Inspectez les jobs d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<chatwoot-prepare-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'POSTGRES_|REDIS_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Chatwoot sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son
comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chatwoot` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `v4.15.1` | Tag d'image `chatwoot/chatwoot` utilisé comme base de construction personnalisée. Incrémentez pour déclencher une reconstruction. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources.cpu_limit` | `2000m` | 2 vCPU — Rails + worker Sidekiq colocalisé. |
| `container_resources.memory_limit` | `4Gi` | 4 GiB minimum recommandé ; les deux processus partagent le conteneur. |
| `min_instance_count` | `1` | Maintenez à 1 pour que le worker Sidekiq (et ActionCable) reste actif. |
| `max_instance_count` | `5` | Plafond de mise à l'échelle horizontale standard. |
| `container_port` | `3000` | Port du serveur Rails de Chatwoot. |
| `container_image_source` | `custom` | Construit sur mesure à partir de `chatwoot/chatwoot` ; ne pas définir sur `prebuilt`. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Chatwoot. |
| `workload_type` | `null` → `Deployment` | Déploiement standard (pas de PVC nécessaire par défaut). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Limite les évictions volontaires simultanées de pods. |
| `pdb_min_available` | `"1"` | Maintient au moins un pod (et son worker Sidekiq) disponible pendant les perturbations. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour que les pièces jointes persistent et soient partagées. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Où Chatwoot stocke les pièces jointes téléchargées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la mise en file d'attente Sidekiq et le pub/sub ActionCable ; transmis à la fondation sans condition. |
| `redis_host` | `""` | Vide utilise l'IP Redis partagée hébergée sur le serveur NFS que la Fondation injecte. |
| `redis_port` | `6379` | Port TCP Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis, si l'instance cible en requiert un. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par la sortie de configuration du module Common (également codé en dur dans le `config.database_type` Common) ; Chatwoot nécessite PostgreSQL 15+ avec pgvector. |
| `application_database_name` | `chatwoot` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `chatwoot` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `enable_postgres_extensions` | `true` (valeur par défaut Common) | Active `vector` après le provisionnement ; `db-init.sh` le pré-crée également de manière défensive. |

### Groupe 1 — Recherche et intégrations optionnelles {#group-1--search--optional-integrations}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch optionnel (par exemple de `Elasticsearch_GKE`) pour la recherche en texte intégral de Chatwoot. Laissez vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch ; laissez vide lorsque `xpack.security.enabled` est faux. |
| `elasticsearch_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe Elasticsearch ; lorsqu'il est défini, injecté comme `ELASTICSEARCH_PASSWORD` et accordé `secretAccessor`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Chatwoot. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `chatwoot-prepare`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — paramètres de type de charge de travail/PVC incompatibles, IAP activé sans identités autorisées, `quota_memory_*` donné sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixé par Common) | Critique | Le schéma de Chatwoot et la recherche basée sur pgvector nécessitent Postgres 15+ ; tout autre moteur rompt `chatwoot-prepare`. |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais changer | Critique | Sa rotation invalide chaque session/cookie signé et rend les colonnes chiffrées d'ActiveRecord définitivement illisibles ; Sidekiq échouera également à déchiffrer les jobs en cours. |
| `enable_redis` | `true` (transmis sans condition) | Critique | Sidekiq (jobs en arrière-plan, livraison de canaux) et ActionCable (interface utilisateur en temps réel) nécessitent tous deux Redis ; le désactiver rompt silencieusement la livraison des messages même si l'interface web se charge. |
| `min_instance_count` | `1` | Élevé | En dessous de 1, le worker Sidekiq colocalisé ne s'exécute pas entre les requêtes, de sorte que les jobs en arrière-plan (interrogation de canaux, notifications, rapports) stagnent entre les démarrages à froid. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les pièces jointes téléchargées éphémères — perdues lors de la recréation du pod. Le laisser activé change également la stratégie de déploiement en `Recreate` (bref temps d'arrêt par mise à jour) au lieu de `RollingUpdate` — attendu, pas un bug. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE. |
| Ordre des jobs `chatwoot-prepare` | S'exécute après `db-init` (`depends_on_jobs = ["db-init"]`) | Élevé | La préparation du schéma avant l'existence des autorisations de base de données/rôle/extension fait échouer le Job (`must be superuser` sur `CREATE EXTENSION`, ou la base de données/le rôle manquant entièrement). |
| `container_image_source` | `custom` | Élevé | Chatwoot est une image pré-construite de Docker Hub enveloppée dans un point d'entrée personnalisé (mappage d'env + lancement de Sidekiq) ; passer à `prebuilt` ignore ce wrapper et le conteneur ne mappera pas `DB_*`/`REDIS_*` correctement. |
| `pdb_min_available` | `"1"` | Moyen | La maintenance/les mises à niveau volontaires des nœuds pourraient autrement évincer le seul pod exécutant Sidekiq, interrompant le traitement en arrière-plan. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toutes les URL de rappel de webhook/canal configurées. |
| `ENABLE_ACCOUNT_SIGNUP` | `"false"` (par défaut) | Moyen | Laisser l'inscription publique en libre-service activée sur un service d'assistance accessible sur Internet permet à quiconque d'enregistrer un compte agent/administrateur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données de conversation/client. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Chatwoot
partagée avec la variante Cloud Run est décrite dans le module Chatwoot_Common
(`modules/Chatwoot_Common`) ; voir **[Chatwoot_Common](Chatwoot_Common.md)** pour les secrets,
le démarrage de la base de données, l'image/point d'entrée du conteneur, les sondes
de santé et le stockage d'objets.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chatwoot sur GKE Autopilot](../labs/Chatwoot_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chatwoot Common — Configuration d'application partagée](Chatwoot_Common.md) — la configuration partagée par les deux cibles de déploiement.
