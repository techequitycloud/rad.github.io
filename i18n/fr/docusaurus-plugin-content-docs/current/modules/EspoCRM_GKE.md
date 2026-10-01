---
title: "EspoCRM sur GKE Autopilot"
description: "Référence de configuration pour déployer EspoCRM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/EspoCRM_GKE.md @ 3055034 sha256:e9faabe025df -->

# EspoCRM sur GKE Autopilot {#espocrm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_GKE.png" alt="EspoCRM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM est une plateforme open source de gestion de la relation client (CRM), sous licence GPLv3,
construite sur PHP et Apache. Ce module déploie EspoCRM sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et
Kubernetes.

Ce guide se concentre sur les services cloud qu'utilise EspoCRM et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

EspoCRM s'exécute comme une charge de travail web PHP/Apache. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — EspoCRM ne prend pas en charge PostgreSQL ; accessible via le sidecar Auth Proxy |
| Stockage d'objets | Cloud Storage + NFS (Filestore) | Bucket `gcs-espocrm<tenant-prefix>-espocrm-data` ; NFS partagé monté sur `/var/www/html/data` pour les fichiers envoyés |
| Cache | Redis (facultatif) | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ESPOCRM_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche applicative
  partagée (`database_type = "MYSQL_8_0"`) ; EspoCRM ne prend pas en charge PostgreSQL.
- **La base de données est atteinte via le sidecar Auth Proxy sur l'adresse de bouclage.** La variante GKE
  remplace `DB_HOST = "127.0.0.1"` afin qu'EspoCRM se connecte au sidecar Cloud SQL Auth Proxy
  colocalisé sur `127.0.0.1:3306` ; `enable_cloudsql_volume = true` par défaut.
- **Le compte administrateur est amorcé automatiquement.** L'installateur amont crée l'utilisateur
  `admin` avec le `ESPOCRM_ADMIN_PASSWORD` généré automatiquement au premier démarrage — récupérez-le
  dans Secret Manager pour vous connecter.
- **Le schéma est créé au premier démarrage, et non par un job de migration.** `db-init` crée la
  base de données et l'utilisateur ; le `docker-entrypoint.sh` amont exécute ensuite automatiquement l'action
  d'installation/migration au démarrage du pod.
- **NFS est activé par défaut.** `enable_nfs = true` monte un volume Filestore partagé sur
  `/var/www/html/data`, de sorte que les pièces jointes envoyées et les données d'exécution d'EspoCRM persistent d'un
  redémarrage de pod à l'autre et sont partagées entre les réplicas.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1` — GKE
  maintient au moins un pod en cours d'exécution (pas de mise à l'échelle à zéro) afin que le CRM soit toujours accessible.
- **L'affinité de session est `ClientIP` par défaut**, ce qui achemine les requêtes d'un client vers le même
  pod — utile dès que vous dépassez un réplica.
- **`ESPOCRM_SITE_URL` est dérivé de l'URL du service** afin que les liens absolus et les
  vérifications de l'installateur d'EspoCRM utilisent l'hôte accessible plutôt que `localhost`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail EspoCRM {#a-gke-autopilot--the-espocrm-workload}

Les pods EspoCRM sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent
réellement. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et maximal
de réplicas. Comme l'application s'appuie sur NFS, le socle utilise la stratégie de mise à jour `Recreate`
afin que deux pods n'écrivent jamais sur le même volume NFS pendant un déploiement progressif.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail EspoCRM pour voir les pods et
  les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, du scaling et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

EspoCRM stocke toutes les données de l'application (contacts, prospects, opportunités, activités, utilisateurs) dans
une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de manière privée via le sidecar **Cloud SQL
Auth Proxy** lié à `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, un
job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont tous exposés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques
et la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket **Cloud Storage** dédié (`gcs-espocrm<tenant-prefix>-espocrm-data`) est provisionné automatiquement, et un
volume **NFS (Filestore)** partagé est monté sur `/var/www/html/data` pour les pièces jointes envoyées
et les données d'exécution d'EspoCRM. Le compte de service de la charge de travail reçoit l'accès au bucket.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /var/www/html/data
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK, les montages GCS Fuse et le modèle de serveur NFS.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini, `REDIS_HOST` et
`REDIS_PORT` sont injectés et EspoCRM utilise Redis comme backend de cache d'objets afin de réduire la
charge sur la base de données. Lorsque `redis_host` est laissé vide et que `enable_nfs` vaut true, l'IP de la VM
du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (en cas d'utilisation d'une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur initial (`ESPOCRM_ADMIN_PASSWORD`) est généré automatiquement et
stocké dans Secret Manager, puis injecté dans le pod sous forme de variable d'environnement secrète via le pilote Secret
Store CSI. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [Sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE et de Cloud SQL sont envoyées à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles. Le `cloud-entrypoint.sh`
affiche au démarrage du pod les valeurs résolues de `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL` — un
moyen rapide de vérifier l'hôte de base de données et l'URL du site.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application EspoCRM {#3-espocrm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `mysql:8.0-debian`. Il résout la connexion Cloud SQL (socket de l'Auth Proxy s'il est présent,
  sinon TCP), crée de manière idempotente la base de données et l'utilisateur de l'application, accorde
  les privilèges et vérifie que l'utilisateur de l'application peut se connecter (en préchauffant le cache d'authentification
  `caching_sha2_password` de MySQL 8). Le job s'exécute lors de l'application et peut être relancé sans risque.
- **Schéma créé au premier démarrage.** Il n'y a pas de job de migration distinct. Une fois que `db-init` a
  provisionné la base de données, le `docker-entrypoint.sh` amont d'EspoCRM exécute automatiquement l'action
  d'installation/migration au démarrage du pod, créant le schéma et l'utilisateur `admin`.
- **L'identifiant administrateur est généré automatiquement.** Le mot de passe de l'utilisateur `admin` provient du
  secret `ESPOCRM_ADMIN_PASSWORD`. Récupérez-le avant votre première connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Modifiez-le dans l'interface d'EspoCRM (Administration → Users) une fois connecté.
- **Les fichiers envoyés persistent sur NFS.** Avec `enable_nfs = true` (par défaut), les pièces jointes et
  les données d'exécution d'EspoCRM résident sous le montage Filestore partagé `/var/www/html/data`, survivent aux
  redémarrages de pod et sont partagées entre les réplicas.
- **L'URL du site doit correspondre à l'hôte accessible.** EspoCRM construit les liens absolus à partir de
  `ESPOCRM_SITE_URL` ; le point d'entrée la définit à partir de l'URL du service. Une fois que l'IP du LoadBalancer
  ou le domaine personnalisé est connu, assurez-vous que l'URL du site reflète l'hôte externe afin que les liens et
  les redirections OAuth soient corrects.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux `HTTP GET /` — EspoCRM y sert
  sa page de connexion sans authentification (`200`). La sonde de démarrage (`startup_probe_config`)
  utilise par défaut un délai initial de 10 secondes, une période de 10 secondes et un seuil de 3 échecs ; la
  sonde de vivacité (`health_check_config`) utilise par défaut un délai initial de 15 secondes, une période de 30 secondes
  et un seuil de 3 échecs. Ces valeurs sont nettement plus strictes que celles de la variante
  Cloud Run — lors d'un premier démarrage lent (l'étape d'installation/migration), les pods peuvent osciller
  avant qu'EspoCRM ait terminé son initialisation ; augmentez le délai initial / le seuil d'échecs via
  `startup_probe_config` / `health_check_config` si vous constatez ce comportement.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à EspoCRM ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `espocrm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `espocrm/espocrm` ; `latest` est figé en interne sur `10.0.2`. Figez une version précise en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les plugins lourds ou les médias volumineux. |
