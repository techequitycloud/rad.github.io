---
title: "Coder sur GKE Autopilot"
description: "Référence de configuration pour déployer Coder sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Coder_GKE.md @ 3055034 sha256:e53b421d5eef -->

# Coder sur GKE Autopilot {#coder-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_GKE.png" alt="Coder sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open source auto-hébergée qui provisionne des
environnements de développement distants (« espaces de travail ») définis sous
forme de code avec Terraform. Elle est fournie sous forme d'un binaire Go unique
(`coder server`) qui sert l'interface web et l'API du plan de contrôle et relaie
les connexions WebSocket des IDE dans le navigateur et des sessions de terminal
vers les espaces de travail en cours d'exécution. Ce module déploie le **plan de
contrôle** Coder sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée. Provisionner de véritables espaces de travail nécessite en
outre un provisionneur configuré et une cible de calcul (par exemple un cluster
Kubernetes ou un modèle de VM cloud) mis en place après le déploiement — ce
module ne met en place que le plan de contrôle.

Ce guide se concentre sur les services cloud utilisés par Coder et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Le plan de contrôle de Coder est sans état — tout l'état, y compris ses clés de
signature auto-générées, réside dans PostgreSQL — ; le déploiement assemble donc
un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go sur le port 3000, 2 vCPU / 4 GiB par défaut, 1–5 réplicas mis à l'échelle par HPA |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — MySQL est rejeté au moment du plan |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Coder_Common` |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données géré par le socle — Coder n'a aucun secret applicatif propre |
| Entrée | Cloud Load Balancing | Ingress Kubernetes avec une IP statique globale réservée ; domaine personnalisé en option |
| Build du conteneur | Cloud Build + Artifact Registry | Encapsule l'image en amont `ghcr.io/coder/coder` avec un point d'entrée cloud |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut
  `POSTGRES_15` ; une validation au moment du plan dans `validation.tf` rejette
  tout ce qui n'est pas `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en
  charge.
- **`container_image_source = "custom"` est obligatoire, et non facultatif.**
  L'image en amont `ghcr.io/coder/coder` ne sait pas exploiter seule le
  raccordement à la base de données fourni par le socle ; Cloud Build l'encapsule
  avec un point d'entrée cloud qui assemble `CODER_PG_CONNECTION_URL` et
  `CODER_ACCESS_URL` au démarrage du conteneur.
- **Cloud SQL est joint via le side-car Auth Proxy sur l'interface de bouclage.**
  GKE injecte `DB_HOST = 127.0.0.1` ; le point d'entrée construit un DSN
  `postgres://` avec `sslmode=disable` (le proxy termine déjà le TLS de la
  connexion) et encode le mot de passe pour URL.
- **Pas de NFS, pas de Redis et aucun secret applicatif.** Tout l'état de
  Coder — espaces de travail, modèles, utilisateurs, sessions, file d'attente des
  builds et clés de signature auto-générées — réside dans PostgreSQL.
  `enable_nfs` et `enable_redis` valent tous deux `false` par défaut et ne sont
  pas nécessaires au fonctionnement normal.
- **Aucune tâche de migration distincte.** Coder exécute ses propres migrations
  de schéma au démarrage ; le seul job d'initialisation est `db-init`, qui
  crée la base de données vide et le rôle.
- **Mise à l'échelle horizontale par défaut.** `min_instance_count = 1`,
  `max_instance_count = 5` — le plan de contrôle sans état peut exécuter
  plusieurs réplicas sur la base de données partagée, contrairement aux
  applications avec état limitées à une seule instance.
- **`session_affinity = ClientIP`** maintient le trafic de terminal/IDE d'un
  navigateur, riche en WebSocket, sur le même pod pendant toute la session.
