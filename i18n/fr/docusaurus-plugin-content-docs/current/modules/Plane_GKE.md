---
title: "Plane sur GKE Autopilot"
description: "Référence de configuration pour déployer Plane sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Plane_GKE.md @ 3055034 sha256:0442b753accd -->

# Plane sur GKE Autopilot {#plane-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plane_GKE.png" alt="Plane sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plane est un outil open source de gestion de projets et de suivi des tickets (une
alternative à Jira / Linear / Asana) couvrant les tickets, les sprints, les cycles,
les modules et les feuilles de route produit, derrière une interface web moderne. Ce
module déploie Plane sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Plane et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

La pile auto-hébergée amont de Plane comporte plusieurs services (frontends `web` /
`space` / `admin`, `api`, workers Celery `worker` + `beat`, un serveur temps réel
`live` et un job `migrator`). Ce module ne câble **pas** ces services séparément. Il
déploie à la place l'**image communautaire tout-en-un** publiée par Plane
(`makeplane/plane-aio-community`), qui regroupe api + worker + beat + space + admin +
live + migrator derrière un **reverse proxy Caddy interne sur le port 80**, exécuté
sous supervisord — un seul Deployment GKE expose donc toute l'application. Un
Dockerfile/point d'entrée wrapper minimal s'ajoute à cette image pour composer les
chaînes de connexion attendues par Plane (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`) à
partir des valeurs distinctes injectées par la plateforme.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deployment unique exécutant l'image `plane-aio-community` (build personnalisé), port 80, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Fixé à `POSTGRES_15` par `Plane_Common` ; joint via le sidecar Cloud SQL Auth Proxy en loopback |
| Courtier de messages | RabbitMQ (`rabbitmq:3.13-management-alpine`) | Déployé comme Deployment `additional_services` interne au cluster (`INGRESS_TRAFFIC_INTERNAL_ONLY`), requis par le worker/beat Celery de Plane |
| Cache / backend de file | Redis | `enable_redis = true` par défaut ; se résout en l'IP de la VM NFS partagée lorsqu'aucun `redis_host` explicite n'est défini |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut principalement pour héberger l'instance Redis partagée, et non les données applicatives de Plane |
| Stockage objet | Cloud Storage | Un bucket `storage` est provisionné automatiquement, mais le câblage des téléversements de fichiers est un **TODO ouvert** — voir ci-dessous |
| Secrets | Secret Manager | `SECRET_KEY` Django et `LIVE_SERVER_SECRET_KEY` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé facultatif (activé par défaut) avec un certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'image tout-en-un est un build personnalisé, pas une image précompilée.**
  `Plane_Common` définit `image_source = "custom"` et construit un Dockerfile wrapper minimal `FROM
  makeplane/plane-aio-community:<version>` ; le point d'entrée compose
  `DATABASE_URL`/`REDIS_URL`/`AMQP_URL` avant de passer la main au `/app/start.sh`
  propre à Plane.
- **`application_version` vaut `"stable"` par défaut, et non `"latest"`.** L'image
  amont `plane-aio-community` ne publie pas de tag `latest` ; la valeur par défaut de
  la variable propre à `Plane_GKE` est donc déjà épinglée. Si `latest` est néanmoins
  fourni, la correspondance d'arguments de build de `Plane_Common` le remplace par
  `"stable"` afin que la récupération de l'image de base n'échoue pas en 404.
- **RabbitMQ est obligatoire, et non facultatif.** Le `start.sh` intégré de Plane
  valide `AMQP_URL` et se termine avec un code non nul s'il est vide ; le service
  additionnel `mq` est donc toujours ajouté à la liste `additional_services` de
  `Plane_GKE/plane.tf` — il ne peut pas être désactivé par une variable.
- **Les identifiants RabbitMQ sont des valeurs par défaut statiques dans le code**
  (`plane` / `plane` / vhost `plane`), non stockées dans Secret Manager, et le stockage
  de RabbitMQ est éphémère (aucun PVC/NFS attaché) — un redémarrage du pod fait perdre
  les jobs en file.
  {/* TODO: verify whether this is an accepted risk or a hardening gap */}
- **Redis est hébergé par défaut sur la VM NFS**, exactement comme les autres
  applications RAD qui définissent `enable_redis = true` sans `redis_host` — le
  serveur NFS héberge aussi Redis, et son IP est injectée via l'espace réservé
  d'exécution `$(NFS_SERVER_IP)`, résolu par le point d'entrée wrapper.
- **Le stockage objet (compatible S3) est un TODO inachevé.** Un bucket GCS est créé
  et `AWS_S3_ENDPOINT_URL` pointe vers `storage.googleapis.com`, mais la couche
  d'interopérabilité S3 de GCS exige des clés HMAC qui **ne sont pas provisionnées par
  ce module**. Les téléversements de fichiers échoueront tant que de vrais identifiants
  compatibles S3 ne sont pas fournis via la surcharge `environment_variables`
  (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Tout le reste de Plane (tickets,
  projets, cycles) fonctionne sans eux.
- **Le nom DNS de RabbitMQ est calculé au moment du plan, et non injecté au moment de
  l'apply.** Contrairement à la variante Cloud Run (qui injecte un espace réservé
  `$(PLANE_MQ_HOST)` via le mécanisme des services additionnels), `Plane_GKE` remplace
  directement `RABBITMQ_HOST` par le nom DNS prévisible interne au cluster
  `<application_name><resource_prefix>-mq.<namespace>.svc.cluster.local` avant même
  qu'il n'atteigne le point d'entrée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail tout-en-un de Plane {#a-gke-autopilot--the-plane-all-in-one-workload}

Les pods `plane-aio-community` s'exécutent sur Autopilot, facturés selon le CPU et la
mémoire réellement demandés par le pod. Tous les sous-services de Plane (api, worker,
beat, web, space, admin, live) s'exécutent dans ce conteneur unique sous supervisord,
derrière Caddy sur le port 80.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Plane pour voir les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --field-selector=status.phase=Running
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- supervisorctl status
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Plane stocke toutes les données applicatives (espaces de travail, projets, tickets,
cycles, modules, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15.
Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** ; le point d'entrée
wrapper compose `DATABASE_URL` à partir des valeurs `DB_*` injectées, avec
`sslmode=disable` vers le proxy en loopback. Au premier déploiement, le job `db-init`
crée le rôle et la base de données de l'application ; l'étape `migrator` intégrée à
Plane (dans le supervisord de l'image AIO) applique ensuite les migrations de schéma
Django au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation du mot de passe.

### C. Redis (hébergé sur la VM NFS) {#c-redis-nfs-vm-hosted}

Plane utilise un seul `REDIS_URL` à la fois pour le cache Django et le backend de
résultats Celery. Avec `enable_redis = true` et sans `redis_host` explicite, le socle
résout Redis en l'IP de la VM NFS partagée (service colocalisé), injectée à
l'exécution via `$(NFS_SERVER_IP)` et résolue par le point d'entrée wrapper avant
qu'il ne compose `REDIS_URL`.

- **Console :** Compute Engine → VM instances (la VM NFS/Redis) ; Filestore →
  Instances.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_HOST|REDIS_URL'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Consultez [App_GKE](App_GKE.md) pour la résolution de `enable_redis`/`redis_host` et
la gestion de la VM NFS/Redis partagée.

### D. Courtier RabbitMQ (service additionnel interne au cluster) {#d-rabbitmq-broker-in-cluster-additional-service}

Les processus Celery `worker` et `beat` de Plane exigent un courtier AMQP. Ce module
déploie RabbitMQ comme **Deployment** distinct interne au cluster (via
`additional_services`, nom `mq`, image `rabbitmq:3.13-management-alpine`), joignable
uniquement depuis l'intérieur du cluster (`INGRESS_TRAFFIC_INTERNAL_ONLY`) sur le port
5672. App_GKE nomme le Service Kubernetes `<service_name>-mq` ; le point d'entrée
wrapper compose `AMQP_URL` à partir des identifiants statiques
`plane`/`plane`/vhost-`plane` et de ce nom DNS.

- **Console :** Kubernetes Engine → Workloads / Services & Ingress → filtrez
  sur le suffixe `-mq`.
- **CLI :**
  ```bash
  kubectl get deploy,svc -n "$NAMESPACE" -l app~mq 2>/dev/null || kubectl get deploy,svc -n "$NAMESPACE" | grep -- '-mq'
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mq --tail=50
  kubectl exec -n "$NAMESPACE" deploy/<service-name>-mq -- rabbitmqctl list_queues
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont `additional_services` provisionne
les Deployments et Services annexes.

### E. Cloud Storage et stockage objet (TODO) {#e-cloud-storage--object-storage-todo}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement,
et les variables d'environnement `AWS_S3_*` pointent Plane vers
`storage.googleapis.com`. Cependant, la couche d'interopérabilité S3 de GCS exige des
clés HMAC que ce module ne provisionne pas ; **les téléversements de fichiers ne
fonctionnent donc pas d'emblée** — consultez la section Vue d'ensemble ci-dessus pour
la correction.

- **Console :** Cloud Storage → Buckets → filtrez sur `-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep AWS_S3
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### F. Secret Manager {#f-secret-manager}

Deux secrets Plane sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (Django, 50 caractères) et `LIVE_SERVER_SECRET_KEY` (authentification du
serveur temps réel live, 40 caractères). Le mot de passe de la base de données est
géré séparément par le socle. Sur GKE, les secrets sont projetés dans les pods via le
pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plane"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`, `reserve_static_ip = true`), et un domaine
personnalisé avec un certificat géré par Google est activé par défaut
(`enable_custom_domain = true`) dès que `application_domains` est renseigné.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le détail des domaines personnalisés, de Cloud
CDN et des IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
et Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Plane {#3-plane-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` (`postgres:15-alpine`). Il attend que Cloud SQL accepte les
  connexions, crée de façon idempotente le rôle et la base de données de l'application
  (avec `GRANT` du rôle à `postgres` afin que la propriété puisse être définie),
  accorde les privilèges sur le schéma, puis signale au sidecar Cloud SQL Auth Proxy
  de s'arrêter (`quitquitquit`).
- **La migration du schéma a lieu dans l'image AIO à chaque démarrage, et non dans un
  job distinct.** L'étape `migrator` intégrée à Plane s'exécute sous supervisord avant
  le démarrage de api/worker/beat/web — il n'existe pas de Job Kubernetes
  `plane-migrate` dédié.
- **La composition des chaînes de connexion a lieu dans le point d'entrée wrapper, et
  non dans Django lui-même.** Le `start.sh` de l'image AIO attend des URL uniques
  (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`) ; la plateforme injecte au contraire des
  valeurs distinctes `DB_*`/`REDIS_*`/`RABBITMQ_*` ; `scripts/entrypoint.sh` compose
  donc les trois URL (en gérant la conversion socket/TCP de Cloud SQL et les cas
  d'espaces réservés `$(NFS_SERVER_IP)`/`$(PLANE_MQ_HOST)`) avant d'exécuter (`exec`)
  `/app/start.sh`.
- **La route d'administration `/god-mode` nécessite un correctif du Caddyfile.** Le
  basename du routeur de la SPA d'administration intégrée (« god-mode ») est
  `/god-mode/` (avec une barre oblique finale) ; le point d'entrée insère de façon
  idempotente dans `/app/proxy/Caddyfile` une redirection 308 depuis `/god-mode` sans
  barre oblique, afin que le lien « Get started » de l'application web n'affiche pas
  un indicateur de chargement vide.
- **Pas de job distinct d'initialisation de l'administrateur au premier lancement.**
  Le parcours d'inscription/connexion propre à Plane crée de manière interactive le
  premier propriétaire d'espace de travail via l'interface web lors de la première
  visite ; aucun identifiant administrateur généré automatiquement n'est documenté
  dans le code source.
  {/* TODO: verify whether Plane AIO ships any auto-provisioned admin account */}
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent par défaut
  **HTTP** `GET /health` (démarrage : délai initial de 30s, délai d'expiration de 10s,
  période de 10s, 30 échecs tolérés — soit jusqu'à 5 minutes pour le premier
  démarrage ; vivacité : délai initial de 30s, délai d'expiration de 10s, période de
  30s, 3 échecs), configurées via les variables `startup_probe`/`liveness_probe`
  consommées par `Plane_Common`.
  {/* TODO: verify /health is served without auth on the AIO image's Caddy proxy */}
- **Mise à l'échelle.** `min_instance_count = 1`, `max_instance_count = 3` par
  défaut — le HPA peut ajouter des réplicas, mais comme le worker/beat Celery
  s'exécute dans le processus de chaque pod, dépasser 1 multiplie aussi les
  déclenchements planifiés du beat Celery.
  {/* TODO: verify whether beat is singleton-guarded across replicas */}
- **Inspecter le job d'initialisation et les chaînes de connexion composées :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_URL|AMQP_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (UIMeta `group=N`). Seuls les paramètres propres à Plane ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `plane` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag de l'image `makeplane/plane-aio-community` ; l'image amont n'a pas de tag `latest`, la valeur par défaut est donc épinglée. `latest` est converti en `stable` au moment du build s'il est fourni. |
| `display_name` / `description` | `Plane - Project Management` / `Plane - Open-source project management tool ...` | Métadonnées d'affichage de la plateforme. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU — l'image AIO exécute api + worker + beat + web + space + admin + live dans un seul pod. |
| `memory_limit` | `4Gi` | 4 GiB minimum recommandés compte tenu du nombre de processus intégrés. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plage du HPA ; voir la mise en garde sur la mise à l'échelle du beat Celery à la [section 3](#3-plane-application-behaviour). |
| `container_port` | `80` | Le port d'écoute du reverse proxy Caddy interne — le seul port à exposer. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (loopback) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface de Plane. |
| `workload_type` | `null` → `Deployment` | Deployment (pas de PVC StatefulSet par défaut). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `additional_services` | `[]` (fourni par l'utilisateur) | Fusionné avec le service RabbitMQ `mq` injecté par le module — l'entrée RabbitMQ elle-même n'est **pas** configurable par l'utilisateur via cette variable ; elle est toujours ajoutée dans `plane.tf`. |
| `initialization_jobs` | `[]` → le job `db-init` intégré | Plane exécute ses propres migrations au démarrage du conteneur ; n'utilisez cette variable que pour des tâches *supplémentaires*. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis lorsque `enable_redis = true` sans `redis_host` explicite — la VM NFS héberge aussi Redis. Non utilisé pour le stockage des fichiers applicatifs de Plane. |
| `nfs_mount_path` | `/mnt/nfs` | Pertinent uniquement si vous montez NFS à une autre fin ; Plane lui-même n'y lit ni n'y écrit. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket avec le suffixe `storage` | Créé automatiquement en vue du futur câblage des téléversements de fichiers ; **actuellement ni monté ni authentifié** (voir le TODO de la Vue d'ensemble). |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse n'est monté par défaut. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | fixé à `POSTGRES_15` par `Plane_Common` | Non sélectionnable par l'utilisateur ; `database_type` est, sur ce module, une variable du socle répliquée et inopérante. |
| `db_name` | `plane_db` | Nom de la base de données, transmis à `Plane_Common` puis au socle. |
| `db_user` | `plane_user` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (contrairement à la plupart des modules) ; prend effet dès que `application_domains` est renseigné. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Nécessaire à la connectivité avec la VM NFS/Redis — ne pas supprimer. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la file de tâches Celery et le cache de Plane ; ne peut pas être réellement désactivé (le point d'entrée construit toujours un `REDIS_URL`). |
| `redis_host` | `""` | Laissez vide pour utiliser la VM NFS/Redis partagée. |
| `redis_port` | `6379` | Port Redis standard. |

{/* TODO: verify — the Redis variables above and the Cloud Armor variables
(enable_cloud_armor, admin_ip_ranges, cloud_armor_policy_name, enable_cdn)
both carry UIMeta group=21 with overlapping order numbers in
Plane_GKE/variables.tf; this looks like an unresolved group-numbering
collision rather than an intentional shared group. */}

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface web de Plane — IP du LoadBalancer externe si disponible, sinon l'URL interne au cluster. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans
> état, IAP sans identité autorisée, des `quota_memory_*` donnés sous forme d'entiers
> nus, un `container_port`/`backup_retention_days` hors limites. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la création
> de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en
> amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Présence de RabbitMQ | Ne jamais supprimer le service additionnel `mq` | Critical | Le `start.sh` de Plane refuse de démarrer avec un `AMQP_URL` vide ; toute l'application entre dans une boucle de plantages. |
| `enable_redis` | `true` | Critical | Le backend de cache/file Celery de Plane n'a aucune connexion sans URL Redis — le worker/beat et le cache échouent. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Les renommer après le premier déploiement fait pointer Plane vers une base inexistante (ou différente) et rend toutes les données orphelines. |
| `SECRET_KEY` / `LIVE_SERVER_SECRET_KEY` (générés automatiquement) | Ne jamais les modifier | Critical | Les modifier après le premier démarrage invalide les sessions signées et les jetons d'authentification du serveur live. |
| Téléversements de fichiers / `AWS_S3_*` | Fournir de vrais identifiants HMAC compatibles S3 | High | Sans vrais identifiants, les téléversements (pièces jointes, avatars, images de couverture) échouent silencieusement — le câblage par valeurs fictives n'est pas prêt pour la production. |
| Stockage de RabbitMQ | Attacher un PVC/NFS si la durabilité compte | High | Le service `mq` par défaut utilise un stockage de pod éphémère ; un redémarrage du pod ou une préemption du nœud fait perdre les jobs Celery en file. |
| `max_instance_count` | `3` (vérifiez le comportement du beat Celery avant d'aller plus loin) | Medium | Comme le beat s'exécute dans chaque pod, monter en charge horizontalement peut dupliquer les déclenchements des tâches planifiées. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est nécessaire à la connectivité à la base de données sur GKE ; le désactiver casse la composition de `DATABASE_URL`. |
| `network_tags` | Conserver `nfsserver` | High | Le supprimer coupe la connectivité avec la VM NFS/Redis, faisant silencieusement pointer Redis vers un hôte injoignable. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `WEB_URL`/`DOMAIN_NAME`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Plane, partagée avec
la variante Cloud Run (câblage de l'image tout-en-un, secrets, identifiants RabbitMQ,
TODO du stockage), est décrite dans **[Plane_Common](Plane_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Plane sur GKE Autopilot](../labs/Plane_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Plane sur Google Cloud Run](Plane_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Plane Common — Configuration applicative partagée](Plane_Common.md) — la configuration partagée par les deux cibles de déploiement.
