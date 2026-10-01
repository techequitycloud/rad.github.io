---
title: "Forgejo sur GKE Autopilot"
description: "Référence de configuration pour déployer Forgejo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Forgejo_GKE.md @ 3055034 sha256:5af4c6163f3d -->

# Forgejo sur GKE Autopilot {#forgejo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Forgejo_GKE.png" alt="Forgejo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Forgejo est un service Git auto-hébergé, léger et géré par sa communauté — un
fork de Gitea — qui offre l'hébergement de dépôts, le suivi des tickets, les
pull requests, un exécuteur CI/CD intégré (Actions), la revue de code et un
registre de paquets, le tout à partir d'un unique binaire Go. Ce module déploie
Forgejo sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Forgejo et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Forgejo s'exécute sous la forme d'un unique binaire Go supervisé par `s6` dans
l'image d'origine `codeberg.org/forgejo/forgejo`, encapsulée par un fin point
d'entrée de plateforme qui compose la connexion à la base de données à
l'exécution. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Forgejo sur le port 3000 (HTTP), 2 vCPU / 2Gi par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Imposé en pratique — `db-init.sh` utilise `psql` ; la liste déroulante `database_type` propose MYSQL/NONE, mais ces options ne sont pas prises en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les dépôts, les objets LFS et les pièces jointes résident sous le point de montage NFS (`/mnt/nfs`), partagé entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket générique inutilisé, suffixé `data`, est provisionné par la valeur par défaut du socle — Forgejo lui-même ne stocke rien dans GCS |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` générés automatiquement, ainsi que le mot de passe de la base de données ; fournis aux pods sous forme de fichiers montés par CSI, car la CRD SecretSync de GKE interdit `__` dans les clés de secrets synchronisés |
| Entrée | Cloud Load Balancing (Gateway API) | LoadBalancer externe avec une IP statique réservée ; la prise en charge des domaines personnalisés est activée par défaut, avec repli sur un nom d'hôte HTTPS `nip.io` provisionné automatiquement lorsqu'aucun domaine n'est défini |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur qui fonctionne réellement.** `database_type`
  vaut `POSTGRES_15` par défaut ; le script de la tâche `db-init` est entièrement
  écrit pour `psql`, si bien que choisir MySQL ou `NONE` casse la configuration
  de la base de données, même si les métadonnées de la variable les proposent.
- **Cloud SQL est joint via le sidecar Auth Proxy en boucle locale.**
  `enable_cloudsql_volume = true` par défaut, si bien qu'un sidecar
  `cloud-sql-proxy` écoute sur `127.0.0.1:5432` ; le point d'entrée de plateforme
  sélectionne `SSL_MODE=disable` pour ce saut.
- **Deployment (et non StatefulSet), adossé à NFS, capable de mise à l'échelle à zéro.**
  `workload_type = "Deployment"`, `min_instance_count = 0`,
  `max_instance_count = 3`. Comme `enable_nfs = true` par défaut, le socle
  impose la stratégie de déploiement `Recreate` (voir
  [App_GKE](App_GKE.md)) afin qu'une mise à jour n'exécute jamais deux pods
  simultanément sur le même volume NFS et la même base de données.
- **NFS est activé par défaut**, monté sur `/mnt/nfs` (`GITEA__server__APP_DATA_PATH`)
  — c'est là que persistent les dépôts, les objets Git LFS et les pièces jointes.
- **L'affinité de session est `ClientIP`.**
- **Pas de tâche de migration distincte.** `GITEA__security__INSTALL_LOCK = "true"`
  court-circuite l'assistant d'installation web de Forgejo ; l'image
  `forgejo/forgejo` crée et migre son propre schéma au démarrage du conteneur,
  dans la base de données vide préparée par la tâche `db-init`.
