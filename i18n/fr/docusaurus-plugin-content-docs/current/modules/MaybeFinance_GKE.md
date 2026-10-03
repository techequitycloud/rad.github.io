---
title: "Maybe Finance sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Maybe Finance sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MaybeFinance_GKE.md @ 15fd4c7 sha256:3d37f11585c3 -->

# Maybe Finance sur GKE Autopilot {#maybe-finance-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_GKE.png" alt="Maybe Finance sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open-source et auto-hébergée à
Mint/Monarch pour la gestion des finances personnelles et du patrimoine —
budgétisation, suivi de la valeur nette, catégorisation des transactions et
agrégation multi-comptes, construite sur Ruby on Rails. Ce module déploie
Maybe sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Maybe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud
et la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute comme une seule charge de travail web Rails/Puma avec un
processus de job en arrière-plan Sidekiq co-localisé dans le même conteneur.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme un processus en arrière-plan dans le même conteneur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — une garde au moment du plan n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Jobs en arrière-plan et UI en temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — une garde au moment du plan échoue si désactivé ; alimente Sidekiq (synchronisation de compte, traitement d'importation, notifications) et ActionCable |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/rails/storage`, partagées entre les pods ; également la source par défaut pour l'adresse IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est auto-provisionné par `MaybeFinance_Common` ; non monté dans les pods sauf si `gcs_volumes` est défini |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15`
  et une garde au moment du plan (`validation.tf`) rejette tout sauf
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment du
  plan échoue carrément si `enable_redis = false`. Lorsque `redis_host` est laissé vide,
  `enable_nfs` doit rester `true` afin que l'IP du serveur NFS partagé
  soit utilisée comme hôte Redis (la VM NFS co-héberge Redis dans la
  convention de ce dépôt).
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le bouclage.**
  `enable_cloudsql_volume = true` injecte un sidecar cloud-sql-proxy écoutant
  sur `127.0.0.1:5432`. Rails ne peut pas analyser le DSN de socket Unix de Cloud
  SQL, donc le point d'entrée cloud ne construit jamais un DSN de style URL
  — il mappe les variables d'environnement `DB_HOST`/`DB_PORT`/
  `DB_NAME`/`DB_USER`/`DB_PASSWORD` de la fondation sur les variables
  d'environnement discrètes `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/
  `POSTGRES_USER`/`POSTGRES_PASSWORD` de Maybe et définit `PGSSLMODE=disable` sur le
  bouclage (`require` sur une vraie IP privée).
- **`min_instance_count = 1` / `max_instance_count = 5`.** Au moins un pod
  reste actif afin que le worker Sidekiq en cours de processus continue de
  vider la file d'attente des jobs ; la mise à l'échelle à zéro arrête
  complètement les jobs en arrière-plan.
- **Conteneur web + worker combiné, pas un sidecar.** Le point d'entrée cloud
  démarre `bundle exec sidekiq` en arrière-plan, puis `exec` le serveur web
  Rails au premier plan du *même* conteneur — Maybe n'est pas déployé avec
  un worker `additional_services` séparé.
- **`SECRET_KEY_BASE` est généré une seule fois** par `MaybeFinance_Common` et stocké
  dans Secret Manager, partagé identiquement par les processus web et Sidekiq.
  Rails l'utilise pour signer les sessions/cookies et pour dériver la clé
  qui chiffre les colonnes chiffrées d'ActiveRecord.
- **Le schéma est créé par un job d'initialisation, pas au démarrage.** Le
  job `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le point
  d'entrée d'exécution n'exécute jamais de migrations.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **`container_image_source = "custom"`.** Cloud Build construit une image wrapper légère
  `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version`
  par défaut à `"stable"` ; une requête `"latest"` est mappée au
  canal de publication `stable` épinglé via l'ARG de build
  `MAYBE_VERSION` spécifique à l'application (l'ARG de build générique
  `APP_VERSION` de la fondation n'est intentionnellement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms
et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Maybe (web + Sidekiq) {#a-gke-autopilot--the-maybe-workload-web--sidekiq}

Les pods Maybe sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Le serveur web Rails/Puma et le worker
Sidekiq s'exécutent comme deux processus dans le même conteneur, partageant
`SECRET_KEY_BASE` et la connexion Redis.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Maybe pour les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données de l'application (comptes, transactions,
budgets, utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL
15. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée la base de données et l'utilisateur
de l'application, accorde le rôle d'application `cloudsqlsuperuser` (afin que les
migrations de Maybe puissent créer des extensions Postgres sans accès
superutilisateur), et pré-crée l'extension `pgcrypto` ; `maybefinance-migrate`
exécute ensuite `rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe se trouvent tous dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de
connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. NFS (Cloud Filestore) et Redis {#c-nfs-cloud-filestore--redis}

**Cloud Filestore (NFS)** est monté à `/rails/storage` afin que les
pièces jointes téléchargées persistent et soient partagées entre les pods.
Maybe nécessite également **Redis** pour Sidekiq (synchronisation de compte
en arrière-plan, traitement d'importation, notifications) et ActionCable
(mises à jour de l'interface utilisateur en temps réel) ; lorsque
`redis_host` est laissé vide, `REDIS_HOST` injecté se résout à
l'adresse IP du serveur NFS partagé (la VM NFS co-héberge Redis dans la
convention de plateforme de ce dépôt).

> **Sidekiq a besoin de Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est en 6.0.** Le Redis partagé sur la
> VM NFS exécute 6.0.16, et Sidekiq 7 refuse de démarrer avec. L'interface web fonctionne toujours (le
> point d'entrée met Sidekiq en arrière-plan), donc le déploiement semble sain alors qu'aucun job en arrière-plan ne s'exécute.
> Pointez `redis_host` vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true`
> dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM
  (la VM NFS, si elle exécute également Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```

Voir [App_GKE](App_GKE.md) pour le comportement de découverte/provisionnement
NFS et les mécanismes d'injection Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe `storage`) est provisionné
automatiquement par `MaybeFinance_Common`, et la variable par défaut
`storage_buckets` ajoute un deuxième bucket (suffixe `data`).
Aucun n'est monté dans le système de fichiers du pod par défaut —
`gcs_volumes` est vide par défaut — ils existent donc en tant que
stockage provisionné mais sont inertes jusqu'à ce qu'ils soient
explicitement connectés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Maybe est généré automatiquement et stocké dans
Secret Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
une valeur aléatoire de 64 caractères partagée par le processus web Rails et
le worker Sidekiq. Le mot de passe de la base de données est géré
séparément par la fondation. Sur GKE, les secrets sont projetés dans les
pods via le pilote CSI de Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud
Load Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements) avec `enable_custom_domain = true` provisionnant un
Ingress Kubernetes. `network_tags` par défaut à `["nfsserver"]`,
requis pour le chemin de découverte NFS/Redis.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging
(`RAILS_LOG_TO_STDOUT = "true"`) ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte
facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte à Cloud SQL, crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde
  les privilèges, accorde le rôle d'application `cloudsqlsuperuser` (les
  utilisateurs d'applications de Cloud SQL ne sont pas de vrais
  superutilisateurs, cela permet donc aux propres migrations de Maybe de
  créer des extensions Postgres), et pré-crée `pgcrypto` comme
  mesure de sécurité supplémentaire. Le job peut être réexécuté en
  toute sécurité (`execute_on_apply = true`, `max_retries = 1`).
- **La migration du schéma est un job d'initialisation séparé.**
  `maybefinance-migrate` exécute `bundle exec rails db:prepare` sur l'image construite pour
  l'application (`image = null` dans sa spécification de job, elle
  réutilise donc l'image et la chaîne d'outils Maybe construites), dépend
  de l'achèvement de `db-init` en premier, et réessaie jusqu'à 3
  fois (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Enregistrement de l'administrateur à la première exécution, pas un secret
  auto-créé.** `SELF_HOSTED = "true"` active l'interface utilisateur
  d'auto-hébergement de Maybe, qui permet au premier visiteur
  d'enregistrer le compte administrateur initial via l'interface web —
  contrairement à certains autres modules de ce dépôt, il n'y a pas de
  secret de mot de passe administrateur auto-généré à récupérer.
  {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une
  seule fois par `MaybeFinance_Common` et partagé par les processus web et
  Sidekiq. Le faire pivoter après le premier démarrage invalide les
  sessions existantes et rend les colonnes chiffrées d'ActiveRecord
  illisibles.
- **Le mappage des variables d'environnement de la base de données se fait
  dans le point d'entrée cloud, pas une URL DSN.** La plateforme injecte
  `DB_HOST` (bouclage via le sidecar proxy sur GKE),
  `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le
  point d'entrée mappe ceux-ci sur `POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD` (convention Rails `config/database.yml` de Maybe) et définit
  `PGSSLMODE` selon que l'hôte résolu est en bouclage.
- **Câblage Redis.** `REDIS_URL` est construit à partir de
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` injectés s'il n'est pas
  déjà défini. Si `REDIS_URL` se retrouve vide (Redis
  inaccessible), le point d'entrée ignore complètement le démarrage de
  Sidekiq — les jobs en arrière-plan cessent silencieusement de s'exécuter
  plutôt que de faire planter le pod.
- **Chemin de santé.** La sonde de démarrage est **HTTP**
  `GET /up` avec une tolérance généreuse pour un premier
  démarrage lent (`initial_delay_seconds = 60`, `period_seconds = 15`,
  `failure_threshold = 30` — environ 8 minutes de marge). La sonde de
  vivacité est également **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`, `failure_threshold = 3`).
- **Inspectez les jobs d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<maybefinance-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'RAILS_ENV|POSTGRES_|REDIS_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (le tag `{{UIMeta group=N}}` dans la description de
chaque variable dans `variables.tf`). Seuls les paramètres spécifiques ou
notables pour Maybe sont listés ; toutes les autres entrées sont héritées
de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base de construction personnalisée ; `latest` est mappé au canal de publication `stable` épinglé via `MAYBE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `container_resources` | `cpu_limit=2000m, memory_limit=4Gi` | 2 vCPU / 4 GiB pour le conteneur combiné Rails + Sidekiq. |
| `min_instance_count` | `1` | Maintenez à 1 afin que le worker Sidekiq co-localisé ait toujours un pod pour s'exécuter. |
| `max_instance_count` | `5` | Plafond HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage) — requis sur GKE. |
| `container_image_source` | `custom` | Image wrapper légère construite À PARTIR de l'image GHCR en amont. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Maybe. |
| `workload_type` | `null` → `Deployment` | Déploiement (pod web + Sidekiq combiné). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Maintient au moins un pod disponible pendant les perturbations volontaires des nœuds. |
| `pdb_min_available` | `"1"` | Nombre minimum de pods disponibles pendant les perturbations. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre les pods ; également la source par défaut pour l'adresse IP de l'hôte Redis. |
| `nfs_mount_path` | `/rails/storage` | Où Maybe stocke les pièces jointes téléchargées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une garde au moment du plan échoue si défini à `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port du serveur Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | La garde restreint cela à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `application_database_name` | `maybefinance` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `maybefinance` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour le routage de domaine personnalisé. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tag requis pour la découverte d'hôte NFS/Redis. |

Toutes les autres entrées suivent le comportement standard de
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Maybe. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `maybefinance-migrate`) et d'importation (facultatif). |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment du plan — plus les propres
> gardes `validation.tf` de MaybeFinance (Redis obligatoire, PostgreSQL
> uniquement, `min` ≤ `max`,
> identifiants IAP requis si activés, pas d'Auth Proxy sans base de données
> réelle). Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au
> moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur non-PostgreSQL est rejeté au moment du plan ; en forcer un contourne la garde et casse l'installateur et chaque requête. |
| `enable_redis` | `true` | Critique | La garde au moment du plan bloque `false` purement et simplement — Maybe n'a pas de file d'attente de jobs en arrière-plan fonctionnelle ni d'interface utilisateur en temps réel sans Redis. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais changer | Critique | Le faire pivoter après le premier démarrage invalide toutes les sessions et rend les colonnes chiffrées d'ActiveRecord illisibles. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à 0 arrête le worker Sidekiq co-localisé — la synchronisation des comptes, le traitement des importations et les notifications cessent silencieusement de se déclencher. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE. |
| `enable_nfs` | `true` (sauf si `redis_host` est défini explicitement) | Élevé | Si laissé `false` avec `redis_host` vide, la garde au moment du plan échoue ; si désactivé après un déploiement fonctionnel avec un `redis_host` explicite, les pièces jointes téléchargées deviennent éphémères. |
| `redis_host` | `""` (utiliser l'IP NFS) ou un hôte réel et accessible | Élevé | Un hôte Redis inaccessible fait que `REDIS_URL` se résout mais échoue à se connecter — Sidekiq démarre mais les jobs ne sont jamais traités ; le point d'entrée ne saute Sidekiq que lorsque `REDIS_URL` est entièrement vide. |
| `container_resources.memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire sous les charges de travail d'importation/synchronisation ; le réduire risque un OOM. {/* TODO: verify the exact minimum safe memory floor */} |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et peuvent perturber les sessions authentifiées. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et tout domaine personnalisé configuré. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Maybe
partagée avec la variante Cloud Run se trouve dans le module `MaybeFinance_Common` —
voir **[MaybeFinance_Common](MaybeFinance_Common.md)** pour les secrets, le
démarrage de la base de données, le comportement du point d'entrée, les
sondes de santé et le stockage.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Maybe Finance sur GKE Autopilot](../labs/MaybeFinance_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur Google Cloud Run](MaybeFinance_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration d'application partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
