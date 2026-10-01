---
title: "Maybe Finance sur GKE Autopilot"
description: "Référence de configuration pour déployer Maybe Finance sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/MaybeFinance_GKE.md @ 3055034 sha256:dc3e3f6535f8 -->

# Maybe Finance sur GKE Autopilot {#maybe-finance-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_GKE.png" alt="Maybe Finance sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open source et auto-hébergée à
Mint/Monarch pour la gestion des finances personnelles et du patrimoine —
budgétisation, suivi de la valeur nette, catégorisation des transactions et
agrégation de plusieurs comptes, construite sur Ruby on Rails. Ce module déploie
Maybe sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Maybe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute sous forme d'une unique charge de travail web Rails/Puma, avec un
processus de tâches d'arrière-plan Sidekiq co-localisé dans le même conteneur. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme processus d'arrière-plan dans le même conteneur |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — une garde au moment du plan n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Tâches d'arrière-plan et interface temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — une garde au moment du plan échoue s'il est désactivé ; alimente Sidekiq (synchronisation des comptes, traitement des imports, notifications) et ActionCable |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/opt/maybefinance/storage`, partagées entre les pods ; c'est aussi la source par défaut de l'adresse IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné automatiquement par `MaybeFinance_Common` ; il n'est monté dans les pods que si `gcs_volumes` est défini |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut `POSTGRES_15`
  et une garde au moment du plan (`validation.tf`) rejette toute valeur autre que
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition fait échouer le plan
  purement et simplement si `enable_redis = false`. Lorsque `redis_host` est
  laissé vide, `enable_nfs` doit rester à `true` afin que l'adresse IP du serveur
  NFS partagé serve d'hôte Redis (la VM NFS héberge aussi Redis selon la
  convention de ce dépôt).
- **Cloud SQL est joint via le sidecar Auth Proxy en loopback.**
  `enable_cloudsql_volume = true` injecte un sidecar cloud-sql-proxy à l'écoute
  sur `127.0.0.1:5432`. Rails ne sait pas analyser le DSN de socket Unix de Cloud
  SQL ; le point d'entrée cloud ne construit donc jamais de DSN sous forme d'URL —
  il fait correspondre les variables
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` du socle aux variables
  d'environnement distinctes de Maybe `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD` et définit `PGSSLMODE=disable` en loopback (`require` sur
  une véritable IP privée).
- **`min_instance_count = 1` / `max_instance_count = 5`.** Au moins un pod reste
  actif afin que le worker Sidekiq dans le processus continue de vider la file de
  tâches ; la mise à l'échelle à zéro arrête entièrement les tâches
  d'arrière-plan.
- **Conteneur web + worker combiné, et non un sidecar.** Le point d'entrée cloud
  lance `bundle exec sidekiq` en arrière-plan puis fait un `exec` du serveur web
  Rails au premier plan du *même* conteneur — Maybe n'est pas déployé avec un
  worker distinct dans `additional_services`.
- **`SECRET_KEY_BASE` est généré une seule fois** par `MaybeFinance_Common` et
  stocké dans Secret Manager, partagé à l'identique par les processus web et
  Sidekiq. Rails l'utilise pour signer les sessions/cookies et pour dériver la clé
  qui chiffre les colonnes chiffrées par ActiveRecord.
- **Le schéma est créé par un job d'initialisation, pas au démarrage.** La
  tâche `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le
  point d'entrée d'exécution n'exécute jamais les migrations.
- **L'affinité de session est `ClientIP`**, afin que les requêtes d'un client
  atteignent le même pod.
- **`container_image_source = "custom"`.** Cloud Build construit une image
  d'enveloppe légère `FROM ghcr.io/maybe-finance/maybe:<version>`.
  `application_version` vaut par défaut `"stable"` ; une demande `"latest"` est
  associée au canal épinglé `stable` via l'ARG de build propre à l'application
  `MAYBE_VERSION` (l'argument de build générique `APP_VERSION` du socle n'est
  volontairement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Maybe (web + Sidekiq) {#a-gke-autopilot--the-maybe-workload-web--sidekiq}

Les pods Maybe sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le serveur web Rails/Puma et le worker Sidekiq
s'exécutent comme deux processus dans le même conteneur, partageant
`SECRET_KEY_BASE` et la connexion Redis.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Maybe pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
  ```