| `upload_max_filesize` / `post_max_size` | `64M` | Limites de taille des fichiers envoyés / des requêtes POST ; `post_max_size` doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; minimum 1 vCPU pour EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par pod ; minimum 512Mi (PHP 8.x). |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE en maintient ≥ 1 afin que le CRM soit toujours accessible. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. À augmenter uniquement après confirmation du NFS partagé et de l'affinité `ClientIP`. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (adresse de bouclage `127.0.0.1:3306`). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (Deployment) | `Deployment` (par défaut) ou `StatefulSet` avec des PVC par pod. |
| `session_affinity` | `ClientIP` | Routage persistant vers le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume Filestore partagé pour les fichiers envoyés et les données d'exécution d'EspoCRM. |
| `nfs_mount_path` | `/var/www/html/data` | Chemin de montage du volume NFS dans le conteneur. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis comme backend de cache d'objets d'EspoCRM. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (EspoCRM_Common définit également `MYSQL_8_0` dans sa sortie `config`) | Moteur Cloud SQL. EspoCRM nécessite MySQL — ne sélectionnez pas PostgreSQL. |
| `application_database_name` | `espocrm` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `application_database_user` | `espocrm` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à EspoCRM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms du job de configuration (`db-init`) et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — quotas de mémoire en unités binaires, conflit avec `StatefulSet`, IAP sans identité autorisée, une valeur `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | EspoCRM ne prend en charge que MySQL ; sélectionner PostgreSQL fait échouer le démarrage. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `ESPOCRM_ADMIN_PASSWORD` (généré automatiquement) | Le récupérer dans Secret Manager ; le modifier dans l'interface | Critique | Ne définit le mot de passe administrateur que lors de la **première** installation ; le perdre vous bloque l'accès jusqu'à une réinitialisation via la base de données. |
| `enable_nfs` | `true` | Critique | Le désactiver stocke les fichiers envoyés sur le disque éphémère du pod — les pièces jointes sont perdues lors d'un redémarrage ou d'une replanification du pod. |
| `DB_HOST` (remplacé par `127.0.0.1`) | Laisser tel quel | Élevé | EspoCRM se connecte au sidecar Auth Proxy sur l'adresse de bouclage ; le modifier casse la connectivité à la base de données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité MySQL sur GKE. |
| `ESPOCRM_SITE_URL` (dérivé automatiquement) | URL du LoadBalancer externe / du domaine personnalisé | Élevé | Une URL de site incorrecte casse les liens absolus, la vérification de l'installateur et les redirections OAuth. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512Mi, PHP 8.x est arrêté pour OOM pendant l'installation/la migration et sous charge. |
| `max_instance_count` | `1` sauf si l'affinité et le NFS sont confirmés | Élevé | Un scaling avec un `RollingUpdate` sur une application adossée à NFS peut provoquer un blocage ; le socle utilise `Recreate` pour les applications NFS. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions multi-réplicas rebondissent d'un pod à l'autre. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_iap` | uniquement lorsque l'interface publique n'est pas nécessaire | Moyen | IAP exige une connexion Google pour chaque requête, y compris les intégrations d'API. |
| `application_version` | À figer en production | Moyen | `latest` correspond en interne à un tag figé, mais figer explicitement la version évite les mises à niveau inattendues lors d'un redéploiement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à EspoCRM partagée avec la variante Cloud Run est décrite dans
**[EspoCRM_Common](EspoCRM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : EspoCRM sur GKE Autopilot](../labs/EspoCRM_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EspoCRM sur Google Cloud Run](EspoCRM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [EspoCRM Common — Configuration applicative partagée](EspoCRM_Common.md) — la configuration partagée par les deux cibles de déploiement.