- **Aucun compte administrateur n'est amorcé par Terraform.** Aucune tâche
  d'initialisation ne crée d'utilisateur administrateur Forgejo — consultez la
  [section 3](#3-forgejo-application-behaviour) pour l'étape manuelle.
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont générés automatiquement** et stockés
  dans Secret Manager ; sur GKE, ils sont lus (de même que le mot de passe de la
  base de données) depuis des fichiers de secrets montés par CSI, via la
  convention native de Forgejo `GITEA__section__KEY__FILE`.
- **`public_domain` / `public_url` valent `localhost` par défaut.** Même si
  `enable_custom_domain = true` provisionne automatiquement un point de
  terminaison HTTPS joignable, `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL`
  ne lui sont pas automatiquement synchronisées — définissez `public_domain` (et
  éventuellement `public_url`) sur le véritable nom d'hôte externe pour que les
  URL de clonage et les liens se résolvent correctement.
- **L'inscription libre est ouverte par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis est provisionné, mais n'est pas réellement câblé dans la configuration de Forgejo.**
  `enable_redis = true` par défaut et le socle injecte `REDIS_HOST` /
  `REDIS_PORT` dans le conteneur, mais `Forgejo_Common` ne définit aucune
  variable `GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` pour les
  exploiter — Forgejo se rabat sur ses valeurs par défaut intégrées pour le
  cache et les sessions, sauf si vous ajoutez vous-même ce câblage via
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Forgejo {#a-gke-autopilot--the-forgejo-workload}

Les pods Forgejo exécutent l'image `codeberg.org/forgejo/forgejo` derrière un
fin build personnalisé qui installe un point d'entrée de plateforme
(`/platform-entrypoint.sh`), puis exécute (exec) le point d'entrée Forgejo
d'origine sous `s6`. Comme la charge de travail est adossée à NFS par défaut, le
Deployment utilise la stratégie `Recreate`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Forgejo pour consulter les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app=forgejo 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Forgejo stocke toutes les métadonnées de l'application (utilisateurs, dépôts,
tickets, pull requests, exécutions Actions) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods la joignent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier déploiement,
la tâche `db-init` crée le rôle et la base de données de l'application ; Forgejo
crée et migre ensuite son propre schéma au premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Cloud Filestore (NFS) — stockage des dépôts {#c-cloud-filestore-nfs--repository-storage}

Les données des dépôts, les objets Git LFS et les pièces jointes de Forgejo
résident sur **NFS (Cloud Filestore)**, monté par défaut dans le pod sur
`/mnt/nfs` (`GITEA__server__APP_DATA_PATH`). Aucun bucket GCS n'est utilisé pour
les données de l'application — `Forgejo_Common` renvoie toujours une sortie
`storage_buckets` vide — même si la valeur par défaut de la variable générique
`storage_buckets` crée tout de même un bucket inutilisé suffixé `data`, sauf
si elle est remplacée.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

Consultez [App_GKE](App_GKE.md) pour la découverte et la création du NFS et pour
les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Forgejo sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (chiffre les données sensibles telles que les jetons 2FA et OAuth)
et `INTERNAL_TOKEN` (authentifie les appels d'API internes de Forgejo). Le mot de
passe de la base de données est le secret géré par le socle. Sur GKE, ces trois
valeurs sont projetées dans les pods sous forme de fichiers via le pilote CSI
Secret Store, et Forgejo les lit grâce à la convention
`GITEA__section__KEY__FILE` (`GITEA__database__PASSWD__FILE`,
`GITEA__security__SECRET_KEY__FILE`, `GITEA__security__INTERNAL_TOKEN__FILE`) —
comme la CRD SecretSync de GKE rejette `__` dans le `targetKey` d'un secret
synchronisé, elles sont matérialisées sous les clés simples `SECRET_KEY` /
`INTERNAL_TOKEN` plutôt que sous les noms `GITEA__` utilisés sur Cloud Run.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration CSI Secret Store et la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements), placée derrière une Gateway
(`enable_custom_domain = true`), qui provisionne automatiquement un nom d'hôte
HTTPS `nip.io` lorsqu'aucun `application_domains` n'est fourni. Seul le port
HTTP (`container_port = 3000`) est câblé dans le Service Kubernetes — le `sshd`
interne de Forgejo (supervisé par le même processus `s6`, d'après le Dockerfile)
n'est **pas** exposé par ce module, si bien que les URL de clonage `git+ssh://`
ne sont pas joignables de l'extérieur sans configuration réseau supplémentaire
ajoutée manuellement.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques de GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des
vérifications de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Forgejo {#3-forgejo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle attend que Cloud
  SQL accepte les connexions, crée de manière idempotente (ou redéfinit le mot de
  passe de) le rôle applicatif avec `CREATEDB`, crée la base de données
  appartenant à ce rôle et accorde tous les privilèges sur la base de données et
  sur le schéma `public` (PG15+). Le script lui-même n'installe aucune extension
  Postgres. La tâche peut être relancée sans risque (`execute_on_apply = true`,
  `max_retries = 3`) et signale au sidecar Cloud SQL Auth Proxy de s'arrêter
  (`POST /quitquitquit` sur `localhost:9091`) afin que le conteneur de la tâche
  se termine proprement.
- **Pas de tâche de migration distincte — la création du schéma a lieu au démarrage du conteneur.**
  Avec `GITEA__security__INSTALL_LOCK = "true"`, l'assistant d'installation web
  de Forgejo est ignoré ; le point d'entrée d'origine `forgejo/forgejo` crée et
  migre le schéma dans la base de données vide au premier démarrage, puis
  applique les migrations suivantes lors des mises à niveau de version.
- **Aucun compte administrateur n'est créé automatiquement.** Aucune tâche
  d'initialisation n'exécute d'étape `forgejo admin user create` (ou équivalente),
  et l'inscription libre est activée (`GITEA__service__DISABLE_REGISTRATION = "false"`) :
  toute personne pouvant joindre le service peut donc créer un compte. L'étape
  côté opérateur pour amorcer le premier administrateur consiste à exécuter
  `kubectl exec` dans un pod en cours d'exécution et à utiliser la CLI
  d'administration propre à Forgejo. TODO : l'invocation exacte de la CLI et la
  présence du binaire de la CLI dans le `PATH` du conteneur déployé n'ont pas été
  vérifiées à partir du code source de ce dépôt — confirmez-les sur le pod en
  cours d'exécution
  (`kubectl exec -n "$NAMESPACE" deploy/<service-name> -- forgejo admin user create --help`)
  avant de vous y fier.
- **Câblage des variables d'environnement de connexion à la base de données.** Le
  socle injecte `DB_HOST` (l'adresse de boucle locale du Cloud SQL Auth Proxy sur
  GKE), `DB_NAME`, `DB_USER` et le secret `DB_PASSWORD`. Comme les références
  `$(VAR)` de style Kubernetes ne sont pas utilisées (Cloud Run ne les interpole
  pas ; ainsi, le même point d'entrée fonctionne sur les deux plateformes),
  `/platform-entrypoint.sh` compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}`
  à l'exécution à partir des valeurs `DB_*` injectées, en sélectionnant
  `SSL_MODE=disable` pour les sauts par socket Unix ou par proxy en boucle locale
  utilisés sur GKE.
  `GITEA__database__PASSWD` n'est pas injectée directement sur GKE ; Forgejo la
  lit plutôt depuis le fichier monté par CSI `GITEA__database__PASSWD__FILE`.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour
  arrêtent l'ancien pod avant de démarrer le nouveau, ce qui évite que deux pods
  écrivent dans les mêmes données de dépôts sur NFS. `max_instance_count` vaut
  toujours `3` par défaut (et non `1`) — Forgejo n'est pas une application à
  écrivain unique au même titre qu'une application adossée à SQLite, mais aucun
  test d'exactitude multi-réplica des écritures Git concurrentes sur le même
  répertoire de données NFS n'est documenté dans ce module : traitez donc toute
  mise à l'échelle au-delà d'un unique réplica en régime permanent avec la même
  prudence que toute autre charge de travail sur un système de fichiers partagé.
- **Chemin de santé.** Les deux sondes sont des requêtes **HTTP** `GET /api/healthz`,
  que Forgejo sert sans authentification une fois les migrations de la base de
  données terminées : sonde de démarrage
  `initial_delay_seconds=0`, `timeout_seconds=10`, `period_seconds=30`,
  `failure_threshold=10` ; sonde de vivacité `initial_delay_seconds=60`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.
- **Inspecter la tâche d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Forgejo ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `forgejo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `11` | Tag de l'image `codeberg.org/forgejo/forgejo`, appliqué via l'argument de build propre à l'application `FORGEJO_VERSION` (`latest` correspond au tag épinglé `11`). |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Renseigne le champ de description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une fine surcouche `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}` qui ajoute le point d'entrée de plateforme chargé du câblage de la base de données. |
| `container_port` | `3000` | Port HTTP de Forgejo ; définit aussi `GITEA__server__HTTP_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy en boucle locale — requis sur GKE. |
| `cpu_limit` | `2000m` | 2 vCPU par pod (valeur propre à Forgejo qui remplace la valeur par défaut générique de `container_resources`). |
| `memory_limit` | `2Gi` | 2Gi par pod (valeur propre à Forgejo). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `Deployment` | Deployment (adossé à NFS, stratégie `Recreate` — voir [App_GKE](App_GKE.md)). |
| `service_type` | `LoadBalancer` | IP externe pour l'interface Forgejo et Git sur HTTP. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; sert à construire les URL de clonage et les liens. À remplacer avant ou après le premier déploiement. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `failure_threshold=10`, `period_seconds=30` | Sonde de démarrage propre à l'application (voir la [section 3](#3-forgejo-application-behaviour)). |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=60`, `period_seconds=30`, `failure_threshold=3` | Sonde de vivacité propre à l'application. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, les objets LFS et les pièces jointes persistent et soient partagés entre les pods. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage, également défini comme `GITEA__server__APP_DATA_PATH`. C'est la valeur par défaut effective de ce module — la valeur par défaut interne du module `Forgejo_Common` (`/data`) est remplacée par cette variante. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST` (par défaut, l'IP du serveur NFS) / `REDIS_PORT` dans le conteneur, mais `Forgejo_Common` ne définit aucune configuration `GITEA__cache__*` / `GITEA__session__*` pour les exploiter — voir la mise en garde de la [section 1](#1-overview). |
| `redis_host` | `""` | À remplacer pour pointer vers Cloud Memorystore ou une autre instance Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Mot de passe Redis AUTH, si nécessaire. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le seul moteur pris en charge par `db-init.sh` — ne le modifiez pas. |
| `db_name` | `forgejo` | Nom de la base de données, injecté sous `GITEA__database__NAME`. Immuable après le premier déploiement. |
| `db_user` | `forgejo` | Utilisateur de la base de données, injecté sous `GITEA__database__USER` ; mot de passe généré automatiquement dans Secret Manager et fourni via `GITEA__database__PASSWD__FILE`. |
| `enable_postgres_extensions` | `true` | `postgres_extensions` vaut `["uuid-ossp"]` par défaut. Le schéma propre de Forgejo ne nécessite aucune extension Postgres ; il s'agit d'une valeur par défaut de commodité au niveau du socle. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway avec une IP statique ; se rabat sur un nom d'hôte `nip.io` généré automatiquement lorsque `application_domains` est vide. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Forgejo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (par défaut, le bucket générique inutilisé suffixé `data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'importation (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé conjointement à un paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` fournis sous forme d'entiers nus, une valeur `container_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource : la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | `db-init.sh` ne fonctionne qu'avec `psql` ; MySQL/`NONE` casse la configuration de la base de données, même si les métadonnées de la variable les proposent. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelins tous les dépôts, tickets et PR stockés sous l'ancien rôle. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (générés automatiquement) | Ne jamais modifier | Critical | Leur rotation invalide les données chiffrées 2FA/OAuth ainsi que l'authentification de l'API interne de Forgejo, ce qui casse les opérations Git et d'API. |
| `enable_nfs` | `true` | Critical | La désactiver rend éphémères les dépôts, les objets LFS et les pièces jointes — ils sont perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE ; la sélection du mode SSL par le point d'entrée en dépend. |
| `public_domain` / `public_url` | Le véritable nom d'hôte externe | High | Valent par défaut `localhost` / `http://localhost/`, ce qui produit des URL de clonage Git erronées et des liens cassés tant qu'elles ne sont pas remplacées. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` pour les instances non publiques | High | L'inscription libre est ouverte par défaut et aucun compte administrateur n'est créé automatiquement — toute personne joignant le service peut s'inscrire. |
| Compte administrateur initial | À créer manuellement après le déploiement | High | Aucune tâche d'initialisation n'amorce d'administrateur ; tant qu'aucun n'est créé via la CLI Forgejo, l'instance ne dispose d'aucun utilisateur privilégié. |
| `enable_redis` | `true`, mais vérifiez qu'elle est réellement nécessaire | Medium | `REDIS_HOST`/`REDIS_PORT` sont injectées sans effet, sauf si vous ajoutez aussi la configuration `GITEA__cache__*`/`GITEA__session__*` correspondante — sinon, vous provisionnez de la capacité Redis sans aucun bénéfice. |
| `max_instance_count` | `3` (par défaut) | Medium | Les réplicas concurrents partagent le même répertoire de données Git sur NFS et la même base de données Postgres ; l'exactitude multi-réplica des écritures concurrentes n'est pas documentée ici — traitez la mise à l'échelle comme pour toute charge de travail sur un système de fichiers partagé. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `storage_buckets` | Laisser tel quel ou définir `create_cloud_storage = false` | Low | Le bucket par défaut suffixé `data` est provisionné mais inutilisé par Forgejo (toutes les données de l'application résident sur NFS) — un léger coût inutile s'il reste activé sans raison. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `public_domain`/`public_url`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Forgejo, partagée avec la variante Cloud Run, est décrite dans
**[Forgejo_Common](Forgejo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Forgejo sur GKE Autopilot](../labs/Forgejo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Forgejo sur Google Cloud Run](Forgejo_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Forgejo Common — Configuration applicative partagée](Forgejo_Common.md) — la configuration partagée par les deux cibles de déploiement.
