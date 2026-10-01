---
title: "AFFiNE sur GKE Autopilot"
description: "Référence de configuration pour déployer AFFiNE sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Affine_GKE.md @ 3055034 sha256:a7a08d3ba3ab -->

# AFFiNE sur GKE Autopilot {#affine-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_GKE.png" alt="AFFiNE sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE est une base de connaissances open source, axée sur la confidentialité,
qui réunit documents, tableaux blancs et bases de données dans un même espace
de travail — une alternative auto-hébergeable à Notion et Miro. Ce module
déploie AFFiNE sur **GKE Autopilot** sous la forme d'une fine surcouche du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise AFFiNE et sur la façon
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

AFFiNE s'exécute sous la forme d'un unique serveur auto-hébergé Node.js. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod serveur Node.js sur le port 3010, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` |
| Collaboration en temps réel | Redis (co-hébergé sur la VM NFS partagée) | Pub/sub de synchronisation des documents Yjs et file de tâches en arrière-plan |
| Persistance des fichiers | Cloud Filestore (NFS) | Les blobs téléversés persistent sous `/root/.affine/storage`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (sauvegardes/stockage auxiliaire) |
| Secrets | Secret Manager | Uniquement le mot de passe de base de données généré automatiquement — la clé de signature d'AFFiNE réside dans PostgreSQL |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut
  `POSTGRES_15` et `Affine_Common` fixe le moteur dans tous les cas — les
  autres moteurs ne sont pas pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur le loopback, et non via
  un socket.** `enable_cloudsql_volume = true` exécute un sidecar
  cloud-sql-proxy à l'écoute sur `127.0.0.1:5432` (le modèle GKE) — ce qui
  diffère de la variante Cloud Run, qui monte un socket Unix. Le point
  d'entrée cloud résout l'hôte loopback et définit `sslmode=disable` pour
  celui-ci ; une véritable IP privée (Cloud Run) reçoit `sslmode=require` à la
  place.
- **Redis est obligatoire, pas facultatif.** `enable_redis = true` par
  défaut ; la VM NFS partagée co-héberge également Redis, c'est pourquoi la
  description indique explicitement de conserver `enable_nfs = true` sauf si
  un `redis_host` externe est fourni. Sans Redis, la synchronisation des
  documents en temps réel et la file de tâches ne fonctionnent pas.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/root/.affine/storage`) afin que les blobs téléversés persistent et
  puissent être partagés entre les pods — et parce qu'il héberge l'instance
  Redis dont dépend l'application.
- **L'affinité de session est `ClientIP`**, de sorte que les requêtes d'un
  client atteignent le même pod.
- **Aucun compte ni mot de passe administrateur à récupérer.** AFFiNE
  n'impose aucun identifiant administrateur au premier lancement ; le premier
  utilisateur qui s'inscrit sur l'URL déployée devient propriétaire de
  l'espace de travail.
- **La clé de signature réside dans la base de données, pas dans Secret
  Manager.** AFFiNE génère sa clé de signature/privée pendant l'étape
  `self-host-predeploy` du job `affine-migrate` et la conserve dans
  PostgreSQL — `secret_ids` est volontairement vide ; le mot de passe de base
  de données est le seul secret que Secret Manager détient pour cette
  application.
- **La création du schéma a lieu dans un job d'initialisation, pas au
  démarrage.** Le job `affine-migrate` exécute
  `node ./scripts/self-host-predeploy` (migration idempotente + génération de
  la clé) avant le démarrage du conteneur serveur ; il n'y a donc aucune étape
  d'installation au premier démarrage à attendre à l'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail AFFiNE {#a-gke-autopilot--the-affine-workload}

Les pods AFFiNE sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le type de charge de travail est déterminé
par la logique partagée `workload_type`/`stateful_pvc_enabled` (voir
[App_GKE](App_GKE.md)) ; par défaut, AFFiNE s'exécute en tant que
`Deployment`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail AFFiNE pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~affine 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, du scaling et du type
de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AFFiNE stocke toutes les données de l'espace de travail (documents, tableaux
blancs, bases de données, utilisateurs) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée le rôle et la base de données de
l'application et accorde les privilèges (ainsi qu'un octroi
`cloudsqlsuperuser` au mieux, afin que les migrations puissent exécuter
`CREATE EXTENSION`) ; le job `affine-migrate` exécute ensuite la migration de
schéma propre à AFFiNE.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatiques et la rotation du mot de passe.