- **Une entrée et une IP statique sont provisionnées d'emblée**
  (`enable_custom_domain = true`, `reserve_static_ip = true`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail du plan de contrôle Coder {#a-gke-autopilot--the-coder-control-plane-workload}

Les pods Coder s'exécutent sur Autopilot, facturés selon le CPU et la mémoire
qu'ils demandent réellement. Comme le plan de contrôle est sans état, la charge
de travail s'exécute sous forme d'un `Deployment` standard avec une stratégie
`RollingUpdate` (sans la contrainte `Recreate` liée à NFS) et peut être mise à
l'échelle horizontalement sans risque.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge
  de travail Coder pour les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle HPA et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — espaces de travail, modèles, utilisateurs, journaux d'audit,
sessions et ses propres clés de signature — dans une instance gérée Cloud SQL
for PostgreSQL 15. Les pods s'y connectent via le side-car **Cloud SQL Auth
Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Au premier
déploiement, la tâche `db-init` crée la base de données et le rôle de
l'application ; le moteur de migration propre à Coder crée ensuite le schéma au
démarrage du serveur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement par `Coder_Common` et le compte de service de la charge de
travail y reçoit un accès. Il n'est actuellement pas monté par défaut dans le
conteneur Coder — Coder n'a pas besoin d'un système de fichiers partagé, puisque
l'état réside dans PostgreSQL.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse
(`gcs_volumes`) si vous devez en rattacher un pour un workflow personnalisé.

### D. Secret Manager {#d-secret-manager}

Coder se distingue des applications avec état en ne créant **aucun secret
applicatif propre** — il génère lui-même ses clés de signature et les conserve
dans la base de données PostgreSQL `coder` au premier démarrage. Le seul
identifiant que contient Secret Manager est le mot de passe de la base de données
géré par le socle. Sur GKE, les secrets sont projetés dans les pods via le pilote
CSI Secret Store.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~coder"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration CSI Secret Store et la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un Ingress Kubernetes adossé à
une IP statique globale (`reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google
peut être activé via `application_domains`. Comme Coder relaie des connexions
WebSocket de longue durée pour le terminal web et le trafic des applications
d'espace de travail, conservez `session_affinity = ClientIP` afin que les
requêtes d'un client aboutissent sur le même pod pendant toute la durée d'une
session.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
de GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte sont disponibles en option
(`uptime_check_config` est désactivé par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement, sans tâche de
  migration distincte.** La tâche `db-init` exécute `db-init.sh` avec
  `postgres:15-alpine`. Elle attend le side-car Cloud SQL Auth Proxy, crée de
  manière idempotente le rôle et la base de données `coder`, accorde les
  privilèges et réattribue la propriété du schéma `public`, puis signale au
  side-car du proxy de s'arrêter (`--quitquitquit`) afin que le pod du Job se
  termine. Coder exécute ensuite ses propres migrations de schéma au démarrage du
  serveur — il n'existe pas de tâche de migration dédiée, contrairement aux
  applications dotées d'une étape `db-migrate` distincte.
- **Aucun compte administrateur n'est pré-provisionné.** Le premier utilisateur
  qui atteint l'interface web après un démarrage réussi effectue la
  configuration initiale interactive de Coder (création du compte administrateur
  initial). Il n'existe aucun secret de mot de passe administrateur généré
  automatiquement à récupérer.
- **Le DSN est assemblé au démarrage du conteneur, et non intégré à l'image.**
  `entrypoint.sh` (dans `Coder_Common/scripts/`) construit
  `CODER_PG_CONNECTION_URL` à partir des valeurs `DB_*` injectées par le socle,
  car le pilote Go de Coder attend une URL `postgres://` et ne sait pas analyser
  la forme à mots-clés de libpq. Sur GKE, `DB_HOST=127.0.0.1` (le side-car Auth
  Proxy) se traduit par `sslmode=disable` ; le mot de passe est encodé en
  pourcentage selon la RFC 3986 afin que les caractères spéciaux ne cassent pas
  l'URL. `CODER_ACCESS_URL` prend par défaut la valeur de `GKE_SERVICE_URL`
  injectée par le socle.
- **Le trafic riche en WebSocket nécessite un routage persistant.** Le terminal
  web, le relais des applications d'espace de travail et les commandes
  `coder ssh`/redirection de port de la CLI passent tous par des connexions
  WebSocket de longue durée via le plan de contrôle. Conservez
  `session_affinity = ClientIP` (la valeur par défaut) afin que la connexion d'un
  client reste sur un même pod ; porter `max_instance_count` au-dessus de 1 est
  sans risque pour le plan de contrôle sans état lui-même, mais une session
  WebSocket en cours ne migre pas d'un pod à l'autre si l'un d'eux est drainé en
  pleine session.
- **Chemins des sondes de santé.** Les sondes de démarrage et de vivacité ciblent
  toutes deux **HTTP `GET /health`** avec un délai initial de 60 secondes ; la
  sonde de démarrage tolère jusqu'à 30 échecs avec une période de 15 secondes
  pour absorber la migration de schéma du premier démarrage de Coder. La sonde de
  disponibilité fournie par Common (utilisée par le raccordement
  `additional_services`/disponibilité du socle) cible séparément `GET /healthz`.
- **La télémétrie est désactivée par défaut** (`CODER_TELEMETRY_ENABLE = "false"`),
  et `CODER_VERBOSE = "false"`.
- **Plan de contrôle uniquement — les espaces de travail nécessitent un
  provisionneur et une cible.** Ce module déploie `coder server` ; exécuter de
  véritables espaces de travail nécessite en outre de configurer un provisionneur
  et une cible de calcul (par exemple un autre cluster/espace de noms Kubernetes,
  ou des modèles de VM cloud) via le système de modèles de Coder après la
  première connexion.
- **Vérifier le déploiement :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CODER_
  curl -s https://<service-url>/healthz
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Coder ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version de Coder ; `latest` correspond à un tag épinglé (`v2.24.1`) via l'ARG de build propre à l'application `CODER_VERSION`, afin de ne jamais se résoudre vers un `ghcr.io/coder/coder:latest` inexistant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Obligatoire — l'image en amont ne peut pas être déployée telle quelle ; Cloud Build l'encapsule avec le point d'entrée qui assemble le DSN. |
| `container_port` | `3000` | Port d'écoute `CODER_HTTP_ADDRESS` de Coder. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | 2 vCPU / 4 GiB par défaut pour le plan de contrôle. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Bornes de réplicas du HPA — le plan de contrôle sans état se met à l'échelle horizontalement sur la base de données partagée. |
| `enable_cloudsql_volume` | `true` | Side-car Auth Proxy (interface de bouclage) — obligatoire sur GKE ; une garde au moment du plan le rejette lorsque `database_type = "NONE"`. |
| `enable_image_mirroring` | `true` | Toujours activé pour Coder — l'image de base issue de GHCR est mise en miroir dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface et l'API Coder. |
| `workload_type` | `null` → `Deployment` | Deployment (sans état, `RollingUpdate` standard). |
| `session_affinity` | `ClientIP` | Routage persistant afin que la session WebSocket d'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — tout l'état réside dans PostgreSQL. S'il est activé, `nfs_mount_path` doit être un véritable répertoire, jamais un sous-chemin de `/opt/coder` (le binaire `coder`, un fichier). |
| `nfs_mount_path` | `/home/coder/data` | Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente des builds résident dans PostgreSQL, contrairement aux applications qui ont besoin d'un cache/d'une file d'attente externe. |
| `redis_host` | `""` | Pertinent uniquement si `enable_redis = true` ; une garde au moment du plan exige soit `redis_host`, soit `enable_nfs = true`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder exige PostgreSQL 13+ ; MySQL est rejeté au moment du plan (`validation.tf`). |
| `application_database_name` | `coder` | Nom de la base de données. Immuable après le premier déploiement — le renommer recrée la base de données et rend orphelin tout l'état de Coder. |
| `application_database_user` | `coder` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Un Ingress Kubernetes est provisionné d'emblée. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).
Remarque : `elasticsearch_url`, `elasticsearch_username` et
`elasticsearch_password_secret` sont déclarées dans `variables.tf` par souci de
cohérence avec le catalogue, mais **ne sont pas transmises** à l'appel du socle
dans `main.tf` — Coder n'a aucune intégration Elasticsearch dans ce module ; les
définir n'a donc aucun effet.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Coder. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms de la tâche de configuration (`db-init`) et de la tâche d'importation (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un nombre d'instances hors plage, IAP activé
> sans identifiants OAuth, des `quota_memory_*` fournis sous forme d'entiers
> bruts. Coder_GKE ajoute en outre ses propres gardes dans `validation.tf`
> (`database_type` limité à PostgreSQL, la précondition hôte Redis/NFS, le
> conflit entre le volume Cloud SQL et `database_type = "NONE"`). Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous
> sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critical | Tout moteur autre que PostgreSQL est rejeté au moment du plan ; en forcer un en contournant la garde casse toutes les requêtes émises par Coder. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les espaces de travail, modèles, utilisateurs et clés de signature auto-générées. |
| `container_image_source` | `custom` | Critical | Passer à `prebuilt` fait pointer GKE vers l'image brute `ghcr.io/coder/coder`, qui ne sait pas assembler `CODER_PG_CONNECTION_URL` à partir des variables de base de données du socle et ne démarre pas. |
| `enable_cloudsql_volume` | `true` | Critical | Requis pour la connectivité à la base de données sur GKE ; une garde au moment du plan le bloque également lorsque `database_type = "NONE"` pour éviter un side-car de proxy sans rien à quoi se connecter. |
| `nfs_mount_path` (si `enable_nfs=true`) | Un véritable répertoire, par ex. `/home/coder/data` | Critical | Un montage par-dessus `/opt/coder` — le binaire `coder` lui-même — masque l'exécutable et le conteneur ne démarre pas. |
| `session_affinity` | `ClientIP` | High | Sans persistance, une session WebSocket de terminal/IDE en cours peut être routée vers un autre pod en pleine session et être interrompue. |
| `enable_redis` | `false` | Medium | Inutile — l'activer sans définir `redis_host` ni `enable_nfs=true` fait échouer la validation au moment du plan ; même correctement configuré, il ajoute une dépendance inutilisée puisque Coder conserve tout son état dans PostgreSQL. |
| `max_instance_count` | `5` (à ajuster selon la charge) | Medium | Peut être augmenté sans risque pour un plan de contrôle sans état, mais chaque réplica ouvre son propre pool de connexions à la base de données — surveillez `max_connections` de Cloud SQL avec un nombre élevé de réplicas. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS, `CODER_ACCESS_URL` et toute redirection OAuth/OIDC enregistrée. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation réglementaires de l'historique des espaces de travail et des modèles. |
| `elasticsearch_url` / `elasticsearch_username` / `elasticsearch_password_secret` | Laisser non définies | Low | Inertes dans ce module (non transmises à l'appel du socle) — les définir n'a aucun effet et n'active aucune intégration de recherche. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Coder partagée
avec la variante Cloud Run est décrite dans
**[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Coder sur GKE Autopilot](../labs/Coder_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Coder sur Google Cloud Run](Coder_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration applicative partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