Voir [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données applicatives (comptes, transactions, budgets,
utilisateurs) dans une instance Cloud SQL for PostgreSQL 15 gérée. Les pods la
joignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP
publique n'est exposée. Au premier déploiement, la tâche `db-init` crée la base de
données et l'utilisateur de l'application, accorde au rôle applicatif
`cloudsqlsuperuser` (afin que les migrations de Maybe puissent créer des
extensions Postgres sans accès superutilisateur) et crée au préalable l'extension
`pgcrypto` ; `maybefinance-migrate` exécute ensuite `rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. NFS (Cloud Filestore) et Redis {#c-nfs-cloud-filestore--redis}

**Cloud Filestore (NFS)** est monté sur `/opt/maybefinance/storage` afin que les
pièces jointes téléversées persistent et soient partagées entre les pods. Maybe
requiert aussi **Redis** pour Sidekiq (synchronisation des comptes en
arrière-plan, traitement des imports, notifications) et ActionCable (mises à jour
de l'interface en temps réel) ; lorsque `redis_host` est laissé vide, la variable
injectée `REDIS_HOST` se résout en l'adresse IP du serveur NFS partagé (la VM NFS
héberge aussi Redis selon la convention de plateforme de ce dépôt).

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM (la VM
  NFS, si elle exécute aussi Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```

Voir [App_GKE](App_GKE.md) pour le comportement de découverte et de
provisionnement NFS et les mécanismes d'injection de Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe `storage`) est provisionné automatiquement
par `MaybeFinance_Common`, et la variable `storage_buckets` par défaut ajoute un
second bucket (suffixe `data`). Aucun des deux n'est monté par défaut dans le
système de fichiers des pods — `gcs_volumes` est vide d'origine — ils existent
donc en tant que stockage provisionné mais restent inertes tant qu'ils ne sont pas
explicitement raccordés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret propre à Maybe est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`), une
valeur aléatoire de 64 caractères partagée par le processus web Rails et le worker
Sidekiq. Le mot de passe de la base de données est géré séparément par le socle.
Sur GKE, les secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration CSI Secret Store et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements), `enable_custom_domain = true` provisionnant
un Ingress Kubernetes. `network_tags` vaut par défaut `["nfsserver"]`, requis pour
le mécanisme de découverte NFS/Redis.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging
(`RAILS_LOG_TO_STDOUT = "true"`) ; les métriques GKE et Cloud SQL sont acheminées
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte sont
disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards
  / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle se connecte à
  Cloud SQL, crée de manière idempotente la base de données et l'utilisateur de
  l'application, accorde les privilèges, accorde au rôle applicatif
  `cloudsqlsuperuser` (les utilisateurs applicatifs de Cloud SQL ne sont pas de
  vrais superutilisateurs, ce qui permet donc à la propre migration de Maybe de
  créer des extensions Postgres) et crée au préalable `pgcrypto` par mesure de
  précaution supplémentaire. La tâche peut être réexécutée sans risque
  (`execute_on_apply = true`, `max_retries = 1`).
- **La migration du schéma est un job d'initialisation distinct.**
  `maybefinance-migrate` exécute `bundle exec rails db:prepare` sur l'image
  construite pour l'application (`image = null` dans la spécification de la
  tâche, elle réutilise donc l'image Maybe construite et sa chaîne d'outils),
  dépend de l'achèvement préalable de `db-init` et effectue jusqu'à 3 nouvelles
  tentatives (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Inscription de l'administrateur au premier lancement, et non un secret créé
  automatiquement.** `SELF_HOSTED = "true"` active l'interface d'auto-hébergement
  de Maybe, qui permet au premier visiteur d'inscrire le compte administrateur
  initial via l'interface web — contrairement à d'autres modules de ce dépôt, il
  n'existe aucun secret de mot de passe administrateur généré automatiquement à
  récupérer. {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une seule fois par
  `MaybeFinance_Common` et partagé par les processus web et Sidekiq. Le faire
  tourner après le premier démarrage invalide les sessions existantes et rend
  illisibles les colonnes chiffrées par ActiveRecord.
- **La correspondance des variables d'environnement de la base de données se fait
  dans le point d'entrée cloud, pas via un DSN sous forme d'URL.** La plateforme
  injecte `DB_HOST` (loopback via le sidecar proxy sur GKE), `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point d'entrée les fait correspondre à
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (la convention
  `config/database.yml` de Rails pour Maybe) et définit `PGSSLMODE` selon que
  l'hôte résolu est ou non le loopback.
- **Raccordement de Redis.** `REDIS_URL` est construit à partir des variables
  injectées `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` s'il n'est pas déjà défini. Si
  `REDIS_URL` finit vide (Redis injoignable), le point d'entrée renonce
  entièrement à démarrer Sidekiq — les tâches d'arrière-plan cessent
  silencieusement de s'exécuter au lieu de faire planter le pod.
- **Chemin de santé.** La sonde de démarrage est une sonde **HTTP** `GET /up` avec
  une marge généreuse pour un premier démarrage lent (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — environ 8 minutes de marge).
  La sonde de vivacité est également une sonde **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspecter les jobs d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<maybefinance-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'RAILS_ENV|POSTGRES_|REDIS_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (la balise `{{UIMeta group=N}}` dans la description de
chaque variable de `variables.tf`). Seuls les paramètres propres à Maybe ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base du build personnalisé ; `latest` est associé au canal de version épinglé `stable` via `MAYBE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `container_resources` | `cpu_limit=2000m, memory_limit=4Gi` | 2 vCPU / 4 GiB pour le conteneur combiné Rails + Sidekiq. |
| `min_instance_count` | `1` | À maintenir à 1 afin que le worker Sidekiq co-localisé dispose toujours d'un pod dans lequel s'exécuter. |
| `max_instance_count` | `5` | Plafond du HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `container_image_source` | `custom` | Image d'enveloppe légère construite FROM l'image GHCR amont. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Maybe. |
| `workload_type` | `null` → `Deployment` | Deployment (pod combiné web + Sidekiq). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Maintient au moins un pod disponible pendant les interruptions volontaires de nœuds. |
| `pdb_min_available` | `"1"` | Nombre minimal de pods disponibles pendant les interruptions. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre les pods ; c'est aussi la source par défaut de l'adresse IP de l'hôte Redis. |
| `nfs_mount_path` | `/opt/maybefinance/storage` | Emplacement où Maybe stocke les pièces jointes téléversées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une garde au moment du plan fait échouer le plan s'il est défini à `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS (requiert `enable_nfs = true`). |
| `redis_port` | `6379` | Port du serveur Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | La garde restreint cette valeur à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `application_database_name` | `maybefinance` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `maybefinance` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour le routage du domaine personnalisé. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tag requis pour la découverte de l'hôte NFS/Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Maybe. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`, `maybefinance-migrate`) et (facultative) d'import. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — ainsi que par les propres gardes
> `validation.tf` de MaybeFinance (Redis obligatoire, PostgreSQL uniquement,
> `min` ≤ `max`, identifiants IAP requis lorsqu'il est activé, pas d'Auth Proxy
> sans véritable base de données). Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource,
> si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt
> qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur autre que PostgreSQL est rejeté au moment du plan ; en forcer un en contournant la garde casse l'installateur et toutes les requêtes. |
| `enable_redis` | `true` | Critique | La garde au moment du plan bloque purement et simplement `false` — sans Redis, Maybe n'a ni file de tâches d'arrière-plan fonctionnelle ni interface en temps réel. |
| `application_database_name` / `application_database_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le modifier | Critique | Le faire tourner après le premier démarrage invalide toutes les sessions et rend illisibles les colonnes chiffrées par ActiveRecord. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | Une mise à l'échelle à 0 arrête le worker Sidekiq co-localisé — la synchronisation des comptes, le traitement des imports et les notifications cessent silencieusement. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE. |
| `enable_nfs` | `true` (sauf si `redis_host` est défini explicitement) | Élevé | S'il est laissé à `false` avec `redis_host` vide, la garde au moment du plan échoue ; s'il est désactivé après un déploiement fonctionnel avec un `redis_host` explicite, les pièces jointes téléversées deviennent éphémères. |
| `redis_host` | `""` (utiliser l'IP NFS) ou un hôte réel et joignable | Élevé | Un hôte Redis injoignable fait que `REDIS_URL` se résout mais ne parvient pas à se connecter — Sidekiq démarre mais les tâches ne sont jamais traitées ; le point d'entrée ne renonce à Sidekiq que lorsque `REDIS_URL` est entièrement vide. |
| `container_resources.memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire sous les charges de travail d'import/de synchronisation ; la réduire expose à des OOM. {/* TODO: verify the exact minimum safe memory floor */} |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent d'un pod à l'autre et peuvent perturber les sessions authentifiées. |
| `reserve_static_ip` | `true` | Moyen | Sans elle, l'IP externe peut changer lors des redéploiements, ce qui casse le DNS et tout domaine personnalisé configuré. |
| `backup_retention_days` | `7` (à augmenter en prod) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Maybe, partagée
avec la variante Cloud Run, se trouve dans le module `MaybeFinance_Common` — voir
**[MaybeFinance_Common](MaybeFinance_Common.md)** pour les secrets, l'amorçage de
la base de données, le comportement du point d'entrée, les sondes de santé et le
stockage.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Maybe Finance sur GKE Autopilot](../labs/MaybeFinance_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur Google Cloud Run](MaybeFinance_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration applicative partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