### C. Redis — collaboration en temps réel {#c-redis--real-time-collaboration}

Le pub/sub de synchronisation des documents Yjs et la file de tâches en
arrière-plan d'AFFiNE nécessitent Redis. `enable_redis = true` par défaut ;
lorsque `redis_host` est laissé vide, le socle injecte l'IP du serveur NFS
partagé (la VM NFS co-héberge Redis). Le point d'entrée cloud fait
correspondre les variables injectées `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`
aux variables `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD`
d'AFFiNE.

- **Console :** Compute Engine → VM instances (la VM NFS/Redis partagée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i REDIS
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont la VM NFS/Redis partagée est
découverte et provisionnée.

### D. Cloud Storage et persistance des fichiers {#d-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement et le compte de service de la charge de travail y reçoit
l'accès ; il sert aux sauvegardes et au stockage auxiliaire. Par ailleurs,
les blobs téléversés d'AFFiNE résident sur **NFS (Cloud Filestore)** dans
`/root/.affine/storage`, partagés entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Seul le secret du mot de passe de base de données est généré automatiquement
pour AFFiNE — il n'existe aucun secret applicatif, car AFFiNE conserve sa
propre clé de signature dans PostgreSQL. Sur GKE, les secrets sont projetés
dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~affine"
  gcloud secrets versions access latest --secret=<database-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). Un domaine personnalisé avec un
certificat géré par Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP
  addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques GKE et Cloud SQL vers Cloud Monitoring. Des tests de disponibilité
