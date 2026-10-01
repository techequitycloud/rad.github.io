---
title: "OnlyOffice sur GKE Autopilot"
description: "Référence de configuration pour déployer OnlyOffice sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OnlyOffice_GKE.md @ 3055034 sha256:317a167eabb2 -->

# OnlyOffice sur GKE Autopilot {#onlyoffice-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_GKE.png" alt="OnlyOffice sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server est une suite bureautique collaborative en ligne et open source
permettant la coédition en temps réel de documents texte, de feuilles de calcul, de présentations, de PDF et de formulaires —
une alternative auto-hébergée à Google Docs / Microsoft Office Online. Elle n'est généralement pas
ouverte directement par les utilisateurs finaux ; elle est plutôt intégrée par une application hôte (Nextcloud,
ownCloud, Seafile ou une intégration personnalisée) via son API et un secret JWT partagé. Ce
module déploie OnlyOffice sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise OnlyOffice et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — consultez le [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

L'image `onlyoffice/documentserver` est « tout compris » : elle embarque ses propres
convertisseurs, nginx et RabbitMQ (AMQP) sous `supervisord`. Ce module externalise
PostgreSQL (Cloud SQL) et Redis ; le RabbitMQ embarqué reste interne sur localhost.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods StatefulSet sur le port 80, 2 vCPU / 4Gi de mémoire par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — seuls `POSTGRES_13`/`14`/`15` (ou `NONE`) passent une garde au moment du plan |
| Cache / état d'édition | Redis externe | Obligatoire — le RabbitMQ embarqué reste interne, mais l'état de session/d'édition doit être partagé via un Redis **externe** ; par défaut, le Redis colocalisé sur la VM NFS est utilisé lorsque `redis_host` est vide |
| Stockage bloc | GKE Persistent Disk (`standard-rwo`) | PVC de 20Gi par pod sur `/var/www/onlyoffice/Data` — les données de cache/d'index du Document Server, que gcsfuse corromprait |
| Persistance des fichiers | Cloud Filestore (NFS) | Stockage des pièces jointes/documents partagé entre les pods sur `/opt/onlyoffice/storage` |
| Stockage d'objets | Cloud Storage | Déclaré (suffixe `storage`) mais **non créé par défaut** (`create_cloud_storage = false`) — la persistance repose sur le PVC bloc |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement (48 caractères) ; mot de passe de la base de données géré séparément |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut `POSTGRES_15` ; une
  garde au moment du plan rejette toute valeur autre que `POSTGRES_13`/`14`/`15`/`NONE` — MySQL
  n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment du plan fait échouer le déploiement
  si `enable_redis = false`. Si `redis_host` est laissé vide, `enable_nfs` doit rester
  `true` afin que l'IP du serveur NFS puisse servir d'hôte Redis par défaut.
- **Les données résident sur un PVC bloc, pas sur gcsfuse.** `stateful_pvc_enabled = true` provisionne par
  défaut un PVC `standard-rwo` (SSD) de 20Gi par pod, monté sur
  `/var/www/onlyoffice/Data`, et sélectionne automatiquement `workload_type = "StatefulSet"` —
  les caches/index du Document Server sous ce chemin seraient corrompus sur gcsfuse.
  `create_cloud_storage` vaut en conséquence `false`. NFS est activé par défaut
  (`enable_nfs = true`, monté sur `/opt/onlyoffice/storage`) pour le stockage partagé des pièces jointes,
  et sert également d'hôte Redis de repli.
- **Cloud SQL est joint via le sidecar Auth Proxy sur la boucle locale.** Un sidecar cloud-sql-proxy
  (`enable_cloudsql_volume = true`) écoute sur `127.0.0.1:5432` ; le
  wrapper `cloud-entrypoint.sh` fait correspondre les valeurs `DB_*` injectées aux noms de variables
  propres au Document Server (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà ;
  `DB_PWD` est défini à partir de `DB_PASSWORD`).
- **La signature JWT est activée par défaut.** `JWT_ENABLED = "true"` avec un
  `JWT_SECRET` de 48 caractères généré une seule fois et stocké dans Secret Manager — toute application hôte
  qui intègre l'éditeur doit présenter le même secret.
- **`"latest"` est figé au moment du build.** Le build personnalisé dérive son tag de base
  d'un ARG de build propre à l'application, `ONLYOFFICE_VERSION` (et non de `APP_VERSION` injecté par le socle,
  que le Dockerfile n'utilise pas) ; `application_version = "latest"`
  correspond à `8.3.3`.
- **La mise à l'échelle vaut par défaut `min=1`, `max=5`**, `session_affinity = "ClientIP"`. Chaque
  pod du StatefulSet dispose de son propre PVC indépendant — l'état d'édition/de session est partagé
  via Postgres et Redis, pas via le PVC.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OnlyOffice {#a-gke-autopilot--the-onlyoffice-workload}

Les pods OnlyOffice sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. Comme `stateful_pvc_enabled = true` par défaut, la charge de travail est un
**StatefulSet** avec un PVC bloc de 20Gi par pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail OnlyOffice pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OnlyOffice stocke les métadonnées des documents, les versions et l'état de l'application dans une instance
Cloud SQL for PostgreSQL 15 gérée. Les pods la joignent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier déploiement, la
tâche `db-init` crée le rôle applicatif, la base de données et les droits — le Document
Server installe ensuite son propre schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe.

### C. Redis externe, stockage bloc (PVC) et Cloud Filestore (NFS) {#c-external-redis-block-storage-pvc--cloud-filestore-nfs}

Redis conserve l'état de session/d'édition qui doit être partagé entre tous les réplicas
OnlyOffice — le RabbitMQ embarqué reste interne, mais Redis est externalisé et
**obligatoire** (une garde au moment du plan fait échouer le déploiement si `enable_redis = false`).
Si `redis_host` est laissé vide, le socle injecte l'IP du Redis colocalisé sur la VM NFS
(`enable_nfs` doit alors rester `true`) ; définissez explicitement `redis_host` pour
pointer vers une autre instance Redis. Deux couches de persistance distinctes sont câblées
à côté : un **PVC bloc** par pod (`standard-rwo`, 20Gi par défaut) monté sur
`/var/www/onlyoffice/Data` pour les caches/index/polices (un véritable périphérique bloc — gcsfuse
le corromprait), et **Cloud Filestore (NFS)** monté sur
`/opt/onlyoffice/storage`, partagé entre tous les pods pour le stockage des pièces jointes/documents.

- **Console :** Compute Engine → VM instances (la VM colocalisée NFS/Redis) ;
  Kubernetes Engine → Storage (PVC/StorageClass) ; Filestore → Instances.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep REDIS_SERVER
  kubectl get pvc,sc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment `enable_redis`/`redis_host` se résolvent en
l'IP de la VM NFS, et pour le compromis SSD ou HDD de `stateful_pvc_storage_class` sur GKE.

### D. Cloud Storage (facultatif) {#d-cloud-storage-optional}

Un bucket `storage` est déclaré par `OnlyOffice_Common` mais **n'est pas créé** sauf si
`create_cloud_storage = true` est défini explicitement — par défaut, toute la persistance repose
sur le PVC bloc et le NFS décrits ci-dessus, pas sur GCS.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret propre à OnlyOffice est généré automatiquement et stocké dans Secret
Manager : **`JWT_SECRET`** (48 caractères, sans caractères spéciaux), qui signe chaque
requête interne à l'API du Document Server et doit être présenté par toute application hôte
qui intègre l'éditeur. Le mot de passe de la base de données est géré séparément par le
socle. Sur GKE, les secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<jwt-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements), avec `enable_custom_domain = true` qui permet un certificat géré par Google
une fois `application_domains` renseigné.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OnlyOffice {#3-onlyoffice-application-behaviour}

- **Initialisation de la base de données au premier déploiement, sans tâche de migration distincte.** La tâche `db-init` s'exécute
  avec `postgres:15-alpine`. Elle résout l'hôte Cloud SQL (sidecar proxy sur
  `127.0.0.1`, avec repli sur l'IP privée de l'instance), attend que PostgreSQL soit
  joignable, crée/met à jour le rôle applicatif (`LOGIN CREATEDB`) avec le
  mot de passe généré, crée la base de données applicative (appartenant à `postgres`, car
  le superutilisateur Cloud SQL ne peut pas faire `SET ROLE` vers les rôles applicatifs), accorde tous les
  privilèges sur la base de données et le schéma `public`, puis signale à l'Auth Proxy de
  s'arrêter afin que le pod de la tâche se termine. Elle ne provisionne que le rôle, la base de données et les droits —
  le Document Server installe son propre schéma au premier démarrage. La tâche peut être
  réexécutée sans risque (`execute_on_apply = true`).
- **Utilisation du secret JWT.** `JWT_ENABLED = "true"`, `JWT_HEADER = "Authorization"`,
  `JWT_IN_BODY = "true"` sont définis par `OnlyOffice_Common` ; la valeur de `JWT_SECRET`
  elle-même est injectée depuis Secret Manager (générée une seule fois, 48 caractères). Chaque
  appel interne à l'API du Document Server est signé avec elle, et toute application hôte
  intégrant l'éditeur (Nextcloud, ownCloud, intégration personnalisée) doit être configurée
  avec le même secret — n'effectuez jamais de rotation une fois les intégrations câblées.
- **Correspondance des variables d'environnement de la base de données et de Redis.** `cloud-entrypoint.sh` s'exécute avant le lanceur
  amont : il définit `DB_TYPE=postgres` et `DB_PWD` à partir du `DB_PASSWORD` injecté
  (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà aux noms propres
  du Document Server), et fait correspondre `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` à
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` avant d'exécuter (`exec`)
  `/app/ds/run-document-server.sh`.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /healthcheck` (délai initial de 90s,
  période de 15s, jusqu'à 40 échecs — environ 10 minutes de marge au premier démarrage pendant que
  la pile embarquée démarre et que le schéma s'installe). La sonde de vivacité utilise le même
  chemin avec un délai de 120s / une période de 30s / 3 échecs. `/healthcheck` ne renvoie `true`
  qu'une fois nginx et les services documentaires démarrés et la base de données joignable,
  et est servi sans authentification.
- **Contraintes de mise à l'échelle.** `min_instance_count = 1`, `max_instance_count = 5` par
  défaut ; `session_affinity = "ClientIP"`. Chaque pod du StatefulSet dispose de son propre
  PVC bloc indépendant — les réplicas ne partagent pas le PVC, si bien que la mise à l'échelle horizontale est sûre tant
  que Postgres et Redis (l'état partagé) sont joignables par chaque pod.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -E 'DB_|REDIS_SERVER|JWT_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme dans `variables.tf` (`{{UIMeta
group=N}}`). Seuls les paramètres propres à OnlyOffice ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs
valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `onlyoffice` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `onlyoffice/documentserver` ; `latest` est figé à `8.3.3` au moment du build via l'ARG de build `ONLYOFFICE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `80` | Le nginx embarqué écoute sur le port 80. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | La pile embarquée (client Postgres/client Redis/RabbitMQ/nginx/convertisseurs sous `supervisord`) nécessite au moins 4Gi. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Bornes du nombre de réplicas de pods. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale `127.0.0.1:5432`) — obligatoire sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface et l'API OnlyOffice. |
| `workload_type` | `null` → `StatefulSet` | Sélectionné automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod pendant une session. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Les données de cache/d'index du Document Server doivent résider sur un PVC bloc — gcsfuse les corromprait. Sélectionne automatiquement `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/var/www/onlyoffice/Data` | Le répertoire de données du Document Server. |
| `stateful_pvc_storage_class` | `standard-rwo` | Sur SSD par défaut ; remplacez par `standard` (HDD) si le quota `SSD_TOTAL_GB` du projet est serré. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai de 90s, période de 15s, 40 échecs | Marge généreuse au premier démarrage — la pile embarquée met du temps à être prête. |
| `liveness_probe` | HTTP `/healthcheck`, délai de 120s, période de 30s, 3 échecs | Redémarre un pod bloqué après le démarrage. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage partagé des pièces jointes ; également la source par défaut de l'hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Emplacement où OnlyOffice stocke les pièces jointes partagées. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Désactivé par défaut — la persistance repose sur le PVC bloc et le NFS, pas sur GCS. Définissez `true` uniquement si vous avez besoin d'un bucket simple supplémentaire. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une garde au moment du plan rejette `false`. |
| `redis_host` | `""` (→ IP du serveur NFS) | Laissez vide pour utiliser le Redis colocalisé sur la VM NFS ; `enable_nfs` doit alors valoir `true`. |
| `redis_port` | `6379` | Port TCP de Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Obligatoire — une garde au moment du plan rejette toute valeur autre que `POSTGRES_13`/`14`/`15`/`NONE`. MySQL n'est pas pris en charge. |
| `application_database_name` | `onlyoffice` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `onlyoffice` | Utilisateur de la base de données applicative ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour le routage par domaine personnalisé (activé par défaut, contrairement à la plupart des applications). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `network_tags` | `["nfsserver"]` | Tag requis pour le chemin par défaut de colocalisation NFS/Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à OnlyOffice. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide sauf si `create_cloud_storage = true`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` forcé en même temps qu'un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` donnés sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. OnlyOffice ajoute ses propres gardes (`database_type` limité à PostgreSQL, `enable_redis` obligatoire, couplage `redis_host`/`enable_nfs`). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critical | Tout autre moteur est rejeté au moment du plan — MySQL n'est pas pris en charge par le Document Server. |
| `enable_redis` | `true` | Critical | Une garde au moment du plan rejette `false` — sans Redis partagé, l'état de session/d'édition ne peut pas être coordonné entre les pods. |
| `redis_host` / `enable_nfs` | Laisser `redis_host` vide uniquement avec `enable_nfs = true` | Critical | Un `redis_host` vide avec `enable_nfs = false` échoue au moment du plan — aucun hôte Redis ne peut être résolu. |
| `JWT_SECRET` (généré automatiquement) | Ne jamais le modifier une fois des intégrations en place | Critical | Sa rotation casse toutes les applications hôtes (Nextcloud/ownCloud/etc.) qui intègrent l'éditeur jusqu'à ce qu'elles soient toutes mises à jour avec la nouvelle valeur. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend toutes les données orphelines. |
| `stateful_pvc_enabled` | `true` | High | Le désactiver (ou forcer `workload_type = "Deployment"` en même temps) expose à des données de cache/d'index corrompues par gcsfuse — ou échoue au moment du plan si c'est forcé. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) ou `standard` (HDD) si le quota est serré | Medium | Le SSD puise dans le quota serré `SSD_TOTAL_GB` ; une large campagne d'applications avec état peut l'épuiser — voir [App_GKE](App_GKE.md). |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE. |
| `container_resources.memory_limit` | `4Gi` | High | La pile embarquée Postgres/client Redis/RabbitMQ/nginx/convertisseurs sous `supervisord` est lourde ; un sous-dimensionnement expose à un OOM au démarrage. |
| `max_instance_count` | `5` (à ajuster selon la charge) | Medium | La charge de conversion de chaque pod est gourmande en CPU et en mémoire ; une mise à l'échelle trop élevée sans marge expose à une pression sur les nœuds sous Autopilot. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement de tous les pods de l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toute URL de rappel d'intégration enregistrée. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

{/* TODO: verify whether enable_custom_domain=true with an empty application_domains list falls back to a nip.io hostname on the reserved LoadBalancer IP, or leaves the Ingress unconfigured until a domain is set. */}

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à OnlyOffice partagée avec la variante Cloud Run est
décrite dans **[OnlyOffice_Common](OnlyOffice_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OnlyOffice sur GKE Autopilot](../labs/OnlyOffice_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OnlyOffice Common — Configuration applicative partagée](OnlyOffice_Common.md) — la configuration partagée par les deux cibles de déploiement.