et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application AFFiNE {#3-affine-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` (`postgres:15-alpine`, délai d'expiration de 600 s) crée de façon
  idempotente le rôle et la base de données de l'application, accorde les
  privilèges sur la base et sur le schéma `public`, et accorde au mieux
  `cloudsqlsuperuser` afin que les migrations ultérieures puissent exécuter
  `CREATE EXTENSION`. Il signale ensuite au sidecar Cloud SQL Auth Proxy
  (`POST /quitquitquit`) de s'arrêter, afin que le pod du Job se termine
  proprement.
- **Migration du schéma dans un job d'initialisation dédié, pas au
  démarrage.** Le job `affine-migrate` (l'image applicative AFFiNE construite,
  2Gi de mémoire, délai d'expiration de 1200 s, `max_retries = 3`) s'exécute
  après `db-init` et lance le script propre à AFFiNE
  `node ./scripts/self-host-predeploy`, qui effectue une migration de schéma
  idempotente **et génère la clé de signature/privée**, conservée dans
  PostgreSQL. Le conteneur d'exécution n'effectue jamais de migration en mode
  intégré (inline) — au démarrage du serveur, le schéma et la clé existent déjà.
- **Aucun compte administrateur imposé.** AFFiNE n'impose par son image aucun
  identifiant de super-administrateur ; le premier utilisateur qui visite
  l'URL déployée et s'inscrit devient le propriétaire initial de l'espace de
  travail.
- **La connexion à la base passe par TCP sur le loopback via le sidecar Auth
  Proxy, et non par un socket.** Le point d'entrée cloud
  (`cloud-entrypoint.sh`) assemble `DATABASE_URL` à partir des variables
  `DB_*` injectées ; sur GKE, l'hôte résolu est `127.0.0.1` (le sidecar
  proxy), d'où l'utilisation de `sslmode=disable`. Il fait également
  correspondre `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` aux variables
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD` d'AFFiNE, et
  définit par défaut `AFFINE_SERVER_EXTERNAL_URL` sur l'URL du service injectée
  par la plateforme, afin que les liens d'invitation et de partage se résolvent
  correctement.
- **Chemin de santé.** Les sondes de démarrage, de liveness et de readiness
  sont toutes des requêtes **HTTP** `GET /`, qui renvoient 200 dès que le
  serveur est prêt et ne nécessitent aucune authentification. Sonde de
  démarrage : délai initial de 60 s, période de 15 s, seuil de 30 échecs
  (jusqu'à ~510 s après le démarrage du conteneur). Liveness : délai initial
  de 60 s, période de 30 s, seuil de 3 échecs. Comme la migration s'exécute
  dans le job distinct `affine-migrate`, la fenêtre de démarrage couvre
  surtout le chargement du bundle Node.js et l'établissement des connexions
  Redis/PostgreSQL, et non la création du schéma.
- **L'indexeur plein texte est désactivé.** `AFFINE_INDEXER_ENABLED = "false"`
  car l'indexeur nécessite un backend de recherche reposant sur pgvector, que
  ce module ne provisionne pas ; le serveur démarre sur PostgreSQL + Redis
  standard.
- **Inspecter les jobs d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<affine-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_SERVER|AFFINE_SERVER'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à AFFiNE ou
importants pour celui-ci sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par
défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `affine` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image pour `ghcr.io/toeverything/affine`. `latest` correspond à `stable` (AFFiNE ne publie pas de tag `latest`). Incrémentez-le pour déclencher un nouveau build d'image. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | AFFiNE est toujours un build personnalisé léger au-dessus de l'image amont, afin que le point d'entrée cloud puisse s'exécuter. |
| `container_port` | `3010` | Port du serveur auto-hébergé d'AFFiNE. |
| `container_resources.cpu_limit` | `2000m` | 2 vCPU par défaut. |
| `container_resources.memory_limit` | `4Gi` | 4Gi par défaut. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pod. |
| `max_instance_count` | `5` | Nombre maximal de réplicas de pod. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy sur le loopback (`127.0.0.1:5432`) — obligatoire sur GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du socket Unix de l'Auth Proxy (utilisé pour le point de terminaison de métadonnées/quitquitquit, pas pour la connexion à la base elle-même). |
| `enable_image_mirroring` | `true` | Toujours true — l'image de base est mise en miroir depuis Docker Hub/GHCR dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface d'AFFiNE. |
| `workload_type` | `null` → `Deployment` | Deployment par défaut. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |
| `network_tags` | `["nfsserver"]` | Appliqués aux nœuds/pods ; correspondent au tag de pare-feu de la VM NFS/Redis partagée. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Conservez true — la VM NFS partagée co-héberge également l'instance Redis requise par AFFiNE ; la désactiver supprime à la fois la persistance des blobs et Redis, sauf si un `redis_host` externe est fourni. |
| `nfs_mount_path` | `/root/.affine/storage` | Emplacement où AFFiNE stocke les blobs téléversés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Obligatoire en production — la synchronisation en temps réel Yjs et la file de tâches passent par Redis. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS partagé. |
| `redis_port` | `6379` | Port TCP de Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis, si nécessaire. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE nécessite PostgreSQL 15+ ; les autres moteurs sont rejetés par la couche Common. |
| `application_database_name` | `affine` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `affine` | Utilisateur de base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard
d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à AFFiNE. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `affine-migrate`) et du job d'import (facultatif). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High**
> (service dégradé) — **Medium** (coût ou dégradation partielle) — **Low**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` forcé conjointement à un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` fourni sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Choisir un moteur autre que PostgreSQL casse `self-host-predeploy` et toutes les requêtes. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `enable_redis` | `true` | Critical | La synchronisation des documents en temps réel et la file de tâches d'AFFiNE dépendent de Redis ; le désactiver sans alternative casse la collaboration et les tâches en arrière-plan. |
| `enable_nfs` | `true` (sauf si un `redis_host` externe est fourni) | Critical | La VM NFS partagée co-héberge également Redis — désactiver NFS sans Redis externe supprime silencieusement la connexion Redis d'AFFiNE, et pas seulement la persistance des blobs. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:5432` est indispensable à la connectivité de la base sur GKE. |
| `container_resources.memory_limit` | `4Gi` | High | Le seul job d'initialisation `affine-migrate` demande 2Gi ; sous-dimensionner le conteneur serveur expose à un OOM sous la charge de la collaboration en temps réel. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions en temps réel reposant sur WebSocket. |
| `AFFINE_SERVER_EXTERNAL_URL` (valeur par défaut automatique) | URL du service de la plateforme | Medium | Si elle est mal remplacée via `environment_variables`, les liens d'invitation et de partage pointent vers le mauvais hôte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `AFFINE_INDEXER_ENABLED` (fixé à `false`) | Laisser tel quel, sauf si une base vectorielle est raccordée | Low | L'activer sans backend reposant sur pgvector casse l'indexeur plein texte. |
| `reserve_static_ip` | `true` | Medium | Sans cela, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `AFFINE_SERVER_EXTERNAL_URL`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
voir **[App_GKE](App_GKE.md)**. La configuration applicative propre à AFFiNE,
partagée avec la variante Cloud Run, est décrite dans
**[Affine_Common](Affine_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AFFiNE sur GKE Autopilot](../labs/Affine_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AFFiNE Common — Configuration applicative partagée](Affine_Common.md) — la configuration partagée par les deux cibles de déploiement.
